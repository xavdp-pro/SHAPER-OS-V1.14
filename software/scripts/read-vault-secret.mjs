#!/usr/bin/env node
/** Read and print one vault secret (stdout JSON). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultStore } from '../packages/vault/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const secretKey = process.argv[2];
if (!secretKey) {
  console.error('Usage: node scripts/read-vault-secret.mjs <secret/key>');
  process.exit(1);
}

const envPath = path.join(ROOT, '.env');
const masterKey = fs.readFileSync(envPath, 'utf8').match(/^VAULT_MASTER_KEY=(.+)$/m)?.[1];
if (!masterKey) process.exit(1);

const storageFile = path.join(ROOT, 'data/vault/vault.enc');
const store = new VaultStore({ masterKey, storageFile });
const value = store.getSecret(secretKey);
if (value == null) process.exit(2);
process.stdout.write(JSON.stringify(value));
