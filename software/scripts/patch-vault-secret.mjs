#!/usr/bin/env node
/** Patch one vault secret (operator use). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultStore } from '../packages/vault/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const secretKey = process.argv[2];
const payloadJson = process.argv[3];
if (!secretKey || !payloadJson) {
  console.error('Usage: node scripts/patch-vault-secret.mjs <secret/key> \'<json>\'');
  process.exit(1);
}

const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  console.error(`Missing ${envPath}`);
  process.exit(1);
}
const masterKey = fs.readFileSync(envPath, 'utf8').match(/^VAULT_MASTER_KEY=(.+)$/m)?.[1];
if (!masterKey) {
  console.error('VAULT_MASTER_KEY not found in .env');
  process.exit(1);
}

const storageFile = path.join(ROOT, 'data/vault/vault.enc');
const store = new VaultStore({ masterKey, storageFile });
store.setSecret(secretKey, JSON.parse(payloadJson));
console.log(`[patch-vault] updated ${secretKey}`);
