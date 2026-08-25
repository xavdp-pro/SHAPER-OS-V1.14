#!/usr/bin/env node
/**
 * Sync authorized AGY_API_KEY from REMOTE/helm.env → vault-resources.local.json + vault.enc
 * Source of truth: ../REMOTE/helm.env (already authorized Antigravity key).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultStore } from '../packages/vault/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const REMOTE_ENV = process.env.REMOTE_HELM_ENV
  || path.resolve(ROOT, '../../REMOTE/helm.env');
const RESOURCES = process.env.VAULT_RESOURCES_FILE
  || path.join(ROOT, 'resources/vault-resources.local.json');

function readKeyFromEnvFile(file) {
  if (!fs.existsSync(file)) return '';
  const text = fs.readFileSync(file, 'utf8');
  return text.match(/^ANTIGRAVITY_API_KEY=(.+)$/m)?.[1]?.trim()
    || text.match(/^AGY_API_KEY=(.+)$/m)?.[1]?.trim()
    || '';
}

const key = readKeyFromEnvFile(REMOTE_ENV)
  || readKeyFromEnvFile(path.resolve(ROOT, '../../REMOTE/antigravity-bridge.env'));
if (!key) {
  console.error(`[sync-agy-key] No AGY_API_KEY in ${REMOTE_ENV}`);
  process.exit(1);
}

if (fs.existsSync(RESOURCES)) {
  const resources = JSON.parse(fs.readFileSync(RESOURCES, 'utf8'));
  resources.secrets = resources.secrets || {};
  resources.secrets['secret/agy/api-key'] = { provider: 'antigravity', key };
  fs.writeFileSync(RESOURCES, JSON.stringify(resources, null, 2) + '\n', { mode: 0o600 });
  console.log(`[sync-agy-key] Updated ${RESOURCES}`);
}

const envPath = path.join(ROOT, '.env');
const masterKey = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, 'utf8').match(/^VAULT_MASTER_KEY=(.+)$/m)?.[1]
  : null;
if (masterKey) {
  const storageFile = path.join(ROOT, 'data/vault/vault.enc');
  const store = new VaultStore({ masterKey, storageFile });
  store.setSecret('secret/agy/api-key', { provider: 'antigravity', key });
  console.log(`[sync-agy-key] Patched vault → ${storageFile}`);
}

console.log(`[sync-agy-key] OK — key length ${key.length} (from REMOTE)`);
