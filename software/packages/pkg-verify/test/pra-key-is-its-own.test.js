import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { SCRIPTS, scratch, shimPath, shaperDir, run, nonComment } from './script-harness.js';

// Intent: software/RULES.md#rule-12

/**
 * Until V1.13 backup-pra-sync.sh encrypted the backup with VAULT_MASTER_KEY
 * whenever no PRA_ENCRYPTION_KEY was given — so a backup broken once handed
 * over the key to every vault.enc it carried — and passed whichever key it
 * used as `-k <key>`, on a command line every process on the host can read.
 * The key is now required, refused when it is the vault key, and reaches
 * openssl through the environment.
 */

let tmp;
before(() => {
  tmp = scratch('shaper-pra-');
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('backup-pra-sync.sh — the backup key is its own key', () => {
  const script = path.join(SCRIPTS, 'backup-pra-sync.sh');

  it('refuses to run without PRA_ENCRYPTION_KEY, and refuses the vault master key as that key', () => {
    const missing = run(script, [], { PATH: shimPath(tmp, 'pra-missing'), HOME: tmp, VAULT_MASTER_KEY: 'vault-key' }, tmp);
    assert.notEqual(missing.status, 0);
    assert.match(missing.out, /PRA_ENCRYPTION_KEY/);

    const same = run(script, [], { PATH: shimPath(tmp, 'pra-same'), HOME: tmp, VAULT_MASTER_KEY: 'vault-key', PRA_ENCRYPTION_KEY: 'vault-key' }, tmp);
    assert.equal(same.status, 1, same.out);
    assert.match(same.out, /must not be the vault master key/);
  });

  it('refuses the vault master key read from .env on disk, when nobody exported it', () => {
    // A cron job never sources .env. Until V1.13.3 the refusal compared the PRA
    // key with VAULT_MASTER_KEY only when that variable was exported, so an
    // operator who reused the vault key ran through unseen whenever the vault
    // key lived only in the .env beside the script — where Rule 0J puts it.
    const dir = shaperDir(tmp, 'pra-disk', 'backup-pra-sync.sh');
    fs.writeFileSync(path.join(dir, '.env'), '# keys\nexport VAULT_MASTER_KEY="the-key-that-opens-the-coffer"\nJWT_SECRET=other\n');
    fs.mkdirSync(path.join(dir, 'data/backups'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data/backups/backup_20250101_000000.tar.gz'), 'bytes');
    const env = { PATH: shimPath(tmp, 'pra-disk'), HOME: tmp, PRA_ENCRYPTION_KEY: 'the-key-that-opens-the-coffer' };
    const r = run(path.join(dir, 'scripts/backup-pra-sync.sh'), [], env, dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /must not be the vault master key/);
    assert.match(r.out, /\.env/, 'the refusal says where the vault key was found');
    assert.ok(!fs.existsSync(path.join(dir, 'data/backups/backup_20250101_000000.tar.gz.enc')), 'nothing was encrypted with the vault key');
  });

  it('encrypts the latest backup with the key from the environment, and the archive decrypts with it', () => {
    const dir = shaperDir(tmp, 'pra-run', 'backup-pra-sync.sh');
    fs.mkdirSync(path.join(dir, 'data/backups'), { recursive: true });
    const plain = path.join(dir, 'data/backups/backup_20250101_000000.tar.gz');
    fs.writeFileSync(plain, 'not-really-a-tarball-but-bytes-are-bytes');
    const env = { PATH: shimPath(tmp, 'pra-run'), HOME: tmp, VAULT_MASTER_KEY: 'vault-key', PRA_ENCRYPTION_KEY: 'backup-only-key' };
    const r = run(path.join(dir, 'scripts/backup-pra-sync.sh'), [], env, dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /"replicated":false/, 'not replicated is said, not implied');
    const back = execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', `${plain}.enc`, '-pass', 'env:PRA_ENCRYPTION_KEY'], { env: { PATH: process.env.PATH, PRA_ENCRYPTION_KEY: 'backup-only-key' } });
    assert.equal(back.toString(), 'not-really-a-tarball-but-bytes-are-bytes');
  });

  it('hands the key to openssl through the environment, never as -k, and never falls back to VAULT_MASTER_KEY', () => {
    const code = nonComment('backup-pra-sync.sh');
    assert.match(code, /-pass env:PRA_ENCRYPTION_KEY/);
    assert.doesNotMatch(code, /openssl[^\n]*\s-k\s/, '`-k <key>` put the key on the command line');
    assert.doesNotMatch(code, /PRA_ENCRYPTION_KEY:-/, 'the backup key used to default to VAULT_MASTER_KEY');
    assert.match(code, /PRA_ENCRYPTION_KEY:\?/);
    assert.doesNotMatch(code, /\|\|\s*true/);
  });
});

