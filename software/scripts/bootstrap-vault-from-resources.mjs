#!/usr/bin/env node
// Intent: software/packages/pkg-vault/INTENT.md
/**
 * Bootstrap encrypted vault from resources/vault-resources.local.json
 * Sovereign REMOTE2 — plaintext resources live ONLY in resources/*.local.json (gitignored).
 *
 * Usage:
 *   node scripts/bootstrap-vault-from-resources.mjs
 *   VAULT_RESOURCES_FILE=./resources/vault-resources.local.json node scripts/bootstrap-vault-from-resources.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultStore } from '../packages/pkg-vault/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RESOURCES_FILE = process.env.VAULT_RESOURCES_FILE
  || path.join(ROOT, 'resources/vault-resources.local.json');

let vaultMasterKey = process.env.VAULT_MASTER_KEY;
let vaultToken = process.env.VAULT_TOKEN;
let storageFile = path.resolve(ROOT, process.env.VAULT_STORAGE_FILE || 'data/vault/vault.enc');
let secrets = {};

if (fs.existsSync(RESOURCES_FILE)) {
  try {
    const resources = JSON.parse(fs.readFileSync(RESOURCES_FILE, 'utf8'));
    if (!process.env.VAULT_MASTER_KEY && resources?.vault?.masterKey) vaultMasterKey = resources.vault.masterKey;
    if (!process.env.VAULT_TOKEN && resources?.vault?.token) vaultToken = resources.vault.token;
    // An explicit env choice always beats the packaged default. Until V1.13.1
    // the resources file silently overrode VAULT_STORAGE_FILE, so every
    // universe on a host wrote into ONE shared vault.enc (beta finding F9) —
    // a deployment that asked for isolation got commingling, silently.
    if (!process.env.VAULT_STORAGE_FILE && resources?.vault?.storageFile) storageFile = path.resolve(ROOT, resources.vault.storageFile);
    if (resources?.secrets) secrets = resources.secrets;
  } catch (err) {
    console.warn(`[bootstrap-vault] Warning reading ${RESOURCES_FILE}: ${err.message}`);
  }
}

if (!vaultMasterKey || !String(vaultMasterKey).trim()) {
  console.error('[bootstrap-vault] VAULT_MASTER_KEY in .env or vault.masterKey in resources file is required');
  process.exit(1);
}

// Rule 0J — a value the operator never chose must halt, not flow. The shipped
// resources examples carry their vault keys as templates
// (`<same as .env VAULT_MASTER_KEY>`, `<GENERATE_PASSPHRASE_OR_64_HEX>`), and a
// literal `cp` that was never filled in used to reach this point unchallenged:
// the vault was encrypted with the documentation itself as master key, the
// token the example publishes became the vault's bearer token, and the run
// exited 0 reporting OK (Muse Code beta, v1.13.7 incident 1). Documentation is
// not a key. Refuse it BEFORE anything is created — a halt that already wrote
// half a vault teaches the next run to trust a file nobody chose.
const PLACEHOLDER = [
  /<[^>]*>/,                                        // the examples' own shape: <same as .env VAULT_MASTER_KEY>
  /\bchange[-_ ]?me\b/i,
  /\bplaceholder\b/i,
  /\byour[-_ ](key|token|secret|master|passphrase)\b/i,
  /\b(todo|fixme|tbd)\b/i,
  /^x{3,}$/i,
  /^(example|sample|dummy|secret|password|token|key)$/i,
];
const isPlaceholder = (value) => PLACEHOLDER.some((re) => re.test(String(value).trim()));

const FIX = [
  'Generate real keys and mirror them — see docs/agent/RUNBOOK-EXPLICIT.md §4.1:',
  '  sed -i "s|^VAULT_MASTER_KEY=.*|VAULT_MASTER_KEY=$(openssl rand -hex 32)|" software/.env',
  '  sed -i "s|^VAULT_TOKEN=.*|VAULT_TOKEN=$(openssl rand -hex 24)|" software/.env',
  '  then run the runbook\'s python3 block, which fills the resources file from software/.env.',
];

function haltOnPlaceholder(field, value, origin) {
  if (value === undefined || value === null || !isPlaceholder(value)) return;
  console.error(`[bootstrap-vault] HALT — ${field} (${origin}) is still an example placeholder, not a value you chose.`);
  console.error('[bootstrap-vault] Rule 0J: a key nobody chose must never encrypt a vault. Nothing was written.');
  for (const line of FIX) console.error(`[bootstrap-vault] ${line}`);
  process.exit(1);
}

haltOnPlaceholder(
  'vault.masterKey',
  vaultMasterKey,
  process.env.VAULT_MASTER_KEY ? 'VAULT_MASTER_KEY in the environment' : RESOURCES_FILE,
);
haltOnPlaceholder(
  'vault.token',
  vaultToken,
  process.env.VAULT_TOKEN ? 'VAULT_TOKEN in the environment' : RESOURCES_FILE,
);

fs.mkdirSync(path.dirname(storageFile), { recursive: true });

const store = new VaultStore({ masterKey: vaultMasterKey, storageFile });
let count = 0;

for (const [key, payload] of Object.entries(secrets || {})) {
  store.setSecret(key, payload);
  count++;
}

// An empty vault is still a materialized vault. Without this write, a
// zero-secret TEST reports success but leaves no storage file, so every boot
// repeats bootstrap and no caller can distinguish "empty" from "never done".
if (!fs.existsSync(storageFile)) store.persist();

// Optional: write .env pointers (no secret values duplicated if already in resources)
const envPath = process.env.VAULT_ENV_FILE || path.join(ROOT, '.env');
const envLines = [
  `VAULT_MASTER_KEY=${vaultMasterKey}`,
  `VAULT_TOKEN=${vaultToken || ''}`,
  `VAULT_STORAGE_FILE=${storageFile}`,
  `BRIDGE_AGY_STUB=1`,
];
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, envLines.join('\n') + '\n', { mode: 0o600 });
  console.log(`[bootstrap-vault] Created ${envPath} (vault pointers only)`);
}

console.log(`[bootstrap-vault] OK — ${count} secret(s) → ${storageFile}`);
