#!/usr/bin/env node
/**
 * @file server.js
 * @package @shaper/pkg-vault-engine
 * @description Standalone / container entrypoint for Vault v1 daemon.
 */

import { createVaultServer } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.VAULT_PORT || '8610', 10);
const HOST = process.env.HOST || process.env.VAULT_HOST || '0.0.0.0';
const MASTER_KEY = process.env.VAULT_MASTER_KEY || process.env.VAULT_ENCRYPTION_KEY;
if (!MASTER_KEY || !MASTER_KEY.trim()) {
  console.error(
    '[brick-vault] VAULT_MASTER_KEY is not set. This repository ships no default key: '
    + 'a vault encrypted with a published key is not encrypted. '
    + 'Generate one with `openssl rand -hex 32` and pass it in the environment.',
  );
  process.exit(1);
}
const VAULT_TOKEN = process.env.VAULT_TOKEN || null;
const STORAGE_FILE = process.env.VAULT_STORAGE_FILE || '/storage/vault-data.json';

console.log(`[brick-vault] Starting Vault Engine on ${HOST}:${PORT}...`);
console.log(`[brick-vault] Storage: ${STORAGE_FILE}`);
console.log(`[brick-vault] Token Auth: ${VAULT_TOKEN ? 'ENABLED' : 'DISABLED (open localhost)'}`);

const server = createVaultServer({
  port: PORT,
  host: HOST,
  masterKey: MASTER_KEY,
  vaultToken: VAULT_TOKEN,
  storageFile: STORAGE_FILE
});

server.on('listening', () => {
  console.log(`[brick-vault] Ready and listening on http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[brick-vault] Received SIGTERM, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[brick-vault] Received SIGINT, shutting down...');
  server.close(() => process.exit(0));
});
