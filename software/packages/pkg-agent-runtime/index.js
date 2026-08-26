/**
 * @package @shaper/pkg-agent-runtime
 * Generic task runtime — context resolution, bridge dispatch and evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bearerAuthHeaders } from '../pkg-auth/index.js';
import { ingestLog } from '../pkg-logger/ingest-client.js';

export function resolveContextPath(contextPath) {
  if (!contextPath) return null;
  if (fs.existsSync(contextPath)) return path.resolve(contextPath);
  const fromCwd = path.resolve(process.cwd(), contextPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return contextPath;
}

export async function probeBridgeHealth(healthUrl, authToken = '') {
  try {
    const res = await fetch(healthUrl, { headers: bearerAuthHeaders(authToken) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && (body.ok === true || body.status === 'ok'), status: res.status, body };
  } catch {
    return { ok: false };
  }
}

export function buildInjectBody(entry, overrides = {}) {
  return {
    conversation: overrides.conversation || `${entry.slug}-beat`,
    context_file: overrides.context_file || resolveContextPath(entry.contextPath) || null,
    context: overrides.context || entry.contextText || `Scheduled task for ${entry.slug}`,
    message: overrides.message || entry.instruction || entry.beatMessage || `Execute task ${entry.slug}.`,
  };
}

/**
 * Dispatches a universe-declared task to one selected bridge.
 * This runtime deliberately knows no product-specific input or vertical.
 */
export function createAgentRuntimeHandler({ bridgeBaseUrl, authToken = '', loggerUrl = null, fetchImpl = fetch } = {}) {
  if (!bridgeBaseUrl) throw new Error('bridgeBaseUrl is required');

  return async function agentRuntimeHandler(entry) {
    const slug = entry.slug;
    await ingestLog({
      loggerUrl, pod: 'maestro', event: 'BEAT_STARTED', correlationId: slug,
      data: { slug, kind: entry.kind || 'generic' }, fetchImpl,
    });

    const bridgeUrl = (entry.bridgeUrl || bridgeBaseUrl).replace(/\/$/, '');
    const health = await probeBridgeHealth(`${bridgeUrl}/api/health`, authToken);
    if (!health.ok) {
      await ingestLog({
        loggerUrl, pod: slug, event: 'BEAT_SKIPPED', level: 'WARN', correlationId: slug,
        data: { reason: 'bridge_unhealthy', bridge: bridgeUrl }, fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'bridge_unhealthy', processed: 0 };
    }

    const resolvedContext = resolveContextPath(entry.contextPath);
    if (entry.contextPath && !fs.existsSync(resolvedContext)) {
      await ingestLog({
        loggerUrl, pod: slug, event: 'BEAT_SKIPPED', level: 'WARN', correlationId: slug,
        data: { reason: 'context_file_missing', path: entry.contextPath }, fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'context_file_missing', processed: 0 };
    }

    const injectRes = await fetchImpl(`${bridgeUrl}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearerAuthHeaders(authToken) },
      body: JSON.stringify(buildInjectBody(entry)),
    });
    const injectData = await injectRes.json().catch(() => ({}));
    if (!injectRes.ok || injectData.ok !== true) {
      await ingestLog({
        loggerUrl, pod: slug, event: 'BEAT_FAILED', level: 'ERROR', correlationId: slug,
        data: { reason: 'inject_failed', bridge: bridgeUrl }, fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'inject_failed', processed: 0 };
    }

    const runId = injectData.run_id || injectData.runId || null;
    await ingestLog({
      loggerUrl, pod: slug, event: 'AGENT_BEAT_INJECT', correlationId: slug,
      data: { slug, kind: entry.kind || 'generic', bridge_type: entry.bridgeType || null, run_id: runId }, fetchImpl,
    });
    await ingestLog({
      loggerUrl, pod: 'brick-maestro', event: 'BEAT_COMPLETED', correlationId: slug,
      data: { slug, processed: 1 }, fetchImpl,
    });
    return { ok: true, processed: 1, run_id: runId };
  };
}
