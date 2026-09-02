import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/packages/pkg-vault/INTENT.md
// Intent: software/bricks/brick-vault/INTENT.md
// Non-regression (Rule 29): the two operator scripts around the vault —
// read-vault-secret and patch-vault-secret — still opened data/vault/vault.enc,
// the ONE shared path every universe on a host wrote into until V1.13.1 gave
// the storage file to each universe (F9, VAULT_STORAGE_FILE). Reading answered
// "no such secret" about a vault nobody used; patching created a vault nobody
// reads. Found by the 2 September audit. The scripts now demand the storage
// file explicitly, take the shell over software/.env, and halt on a vault
// that does not exist. Every case here fails on the unpatched scripts.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOFTWARE = path.resolve(HERE, '../../..');
const READ = path.join(SOFTWARE, 'scripts/read-vault-secret.mjs');
const PATCH = path.join(SOFTWARE, 'scripts/patch-vault-secret.mjs');
const { VaultStore } = await import(path.join(SOFTWARE, 'packages/pkg-vault/index.js'));

const KEY = 'ab'.repeat(32);
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-scripts-')); });
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** Runs one script with ONLY the vault variables given; software/.env is pointed at a file that does not exist. */
function run(script, args, env) {
  const clean = { ...process.env };
  for (const key of ['VAULT_MASTER_KEY', 'VAULT_TOKEN', 'VAULT_STORAGE_FILE', 'VAULT_ENV_FILE']) delete clean[key];
  return spawnSync(process.execPath, [script, ...args], {
    cwd: SOFTWARE,
    env: { ...clean, VAULT_ENV_FILE: path.join(tmp, 'no-such.env'), ...env },
    encoding: 'utf8',
  });
}

function freshVault(name) {
  const storageFile = path.join(tmp, name, 'vault.enc');
  new VaultStore({ masterKey: KEY, storageFile }).setSecret('mail/contact', { user: 'contact', pass: 'p' });
  return storageFile;
}

describe('the vault operator scripts open the vault they are pointed at, and no other', () => {
  it('reads a secret from the universe vault named by VAULT_STORAGE_FILE', () => {
    const storageFile = freshVault('read');
    const out = run(READ, ['mail/contact'], { VAULT_STORAGE_FILE: storageFile, VAULT_MASTER_KEY: KEY });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), { user: 'contact', pass: 'p' });
  });

  it('halts naming VAULT_STORAGE_FILE when no vault is named — there is no shared default any more', () => {
    const out = run(READ, ['mail/contact'], { VAULT_MASTER_KEY: KEY });
    assert.notEqual(out.status, 0, 'a script that silently opens data/vault/vault.enc answers about a vault nobody uses');
    assert.match(out.stderr, /HALT/);
    assert.match(out.stderr, /VAULT_STORAGE_FILE/, 'the halt must say what to provide');
  });

  it('patches the universe vault named by VAULT_STORAGE_FILE, and only that one', () => {
    const storageFile = freshVault('patch');
    const out = run(PATCH, ['mail/contact', JSON.stringify({ user: 'contact', pass: 'rotated' })],
      { VAULT_STORAGE_FILE: storageFile, VAULT_MASTER_KEY: KEY });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(new VaultStore({ masterKey: KEY, storageFile }).getSecret('mail/contact'), { user: 'contact', pass: 'rotated' });
    assert.equal(fs.existsSync(path.join(SOFTWARE, 'data/vault/vault.enc')) && fs.statSync(path.join(SOFTWARE, 'data/vault/vault.enc')).mtimeMs > Date.now() - 5000, false,
      'the shared path must not have been written');
  });

  it('refuses to patch a vault that does not exist instead of creating one under a stray key', () => {
    const storageFile = path.join(tmp, 'absent', 'vault.enc');
    const out = run(PATCH, ['mail/contact', '{"user":"x"}'], { VAULT_STORAGE_FILE: storageFile, VAULT_MASTER_KEY: KEY });
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /does not exist/);
    assert.equal(fs.existsSync(storageFile), false, 'patching must never materialise a vault');
  });

  it('lets an exported VAULT_MASTER_KEY win over the one in .env', () => {
    const storageFile = freshVault('shell-wins');
    const envFile = path.join(tmp, 'shell-wins.env');
    fs.writeFileSync(envFile, `VAULT_MASTER_KEY=${'cd'.repeat(32)}\nVAULT_STORAGE_FILE=${storageFile}\n`);
    const out = run(READ, ['mail/contact'], { VAULT_ENV_FILE: envFile, VAULT_MASTER_KEY: KEY });
    assert.equal(out.status, 0, `the file key would not decrypt this vault; the shell's must be the one used:\n${out.stderr}`);
    assert.deepEqual(JSON.parse(out.stdout), { user: 'contact', pass: 'p' });
  });
});
