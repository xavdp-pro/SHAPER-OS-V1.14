import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env'), override: true });

/**
 * Session → workspace map.
 * Formats per entry (comma-separated):
 *   name|/abs/path              — legacy, any node (avoid for remote paths)
 *   node/name|/abs/path         — only that CLI node (preferred)
 *   node|name|/abs/path         — same as node/name|path
 */
function parseSessionWorkspaces() {
  const map = {};
  const defaultName = process.env.CLI_DEV_CONVERSATION || 'Interface';
  const defaultPath = process.env.CLI_DEV_WORKSPACE
    || path.join(appRoot);
  map[defaultName] = defaultPath;

  for (const raw of [
    process.env.CLI_DEV_WORKSPACES || '',
    process.env.CLI_SESSION_WORKSPACES || '',
  ]) {
    if (!raw.trim()) continue;
    for (const part of raw.split(',')) {
      const bits = part.split('|').map((s) => s.trim()).filter(Boolean);
      if (bits.length === 2) {
        const [name, ws] = bits;
        if (name && ws) map[name] = ws;
      } else if (bits.length >= 3) {
        const [node, name, ws] = bits;
        if (node && name && ws) map[`${node}/${name}`] = ws;
      }
    }
  }
  return map;
}

/** Resolve workspace for a conversation on a given node (node-scoped first). */
export function resolveSessionWorkspace(conversationName, nodeName = '') {
  const name = String(conversationName || '').trim();
  const node = String(nodeName || '').trim();
  if (!name) return '';
  const map = parseSessionWorkspaces();
  if (node) {
    const scoped = map[`${node}/${name}`];
    if (scoped) return String(scoped).trim();
  }
  // Legacy bare name — only if no node-scoped entries exist for this name on other nodes
  const bare = map[name];
  if (!bare) return '';
  if (node) {
    const otherScoped = Object.keys(map).some((k) => k.includes('/') && k.endsWith(`/${name}`) && !k.startsWith(`${node}/`));
    if (otherScoped) return '';
  }
  return String(bare).trim();
}

/**
 * If CLI_SESSION_WORKSPACES has exactly one node-scoped entry for this name
 * (e.g. acer|NOW2|…), return that node — used to route bare "NOW2" correctly.
 */
export function preferredNodeForConversation(conversationName) {
  const name = String(conversationName || '').trim();
  if (!name) return '';
  const map = parseSessionWorkspaces();
  const nodes = Object.keys(map)
    .filter((k) => k.includes('/') && k.endsWith(`/${name}`))
    .map((k) => k.slice(0, k.length - name.length - 1));
  const uniq = [...new Set(nodes.filter(Boolean))];
  return uniq.length === 1 ? uniq[0] : '';
}

/**
 * cursor-agent-bridge nodes (Cursor CLI exposed via HTTP).
 * One node = one local or remote cursor-agent, same API.
 *
 * Single node (default):
 *   CLI_BRIDGE_NAME=local
 *   CLI_BRIDGE_URL=http://127.0.0.1:4200
 *   CLI_BRIDGE_TOKEN=...
 *
 * Multiple CLIs (later):
 *   CLI_NODES=local|http://127.0.0.1:4200|token,asus|http://10.87.78.5:4200|token2
 */
function parseNodes() {
  const raw = process.env.CLI_NODES || '';
  const fallbackToken = process.env.CLI_BRIDGE_TOKEN || process.env.OPENCODE_BRIDGE_TOKEN || '';
  const defaultUser = process.env.CLI_BRIDGE_USER || 'zaza';
  if (raw.trim()) {
    return raw.split(',').map((part) => {
      const [name, url, token, user] = part.split('|').map((s) => s.trim());
      return {
        name,
        url,
        token: token || fallbackToken,
        user: user || defaultUser,
      };
    }).filter((n) => n.name && n.url);
  }
  const url = process.env.CLI_BRIDGE_URL || process.env.OPENCODE_BRIDGE_URL || 'http://127.0.0.1:4440';
  return [{
    name: process.env.CLI_BRIDGE_NAME || 'opencode',
    url,
    token: fallbackToken,
    user: defaultUser,
  }];
}

/**
 * Development defaults exist so a laptop stack starts without ceremony. They must
 * never survive into a public deployment: a known secret is not a secret. When the
 * runtime declares production, a missing value is a halt, not a fallback.
 */
function secret(name, devFallback) {
  const value = process.env[name];
  if (value && value.trim()) return value.trim();
  const mode = process.env.SHAPER_RUNTIME_MODE || process.env.NODE_ENV;
  if (mode === 'production') {
    throw new Error(
      `${name} is not set and this runtime declares production. `
      + 'Development fallbacks are refused here: set it from the vault.',
    );
  }
  return devFallback;
}

export const config = {
  port: Number(process.env.PORT || 7926),
  jwtSecret: secret('JWT_SECRET', 'helm-v2-dev-secret'),
  appPassword: secret('APP_PASSWORD', 'bgvf'),
  /**
   * Runtime mode — same git tree, host .env chooses behaviour.
   * demo: seed guests, Fill-demo button, activity mails
   * production: no demo login affordances
   */
  appMode: (() => {
    const raw = String(process.env.APP_MODE || process.env.HELM_APP_MODE || 'production')
      .trim()
      .toLowerCase();
    return raw === 'demo' ? 'demo' : 'production';
  })(),
  get isDemo() {
    return this.appMode === 'demo';
  },
  cli: {
    nodes: parseNodes(),
    defaultUser: process.env.CLI_BRIDGE_USER || 'helm-v2',
    defaultConversation: process.env.CLI_DEFAULT_CONVERSATION || 'Interface',
    devConversation: process.env.CLI_DEV_CONVERSATION || 'Interface',
    devWorkspaces: parseSessionWorkspaces(),
    sessionWorkspaces: parseSessionWorkspaces(),
  },
  hume: {
    configId: process.env.HUME_CONFIG_ID?.trim() || '',
  },
  elevenlabs: {
    voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb',
    ttsModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_v3',
  },
  cartesia: {
    ttsModel: process.env.CARTESIA_TTS_MODEL?.trim() || 'sonic-3.5',
  },
  deepgram: {
    ttsModel: process.env.DEEPGRAM_TTS_MODEL?.trim() || 'aura-2',
  },
  ttsProvider: process.env.TTS_PROVIDER?.trim() || '',
  groq: {
    ackModel: process.env.GROQ_ACK_MODEL?.trim() || 'groq/compound-mini',
  },
};
