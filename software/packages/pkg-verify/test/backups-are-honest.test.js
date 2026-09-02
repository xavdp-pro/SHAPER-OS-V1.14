import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { SCRIPTS, scratch, shimPath, dumpRecorder, shaperDir, run, nonComment } from './script-harness.js';

// Intent: software/RULES.md#rule-12

/**
 * Two scripts, one defect family: a backup that reports more than it did.
 *
 * Until V1.13, backup-local.sh archived `.env` — and so VAULT_MASTER_KEY —
 * beside the vault.enc that key decrypts, ran its tar under `2>/dev/null ||
 * true`, then printed "Backup created" and {"status":"ok"} whatever tar had
 * done; its database dump passed the password as `-p<password>` on the
 * command line and knew only one client name. snapshot-universe.sh dumped
 * with an unquoted command, no password, and `|| true`, archiving a zero-byte
 * .sql as the database. These tests run the real scripts against a throwaway
 * layout; the database client on PATH is a recorder (see script-harness.js).
 */

let tmp;
before(() => {
  tmp = scratch('shaper-backups-');
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('backup-local.sh — the key that opens the coffer does not travel with the coffer', () => {
  it('archives the vault and never .env, and reports the dump it did not take as SKIP', () => {
    const dir = shaperDir(tmp, 'local-skip', 'backup-local.sh');
    const env = { PATH: shimPath(tmp, 'local-skip'), HOME: tmp };
    const r = run(path.join(dir, 'scripts/backup-local.sh'), [], env, dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /SKIP database dump/, 'a dump that was not taken is announced');
    assert.match(r.out, /"database":"skipped"/);

    const archives = fs.readdirSync(path.join(dir, 'data/backups')).filter((f) => f.endsWith('.tar.gz'));
    assert.equal(archives.length, 1, 'exactly one archive');
    const members = execFileSync('tar', ['-tzf', path.join(dir, 'data/backups', archives[0])], { encoding: 'utf8' }).split('\n');
    assert.ok(members.includes('data/vault/vault.enc'), `the vault is in the archive:\n${members.join('\n')}`);
    assert.ok(!members.some((m) => /(^|\/)\.env$/.test(m)), `.env must never be in the archive:\n${members.join('\n')}`);
  });

  it('passes the password in MYSQL_PWD, never on the command line, and archives the dump it took', () => {
    const dir = shaperDir(tmp, 'local-dump', 'backup-local.sh');
    const log = path.join(tmp, 'local-dump.log');
    const env = {
      PATH: shimPath(tmp, 'local-dump', { 'mariadb-dump': dumpRecorder(log) }),
      HOME: tmp, MYSQL_USER: 'univ_user', MYSQL_PASSWORD: 'hunter2-not-for-ps', MYSQL_DATABASE: 'univ_db',
    };
    const r = run(path.join(dir, 'scripts/backup-local.sh'), [], env, dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /"database":"dumped"/);
    assert.equal(fs.readFileSync(`${log}.pwd`, 'utf8'), 'hunter2-not-for-ps', 'the password travels in MYSQL_PWD');
    const argv = fs.readFileSync(`${log}.argv`, 'utf8').split('\n');
    assert.ok(!argv.some((a) => /^-p/.test(a)), `no -p<password> on the command line: ${argv.join(' ')}`);
    assert.ok(!argv.join(' ').includes('hunter2'), 'the password is nowhere in argv');

    const archive = fs.readdirSync(path.join(dir, 'data/backups')).find((f) => f.endsWith('.tar.gz'));
    const members = execFileSync('tar', ['-tzf', path.join(dir, 'data/backups', archive)], { encoding: 'utf8' });
    assert.match(members, /univ_db\.sql/, 'the dump is in the archive');
  });

  it('falls back to mysqldump where only that client exists — the client is called mariadb, until it is not', () => {
    const dir = shaperDir(tmp, 'local-mysqldump', 'backup-local.sh');
    const log = path.join(tmp, 'local-mysqldump.log');
    const env = {
      PATH: shimPath(tmp, 'local-mysqldump', { mysqldump: dumpRecorder(log) }),
      HOME: tmp, MYSQL_USER: 'univ_user', MYSQL_PASSWORD: 'pw',
    };
    const r = run(path.join(dir, 'scripts/backup-local.sh'), [], env, dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /with mysqldump/);
    assert.match(fs.readFileSync(`${log}.argv`, 'utf8'), /--all-databases/);
  });

  it('fails the backup when the dump fails or comes back empty, and keeps no archive', () => {
    for (const [name, opts] of [['refused', { exit: 1, output: '' }], ['empty', { exit: 0, output: '' }]]) {
      const dir = shaperDir(tmp, `local-${name}`, 'backup-local.sh');
      const log = path.join(tmp, `local-${name}.log`);
      const env = {
        PATH: shimPath(tmp, `local-${name}`, { 'mariadb-dump': dumpRecorder(log, opts) }),
        HOME: tmp, MYSQL_USER: 'univ_user', MYSQL_PASSWORD: 'pw',
      };
      const r = run(path.join(dir, 'scripts/backup-local.sh'), [], env, dir);
      assert.notEqual(r.status, 0, `${name}: a failed dump is a failed backup\n${r.out}`);
      assert.doesNotMatch(r.out, /"status":"ok"/, `${name}: no green over a failure`);
      const backups = path.join(dir, 'data/backups');
      const kept = fs.existsSync(backups) ? fs.readdirSync(backups).filter((f) => f.endsWith('.tar.gz')) : [];
      assert.deepEqual(kept, [], `${name}: no archive survives a failed backup`);
    }
  });

  it('halts when a database is declared without its password, or without any client', () => {
    const dir = shaperDir(tmp, 'local-halt', 'backup-local.sh');
    const noPassword = run(path.join(dir, 'scripts/backup-local.sh'), [], { PATH: shimPath(tmp, 'local-halt'), HOME: tmp, MYSQL_USER: 'u' }, dir);
    assert.notEqual(noPassword.status, 0);
    assert.match(noPassword.out, /MYSQL_PASSWORD/);
    const noClient = run(path.join(dir, 'scripts/backup-local.sh'), [], { PATH: shimPath(tmp, 'local-halt-noclient'), HOME: tmp, MYSQL_USER: 'u', MYSQL_PASSWORD: 'p' }, dir);
    assert.notEqual(noClient.status, 0);
    assert.match(noClient.out, /neither mariadb-dump nor mysqldump/);
  });

  it('never silences a command — no `|| true`, no .env member, no -p on the dump', () => {
    const code = nonComment('backup-local.sh');
    assert.doesNotMatch(code, /\|\|\s*true/, '`|| true` is how tar failed and the script said ok');
    for (const line of code.split('\n')) {
      if (/\.env\b/.test(line)) assert.match(line, /--exclude/, `.env may only appear as an exclusion: ${line.trim()}`);
    }
    assert.doesNotMatch(code, /\s-p"?\$/, 'the password used to be `-p"$MYSQL_PASSWORD"` on the command line');
    assert.match(code, /MYSQL_PWD=/);
  });
});

describe('snapshot-universe.sh — an empty dump is not a database', () => {
  it('dumps with MYSQL_PWD and the client that exists, and fails the snapshot when the dump fails', () => {
    const univ = path.join(tmp, 'snap/univ-x-dev');
    fs.mkdirSync(path.join(univ, 'deploy'), { recursive: true });
    fs.writeFileSync(path.join(univ, 'manifest.json'), '{}');
    const log = path.join(tmp, 'snap.log');
    const script = path.join(SCRIPTS, 'snapshot-universe.sh');

    const ok = run(script, [univ, 'exp'], { PATH: shimPath(tmp, 'snap-ok', { mysqldump: dumpRecorder(log) }), HOME: tmp, MYSQL_USER: 'u', MYSQL_PASSWORD: 'secret-pw' }, tmp);
    assert.equal(ok.status, 0, ok.out);
    assert.equal(fs.readFileSync(`${log}.pwd`, 'utf8'), 'secret-pw');
    assert.ok(!fs.readFileSync(`${log}.argv`, 'utf8').includes('secret-pw'));
    assert.match(ok.out, /database: dumped/);
    assert.equal(fs.readdirSync(path.join(univ, 'sav/snapshots')).length, 1);

    const skip = run(script, [univ, 'exp'], { PATH: shimPath(tmp, 'snap-skip'), HOME: tmp }, tmp);
    assert.equal(skip.status, 0, skip.out);
    assert.match(skip.out, /SKIP database dump/);

    const bad = run(script, [univ, 'bad'], { PATH: shimPath(tmp, 'snap-bad', { 'mariadb-dump': dumpRecorder(log, { exit: 2, output: '' }) }), HOME: tmp, MYSQL_USER: 'u', MYSQL_PASSWORD: 'p' }, tmp);
    assert.notEqual(bad.status, 0, 'a failed dump is a failed snapshot');
    assert.ok(!fs.readdirSync(path.join(univ, 'sav/snapshots')).some((f) => f.includes('_bad_')), 'no snapshot survives a failed dump');
  });

  it('quotes the dump command and silences nothing', () => {
    const code = nonComment('snapshot-universe.sh');
    assert.doesNotMatch(code, /\|\|\s*true/);
    assert.doesNotMatch(code, /^\s*\$DUMP_CMD\s/m, 'the dump used to run as an unquoted `$DUMP_CMD`');
    assert.match(code, /MYSQL_PWD=/);
  });
});

