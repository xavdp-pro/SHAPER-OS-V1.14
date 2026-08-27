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
    if (resources?.vault?.masterKey) vaultMasterKey = resources.vault.masterKey;
    if (resources?.vault?.token) vaultToken = resources.vault.token;
    if (resources?.vault?.storageFile) storageFile = path.resolve(ROOT, resources.vault.storageFile);
    if (resources?.secrets) secrets = resources.secrets;
  } catch (err) {
    console.warn(`[bootstrap-vault] Warning reading ${RESOURCES_FILE}: ${err.message}`);
  }
}

if (!vaultMasterKey) {
  console.error('[bootstrap-vault] VAULT_MASTER_KEY in .env or vault.masterKey in resources file is required');
  process.exit(1);
}
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
