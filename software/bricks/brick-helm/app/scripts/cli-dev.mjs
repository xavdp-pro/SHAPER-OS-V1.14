#!/usr/bin/env node
/**
 * Envoie un prompt au cursor-agent CLI via le bridge, session dev helm-v1.
 * Usage: npm run cli:dev -- "Ajoute un bouton dark mode"
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');

function loadEnv() {
  const file = path.join(appRoot, '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = { ...process.env, ...loadEnv() };
const bridgeUrl = (env.CLI_BRIDGE_URL || 'http://127.0.0.1:4200').replace(/\/$/, '');
const tokenFile = path.join(os.homedir(), '.config/cursor-agent-bridge/token');
const token = env.CLI_BRIDGE_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
const conversation = env.CLI_DEV_CONVERSATION || 'helm-v1';
const workspace = env.CLI_DEV_WORKSPACE || appRoot;

const message = process.argv.slice(2).join(' ').trim();
if (!message) {
  console.error('Usage: npm run cli:dev -- "votre prompt"');
  process.exit(1);
}
if (!token) {
  console.error('CLI_BRIDGE_TOKEN ou ~/.config/cursor-agent-bridge/token requis');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

async function api(pathname, body) {
  const res = await fetch(`${bridgeUrl}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const prefix = 'Lis mds/AGENT-DEV.md. ';
await api('/api/conversations/workspace', { conversation, workspace });
const result = await api('/api/inject', { conversation, message: prefix + message });
console.log(JSON.stringify(result, null, 2));
