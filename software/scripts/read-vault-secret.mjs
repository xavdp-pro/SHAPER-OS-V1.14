#!/usr/bin/env node
// Intent: software/packages/pkg-vault/INTENT.md
// Intent: software/bricks/brick-vault/INTENT.md
/**
 * Read and print one vault secret (stdout JSON).
 *
 * Usage:
 *   VAULT_STORAGE_FILE=<vault.enc of the universe> node scripts/read-vault-secret.mjs <secret/key>
 *
 * Exit codes: 0 printed · 1 halt (missing input, no such vault) · 2 no such secret.
 *
 * The vault is one per universe (brick-vault invariant 4; V1.13.1, F9), so
 * THIS script has no default storage path: until the 2 September audit it
 * read data/vault/vault.enc — the shared path every universe on a host once
 * wrote into — and answered "no such secret" about a vault nobody was using.
 * A reader that guesses answers about the wrong vault; only the bootstrap,
 * which CREATES a vault, may choose a place when none is given, and it prints
 * the place it chose. VAULT_STORAGE_FILE and VAULT_MASTER_KEY come from the
 * shell first, then from software/.env (or VAULT_ENV_FILE), through the one
 * parser the vault scripts share (lib/dotenv.mjs). What the operator exported
 * wins over the file. Point VAULT_STORAGE_FILE at the vault the universe's
 * deploy mounts, or at the path `npm run vault:bootstrap` printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultStore } from '../packages/pkg-vault/index.js';
import { loadDotEnv } from './lib/dotenv.mjs';

const TAG = '[read-vault-secret]';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.VAULT_ENV_FILE || path.join(ROOT, '.env');

const secretKey = process.argv[2];
if (!secretKey) {
  console.error('Usage: VAULT_STORAGE_FILE=<vault.enc> node scripts/read-vault-secret.mjs <secret/key>');
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
  // VaultStore would start empty and this script would then say "no such
  // secret" about a vault that does not exist — a wrong answer, not a halt.
  console.error(`${TAG} HALT — ${storageFile} does not exist; there is no vault to read at VAULT_STORAGE_FILE.`);
  process.exit(1);
}

const store = new VaultStore({ masterKey, storageFile });
const value = store.getSecret(secretKey);
if (value == null) process.exit(2);
process.stdout.write(JSON.stringify(value));
