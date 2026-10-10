#!/usr/bin/env node
/**
 * @file server.js
 * @package @shaper/pkg-vault-engine
 * @description Standalone / container entrypoint for Vault v1 daemon.
 *
 * Storage is the unit's private MariaDB (Rules 4 and 26). The encrypted file
 * store remains only as declared DEV scaffolding, chosen explicitly with
 * VAULT_STORE=file; nothing falls back to it.
 */

import fs from 'node:fs';
import { createVaultServer } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.VAULT_PORT || '8610', 10);
const HOST = process.env.HOST || process.env.VAULT_HOST || '0.0.0.0';
const STORE = (process.env.VAULT_STORE || 'mariadb').trim();

function readMasterKey() {
  const file = process.env.VAULT_MASTER_KEY_FILE;
  if (file) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid()) {
        throw Object.assign(new Error('master-key file must be a private regular file owned by the unit'), { code: 'VAULT_KEY_FILE_UNTRUSTED' });
      }
      return fs.readFileSync(file, 'utf8').trim();
    } catch (err) {
      console.error(`[brick-vault] VAULT_MASTER_KEY_FILE ${file} is not readable: ${err.code || err.message}`);
      process.exit(1);
    }
  }
  if (STORE === 'mariadb') {
    console.error('[brick-vault] VAULT_MASTER_KEY_FILE is required for MariaDB; environment key values are DEV scaffolding only');
    process.exit(1);
  }
  return process.env.VAULT_MASTER_KEY || process.env.VAULT_ENCRYPTION_KEY;
}

const MASTER_KEY = readMasterKey();
if (!MASTER_KEY || !MASTER_KEY.trim()) {
  console.error(
    '[brick-vault] VAULT_MASTER_KEY is not set. This repository ships no default key: '
    + 'a vault encrypted with a published key is not encrypted. '
    + 'Generate one with `openssl rand -hex 32` and pass it in the environment.',
  );
  process.exit(1);
}
const VAULT_TOKEN = process.env.VAULT_TOKEN || null;

let vaultStore = null;
let identityService = null;
let storageFile = null;
if (STORE === 'mariadb') {
  const { MariaDbVaultStore } = await import('./mariadb-store.js');
  const slug = process.env.SHAPER_UNIT_SLUG || 'vault';
  try {
    vaultStore = await MariaDbVaultStore.open({ masterKey: MASTER_KEY, slug });
    if (!process.env.SHAPER_UNIVERSE_ID) throw Object.assign(new Error('SHAPER_UNIVERSE_ID is required'), { code: 'IDENTITY_POLICY_MISSING' });
    const { VaultUnitIdentity } = await import('./unit-identity.js');
    identityService = new VaultUnitIdentity({ pool: vaultStore.pool, masterKey: vaultStore.masterKey,
      universe: process.env.SHAPER_UNIVERSE_ID,
      ttl: process.env.UNIT_CREDENTIAL_TTL_SECONDS === undefined ? 300 : Number(process.env.UNIT_CREDENTIAL_TTL_SECONDS) });
  } catch (err) {
    console.error(`[brick-vault] refusing to start: ${err.code || 'ERROR'} — ${err.message}`);
    process.exit(1);
  }
  console.log(`[brick-vault] Storage: private MariaDB ${vaultStore.config.user}@localhost/${vaultStore.config.database} via ${vaultStore.config.socketPath} (identity ${vaultStore.identity.born ? 'born now' : 'continued'})`);
} else if (STORE === 'file') {
  storageFile = process.env.VAULT_STORAGE_FILE;
  if (!storageFile) {
    console.error('[brick-vault] VAULT_STORE=file needs an explicit VAULT_STORAGE_FILE');
    process.exit(1);
  }
  console.warn(`[brick-vault] DEV scaffolding: encrypted file store ${storageFile}. It never satisfies Rule 26.`);
} else {
  console.error(`[brick-vault] VAULT_STORE must be "mariadb" or "file"; got "${STORE}"`);
  process.exit(1);
}

console.log(`[brick-vault] Starting Vault Engine on ${HOST}:${PORT}...`);
console.log(`[brick-vault] Token Auth: ${VAULT_TOKEN ? 'ENABLED' : 'DISABLED (open localhost)'}`);

const server = createVaultServer({
  port: PORT,
  host: HOST,
  masterKey: MASTER_KEY,
  vaultToken: VAULT_TOKEN,
  storageFile,
  vaultStore,
  identityService,
});

server.on('listening', () => {
  console.log(`[brick-vault] Ready and listening on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`[brick-vault] Received ${signal}, shutting down...`);
  server.close(async () => {
    if (vaultStore) await vaultStore.close().catch(() => {});
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
