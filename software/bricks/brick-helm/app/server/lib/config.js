import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });

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
      const [name, ws] = part.split('|').map((s) => s.trim());
      if (name && ws) map[name] = ws;
    }
  }
  return map;
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
  const fallbackToken = process.env.CLI_BRIDGE_TOKEN || '';
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
  const url = process.env.CLI_BRIDGE_URL || 'http://127.0.0.1:4200';
  return [{
    name: process.env.CLI_BRIDGE_NAME || 'local',
    url,
    token: fallbackToken,
    user: defaultUser,
  }];
}

export const config = {
  port: Number(process.env.PORT || 7826),
  jwtSecret: process.env.JWT_SECRET || 'helm-dev-secret',
  appPassword: process.env.APP_PASSWORD || 'bgvf',
  cli: {
    nodes: parseNodes(),
    defaultUser: process.env.CLI_BRIDGE_USER || 'zaza',
    defaultConversation: process.env.CLI_DEFAULT_CONVERSATION || 'NOW3',
    devConversation: process.env.CLI_DEV_CONVERSATION || 'Interface',
    devWorkspaces: parseSessionWorkspaces(),
    sessionWorkspaces: parseSessionWorkspaces(),
  },
};
