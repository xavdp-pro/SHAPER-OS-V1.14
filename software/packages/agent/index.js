/**
 * @package @shaper/agent
 * Parameterized agent task helpers — slug conventions, bridge dispatch, beat handlers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bearerAuthHeaders } from '../auth/index.js';
import { ingestLog } from '../logger/ingest-client.js';
/**
 * Mail intake is not part of the base.
 *
 * This runner used to import the IMAP client directly, which made the smallest
 * agent universe depend on a mail product it may never use. The capability is
 * injected instead: a deployment that wants it passes `mailHandler`, and one
 * that does not gets a clear refusal rather than a missing module.
 */

/** @typedef {'agy'|'cursor'|'claude'|'opencode'|'generic'} AgentBridgeType */

export function mailboxToSlug(mailbox) {
  const [local, domain] = String(mailbox || '').toLowerCase().split('@');
  if (!local || !domain) throw new Error('Invalid mailbox address');
  const domainSlug = domain.replace(/\./g, '-');
  return `mail-${local}-${domainSlug}`;
}

export function vaultKeyForMailbox(mailbox) {
  return `secret/mail/${mailboxToSlug(mailbox).replace(/^mail-/, '')}`;
}

/**
 * Resolve context file path (relative to cwd or absolute).
 * @param {string|null} contextPath
 * @returns {string|null}
 */
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
    const ok = res.ok && (body.ok === true || body.status === 'ok');
    return { ok, status: res.status, body };
  } catch {
    return { ok: false };
  }
}

export function buildInjectBody(entry, overrides = {}) {
  const conversation = overrides.conversation || `${entry.slug}-beat`;
  const contextFile = overrides.context_file || resolveContextPath(entry.contextPath) || null;
  const context = overrides.context || entry.contextText || `Scheduled beat for ${entry.slug}`;
  let message = overrides.message || entry.beatMessage || `Execute scheduled task for ${entry.mailbox || entry.slug}.`;
  if (overrides.newMessages != null && entry.kind === 'mail') {
    message += ` (${overrides.newMessages} new message(s) in inbox.)`;
  }
  return { conversation, context_file: contextFile, context, message };
}

/**
 * Harmonized beat handler: logger → mail check (if kind=mail) → agy inject → logger.
 */
export function createAgentBeatHandler({
  bridgeBaseUrl,
  authToken = '',
  vaultClient = null,
  loggerUrl = null,
  checkpointPath = null,
  mailStubMode = process.env.MAIL_AGENT_STUB === '1',
  mailHandler = null,
  fetchImpl = fetch,
} = {}) {
  if (!bridgeBaseUrl) throw new Error('bridgeBaseUrl is required');

  return async function agentBeatHandler(entry) {
    const slug = entry.slug;
    await ingestLog({
      loggerUrl,
      pod: 'maestro',
      event: 'BEAT_STARTED',
      correlationId: slug,
      data: { slug, kind: entry.kind || 'bridge', mailbox: entry.mailbox || null },
      fetchImpl,
    });

    const healthUrl = `${(entry.bridgeUrl || bridgeBaseUrl).replace(/\/$/, '')}/api/health`;
    const health = await probeBridgeHealth(healthUrl, authToken);
    if (!health.ok) {
      await ingestLog({
        loggerUrl,
        pod: slug,
        event: 'BEAT_SKIPPED',
        level: 'WARN',
        correlationId: slug,
        data: { reason: 'bridge_unhealthy', bridge: entry.bridgeUrl || bridgeBaseUrl },
        fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'bridge_unhealthy', newMessages: 0 };
    }

    let newMessages = 0;
    if (entry.kind === 'mail' && entry.vaultKey && vaultClient) {
      const cp = entry.checkpointPath || checkpointPath;
      if (typeof mailHandler !== 'function') {
        await ingestLog({
          loggerUrl,
          pod: slug,
          event: 'BEAT_SKIPPED',
          level: 'WARN',
          correlationId: slug,
          data: { reason: 'mail_capability_absent', kind: entry.kind },
          fetchImpl,
        });
        return {
          ok: false,
          skipped: true,
          reason: 'mail_capability_absent',
          newMessages: 0,
        };
      }
      const mailResult = await mailHandler({
        vaultClient,
        vaultKey: entry.vaultKey,
        slug,
        loggerUrl,
        checkpointPath: cp,
        stubMode: mailStubMode,
        fetchImpl,
      });
      if (!mailResult.ok) {
        await ingestLog({
          loggerUrl,
          pod: slug,
          event: 'BEAT_SKIPPED',
          level: 'WARN',
          correlationId: slug,
          data: { reason: mailResult.reason },
          fetchImpl,
        });
        return { ok: false, skipped: true, reason: mailResult.reason, newMessages: 0 };
      }
      newMessages = mailResult.newMessages;
    }

    const resolvedContext = resolveContextPath(entry.contextPath);
    if (entry.contextPath && resolvedContext && !fs.existsSync(resolvedContext)) {
      await ingestLog({
        loggerUrl,
        pod: slug,
        event: 'BEAT_SKIPPED',
        level: 'WARN',
        correlationId: slug,
        data: { reason: 'context_file_missing', path: entry.contextPath },
        fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'context_file_missing', newMessages: 0 };
    }

    const injectBase = (entry.bridgeUrl || bridgeBaseUrl).replace(/\/$/, '');
    const injectBody = buildInjectBody(entry, { newMessages });
    const injectRes = await fetchImpl(`${injectBase}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearerAuthHeaders(authToken) },
      body: JSON.stringify(injectBody),
    });
    const injectData = await injectRes.json().catch(() => ({}));
    if (!injectRes.ok || injectData.ok !== true) {
      await ingestLog({
        loggerUrl,
        pod: slug,
        event: 'BEAT_FAILED',
        level: 'ERROR',
        correlationId: slug,
        data: { reason: 'inject_failed', bridge: injectBase },
        fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'inject_failed', newMessages: 0 };
    }

    await ingestLog({
      loggerUrl,
      pod: slug,
      event: 'AGENT_BEAT_INJECT',
      correlationId: slug,
      data: {
        slug,
        mailbox: entry.mailbox || null,
        new_messages: newMessages,
        bridge_type: entry.bridgeType || null,
        run_id: injectData.run_id || injectData.runId || null,
      },
      fetchImpl,
    });

    await ingestLog({
      loggerUrl,
      pod: 'maestro',
      event: 'BEAT_COMPLETED',
      correlationId: slug,
      data: { slug, new_messages: newMessages || 1 },
      fetchImpl,
    });

    return {
      ok: true,
      newMessages: entry.kind === 'mail' ? newMessages : 1,
      run_id: injectData.run_id || injectData.runId || null,
    };
  };
}
