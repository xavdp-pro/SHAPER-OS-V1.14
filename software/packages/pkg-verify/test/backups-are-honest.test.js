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
  it('archives the vault and never .env in any spelling, and reports the dump it did not take as SKIP', () => {
    const dir = shaperDir(tmp, 'local-skip', 'backup-local.sh');
    // Rule 0J propagates .env under several names (deploy/env, deploy/<slug>.env,
    // .env.local…). Every one of them holds the key that opens the coffer, and
    // until V1.13.3 only the bare `.env` and `*.env` spellings were excluded:
    // `.env.local` and `.env.production` under data/ travelled with vault.enc.
    for (const copy of ['data/sub/.env.local', 'data/.env.production', 'data/deploy/univ-x-dev.env', 'data/deploy/env']) {
      fs.mkdirSync(path.dirname(path.join(dir, copy)), { recursive: true });
      fs.writeFileSync(path.join(dir, copy), 'VAULT_MASTER_KEY=the-key-that-opens-the-coffer\n');
    }
    const env = { PATH: shimPath(tmp, 'local-skip'), HOME: tmp };
    const r = run(path.join(dir, 'scripts/backup-local.sh'), [], env, dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /SKIP database dump/, 'a dump that was not taken is announced');
    assert.match(r.out, /"database":"skipped"/);

    const archives = fs.readdirSync(path.join(dir, 'data/backups')).filter((f) => f.endsWith('.tar.gz'));
    assert.equal(archives.length, 1, 'exactly one archive');
    const members = execFileSync('tar', ['-tzf', path.join(dir, 'data/backups', archives[0])], { encoding: 'utf8' }).split('\n');
    assert.ok(members.includes('data/vault/vault.enc'), `the vault is in the archive:\n${members.join('\n')}`);
    const envLike = members.filter((m) => /(^|\/)\.env[^/]*$/.test(m) || /\.env$/.test(m));
    assert.deepEqual(envLike, [], `no .env, .env.<anything> or <anything>.env may be in the archive:\n${members.join('\n')}`);
    assert.ok(!members.some((m) => m.startsWith('data/_staging_dump')), `no staging directory for a dump that was not taken:\n${members.join('\n')}`);
  });

  it('keeps the archive it announced when a step after it fails, and prints no status over it', () => {
    // Until V1.13.3 the exit trap deleted the archive on any non-zero exit —
    // including one caused by the rotation step, which runs after the archive
    // is complete, checksummed and announced. "Backup created" on the log and
    // "no archive was kept" on disk is a data loss caused by housekeeping.
    const dir = shaperDir(tmp, 'local-rotation', 'backup-local.sh');
    const env = { PATH: shimPath(tmp, 'local-rotation', {}, { omit: ['find'] }), HOME: tmp };
    const r = run(path.join(dir, 'scripts/backup-local.sh'), [], env, dir);
    assert.notEqual(r.status, 0, 'a rotation that cannot run is still a failure');
    assert.match(r.out, /Backup created/);
    assert.doesNotMatch(r.out, /"status":"ok"/, 'no green after a failure');
    assert.doesNotMatch(r.out, /no archive was kept/, 'the archive was complete when the rotation failed');
    const kept = fs.readdirSync(path.join(dir, 'data/backups')).filter((f) => f.endsWith('.tar.gz'));
    assert.equal(kept.length, 1, `the announced archive survives the failed rotation:\n${r.out}`);
    assert.match(r.out, /was kept/, 'and the operator is told so');
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
    assert.match(code, /--exclude=['"]?\.env\*/, 'the exclusion covers .env.local, .env.<slug> — every spelling, not the bare name');
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
    const goodDump = '-- dump\nCREATE TABLE t (id INT);\n';
    const dumpsOnDisk = () => fs.readdirSync(path.join(univ, 'sav/db')).sort();

    const ok = run(script, [univ, 'exp'], { PATH: shimPath(tmp, 'snap-ok', { mysqldump: dumpRecorder(log, { output: goodDump }) }), HOME: tmp, MYSQL_USER: 'u', MYSQL_PASSWORD: 'secret-pw' }, tmp);
    assert.equal(ok.status, 0, ok.out);
    assert.equal(fs.readFileSync(`${log}.pwd`, 'utf8'), 'secret-pw');
    assert.ok(!fs.readFileSync(`${log}.argv`, 'utf8').includes('secret-pw'));
    assert.match(ok.out, /database: dumped/);
    assert.equal(fs.readdirSync(path.join(univ, 'sav/snapshots')).length, 1);
    const [taken] = dumpsOnDisk();
    assert.equal(dumpsOnDisk().length, 1, 'the dump that was taken is on disk, and nothing else');

    // A client that dies half-way used to leave its partial output under
    // sav/db/dump_auto_<ts>.sql: the trap removed the snapshot, not the dump,
    // and the next snapshot — a SKIP one included — archived the truncated file
    // as the database. The defect of the unquoted `|| true`, moved one run later.
    const bad = run(script, [univ, 'bad'], { PATH: shimPath(tmp, 'snap-bad', { 'mariadb-dump': dumpRecorder(log, { exit: 2, output: '-- partial' }) }), HOME: tmp, MYSQL_USER: 'u', MYSQL_PASSWORD: 'p' }, tmp);
    assert.notEqual(bad.status, 0, 'a failed dump is a failed snapshot');
    assert.ok(!fs.readdirSync(path.join(univ, 'sav/snapshots')).some((f) => f.includes('_bad_')), 'no snapshot survives a failed dump');
    assert.deepEqual(dumpsOnDisk(), [taken], `a failed dump leaves no file behind for the next snapshot to archive:\n${bad.out}`);
    assert.equal(fs.readFileSync(path.join(univ, 'sav/db', taken), 'utf8'), goodDump, 'and the dump that was taken is intact');

    const skip = run(script, [univ, 'skip'], { PATH: shimPath(tmp, 'snap-skip'), HOME: tmp }, tmp);
    assert.equal(skip.status, 0, skip.out);
    assert.match(skip.out, /SKIP database dump/);
    const skipArchive = fs.readdirSync(path.join(univ, 'sav/snapshots')).find((f) => f.includes('_skip_'));
    const underDb = execFileSync('tar', ['-tzf', path.join(univ, 'sav/snapshots', skipArchive)], { encoding: 'utf8' })
      .split('\n').filter((m) => /sav\/db\/.+/.test(m));
    assert.deepEqual(underDb, [`univ-x-dev/sav/db/${taken}`], 'the SKIP snapshot carries only the dump that was really taken');
  });

  it('quotes the dump command and silences nothing', () => {
    const code = nonComment('snapshot-universe.sh');
    assert.doesNotMatch(code, /\|\|\s*true/);
    assert.doesNotMatch(code, /^\s*\$DUMP_CMD\s/m, 'the dump used to run as an unquoted `$DUMP_CMD`');
    assert.match(code, /MYSQL_PWD=/);
  });
});

