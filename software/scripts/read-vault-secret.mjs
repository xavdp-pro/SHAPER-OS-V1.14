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
 * there is NO default storage path: until the 2 September audit this script
 * read data/vault/vault.enc — the shared path every universe on a host once
 * wrote into — and answered "no such secret" about a vault nobody was using.
 * VAULT_STORAGE_FILE and VAULT_MASTER_KEY come from the shell first, then from
 * software/.env (or VAULT_ENV_FILE). What the operator exported wins over the
 * file. `npm run vault:bootstrap` prints the storage path it materialised; it
 * writes that pointer into software/.env only when it creates the file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultStore } from '../packages/pkg-vault/index.js';

const TAG = '[read-vault-secret]';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.VAULT_ENV_FILE || path.join(ROOT, '.env');

const secretKey = process.argv[2];
if (!secretKey) {
  console.error('Usage: VAULT_STORAGE_FILE=<vault.enc> node scripts/read-vault-secret.mjs <secret/key>');
  process.exit(1);
}

// The same narrow grammar the bootstrap reads: KEY=value, # comment, blank.
// Anything else halts naming the line — a skipped key surfaces later as
// "missing key" with no cause attached. The file only fills what the shell
// left unset.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      console.error(`${TAG} HALT — ${file}:${index + 1} is not KEY=value: "${raw}"`);
      process.exit(1);
    }
    const [, key, rawValue] = match;
    const quoted = rawValue.trim().match(/^(["'])(.*)\1$/);
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = quoted ? quoted[2] : rawValue.trim();
  });
}
loadDotEnv(ENV_FILE);

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
