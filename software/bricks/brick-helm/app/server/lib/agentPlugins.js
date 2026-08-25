import fs from 'fs';
import path from 'path';

/**
 * Agent backend plugins — same HTTP contract as cursor-agent-bridge / antigravity-bridge:
 *   GET  /api/status | /api/health | /api/conversations | /api/events
 *   POST /api/inject | /api/conversations/stop | /api/conversations/reset
 *
 * Config:
 *   AGENT_PLUGINS=cursor|http://127.0.0.1:4310|token,agy|http://127.0.0.1:4330|token
 *   DEFAULT_AGENT_PLUGIN=agy
 */

/** Console engines. Live default = DEFAULT_AGENT_PLUGIN (agy today). */
export const CLI_ENGINE_IDS = ['agy', 'cursor', 'claude', 'opencode'];

export function isCliEnginePlugin(plugin) {
  if (!plugin?.id) return false;
  if (CLI_ENGINE_IDS.includes(plugin.id)) return true;
  return ['cursor', 'agy', 'antigravity', 'claude', 'opencode', 'generic'].includes(plugin.kind);
}

function pluginKindFromId(id) {
  const s = String(id || '').toLowerCase();
  if (s.startsWith('agy') || s.startsWith('antigravity')) return 'agy';
  if (s.startsWith('cursor')) return 'cursor';
  if (s.startsWith('claude')) return 'claude';
  // Own kind so the bridge token resolves; behaviour still falls back to the
  // generic adapter, its bridge implementing the shared contract as-is.
  if (s.startsWith('opencode')) return 'opencode';
  return 'generic';
}

function pluginDisplayName(id, kind) {
  if (id === 'agy' || kind === 'agy') return 'Antigravity';
  if (id === 'cursor' || kind === 'cursor') return 'Cursor';
  if (id === 'claude' || kind === 'claude') return 'Claude Code';
  if (id === 'opencode') return 'OpenCode';
  return id;
}

const BRIDGE_TOKEN_PATHS = {
  cursor: [
    process.env.CURSOR_BRIDGE_TOKEN_FILE,
    '/apps/helm-v2/.config/cursor-agent-bridge/token',
    path.join(process.env.HOME || '', '.config/cursor-agent-bridge/token'),
  ],
  agy: [
    process.env.ANTIGRAVITY_BRIDGE_TOKEN_FILE,
    process.env.AGY_BRIDGE_TOKEN_FILE,
    '/apps/helm-v2/.config/antigravity-bridge/token',
    path.join(process.env.HOME || '', '.config/antigravity-bridge/token'),
  ],
  antigravity: [
    process.env.ANTIGRAVITY_BRIDGE_TOKEN_FILE,
    process.env.AGY_BRIDGE_TOKEN_FILE,
    '/apps/helm-v2/.config/antigravity-bridge/token',
    path.join(process.env.HOME || '', '.config/antigravity-bridge/token'),
  ],
  opencode: [
    process.env.OPENCODE_BRIDGE_TOKEN_FILE,
    '/apps/helm-v2/.config/opencode-bridge/token',
    path.join(process.env.HOME || '', '.config/opencode-bridge/token'),
  ],
};

function readBridgeToken(kind) {
  const paths = BRIDGE_TOKEN_PATHS[kind] || [];
  for (const p of paths) {
    if (!p) continue;
    try {
      const t = fs.readFileSync(p, 'utf8').trim();
      if (t) return t;
    } catch {
      /* fichier absent */
    }
  }
  return '';
}

function resolvePluginToken(kind, envToken, fallbackToken) {
  if (process.env.OPENCODE_BRIDGE_TOKEN && (kind === 'opencode' || kind === 'generic')) return process.env.OPENCODE_BRIDGE_TOKEN;
  if (process.env.AGY_BRIDGE_TOKEN && (kind === 'agy' || kind === 'antigravity')) return process.env.AGY_BRIDGE_TOKEN;
  if (process.env.CURSOR_BRIDGE_TOKEN && kind === 'cursor') return process.env.CURSOR_BRIDGE_TOKEN;
  const fromFile = readBridgeToken(kind);
  if (fromFile) return fromFile;
  return envToken || fallbackToken;
}

function parsePluginList() {
  const raw = process.env.AGENT_PLUGINS || '';
  const fallbackToken = process.env.CLI_BRIDGE_TOKEN || process.env.OPENCODE_BRIDGE_TOKEN || '';
  const list = [];

  if (raw.trim()) {
    for (const part of raw.split(',')) {
      const [id, url, token] = part.split('|').map((s) => s.trim());
      if (!id || !url) continue;
      const kind = pluginKindFromId(id);
      list.push({
        id,
        name: pluginDisplayName(id, kind),
        url: url.replace(/\/$/, ''),
        token: resolvePluginToken(kind, token, fallbackToken),
        kind,
      });
    }
  }

  // Ensure default plugins only when AGENT_PLUGINS was not provided
  if (!raw.trim()) {
    if (!list.some((p) => p.id === 'opencode')) {
      const opencodeUrl = (process.env.OPENCODE_BRIDGE_URL || process.env.CLI_BRIDGE_URL || 'http://127.0.0.1:4440').replace(/\/$/, '');
      list.push({
        id: 'opencode',
        name: 'OpenCode',
        url: opencodeUrl,
        token: resolvePluginToken('opencode', '', fallbackToken),
        kind: 'opencode',
      });
    }

    if (!list.some((p) => p.id === 'agy')) {
      const agyUrl = (process.env.ANTIGRAVITY_BRIDGE_URL || process.env.AGY_BRIDGE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
      list.push({
        id: 'agy',
        name: 'Antigravity',
        url: agyUrl,
        token: resolvePluginToken('agy', '', fallbackToken),
        kind: 'agy',
      });
    }

    if (!list.some((p) => p.id === 'cursor')) {
      const cursorUrl = (process.env.CURSOR_BRIDGE_URL || 'http://127.0.0.1:4310').replace(/\/$/, '');
      list.push({
        id: 'cursor',
        name: 'Cursor',
        url: cursorUrl,
        token: resolvePluginToken('cursor', '', fallbackToken),
        kind: 'cursor',
      });
    }
  }

  return list.filter(isCliEnginePlugin);
}

let cache = null;

export function listAgentPlugins({ force = false } = {}) {
  if (!cache || force) cache = parsePluginList();
  return cache;
}

export function getDefaultPluginId() {
  const preferred = String(process.env.DEFAULT_AGENT_PLUGIN || 'opencode').trim();
  const plugins = listAgentPlugins();
  if (plugins.some((p) => p.id === preferred)) return preferred;
  return plugins[0]?.id || 'opencode';
}

export function getAgentPlugin(id) {
  const plugins = listAgentPlugins();
  const want = String(id || getDefaultPluginId()).trim();
  return plugins.find((p) => p.id === want) || plugins[0] || null;
}

export async function probePlugin(plugin) {
  if (!plugin?.url) return { ok: false, error: 'no url' };
  try {
    const res = await fetch(`${plugin.url}/api/health`, {
      headers: plugin.token ? { Authorization: `Bearer ${plugin.token}` } : {},
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, plugin: plugin.id };
  } catch (err) {
    return { ok: false, error: err.message, plugin: plugin.id };
  }
}

export async function probeAllPlugins() {
  const plugins = listAgentPlugins();
  const results = [];
  for (const p of plugins) results.push({ ...p, probe: await probePlugin(p) });
  return results;
}
