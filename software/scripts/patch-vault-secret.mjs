#!/usr/bin/env node
// Intent: software/packages/pkg-vault/INTENT.md
// Intent: software/bricks/brick-vault/INTENT.md
/**
 * Patch one vault secret (operator use).
 *
 * Usage:
 *   VAULT_STORAGE_FILE=<vault.enc of the universe> node scripts/patch-vault-secret.mjs <secret/key> '<json>'
 *
 * The vault is one per universe (brick-vault invariant 4; V1.13.1, F9), so
 * THIS script has no default storage path: until the 2 September audit it
 * wrote into data/vault/vault.enc — the shared path every universe on a host
 * once used — creating a vault nobody reads when that file was absent. A
 * patcher that guesses writes into the wrong vault; only the bootstrap, which
 * CREATES a vault, may choose a place when none is given, and it prints the
 * place it chose. VAULT_STORAGE_FILE and VAULT_MASTER_KEY come from the shell
 * first, then from software/.env (or VAULT_ENV_FILE), through the one parser
 * the vault scripts share (lib/dotenv.mjs). What the operator exported wins
 * over the file. Point VAULT_STORAGE_FILE at the vault the universe's deploy
 * mounts, or at the path `npm run vault:bootstrap` printed. A vault that does
 * not exist is a halt: creating one here, under whatever key was at hand, is
 * how a secret ends up encrypted with a key no brick holds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultStore } from '../packages/pkg-vault/index.js';
import { loadDotEnv } from './lib/dotenv.mjs';

const TAG = '[patch-vault-secret]';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.VAULT_ENV_FILE || path.join(ROOT, '.env');

const secretKey = process.argv[2];
const payloadJson = process.argv[3];
if (!secretKey || !payloadJson) {
  console.error('Usage: VAULT_STORAGE_FILE=<vault.enc> node scripts/patch-vault-secret.mjs <secret/key> \'<json>\'');
  process.exit(1);
}

loadDotEnv(ENV_FILE, TAG);

function demand(name, hint) {
  const value = (process.env[name] || '').trim();
  if (value) return value;
  console.error(`${TAG} HALT — ${name} is missing: not exported in the shell and not in ${ENV_FILE}.`);
  console.error(`${TAG} ${hint}`);
  process.exit(1);
}

const storageFile = path.resolve(ROOT, demand('VAULT_STORAGE_FILE',
  'The vault is per universe: point VAULT_STORAGE_FILE at the vault.enc of the universe you mean '
  + '(the path its deploy script mounts on /data/vault), or at the path `npm run vault:bootstrap` printed.'));
const masterKey = demand('VAULT_MASTER_KEY', 'Export the master key that encrypted that vault, or put it in software/.env.');

if (!fs.existsSync(storageFile)) {
  console.error(`${TAG} HALT — ${storageFile} does not exist. This script patches a vault; it never creates one (that is \`npm run vault:bootstrap\`).`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(payloadJson);
} catch (err) {
  console.error(`${TAG} HALT — the second argument is not JSON: ${err.message}`);
  process.exit(1);
}

const store = new VaultStore({ masterKey, storageFile });
store.setSecret(secretKey, payload);
console.log(`${TAG} updated ${secretKey} in ${storageFile}`);
