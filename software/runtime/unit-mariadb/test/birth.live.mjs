// Intent: software/runtime/unit-mariadb/INTENT.md
// Live: the unit's real birth — mariadb-install-db with the runtime's own
// arguments, mariadbd with its own, then birth.mjs through the very
// operations the supervisor runs (database-ops.mjs: the root path by
// unix_socket, the schema load, the application's credential through a
// private option file) — from an empty datadir, then again on the retained
// one after a restart of the engine, for `vault` (its real schema) and for a
// hyphenated `brick-voice`.
//
// Non-regression (CT121, 11 October 2026, ERROR 1044): the credential was
// checked against the unit database before its grants converged, so every
// first birth refused, and every restart of the container found a retained
// schema and refused again.
//
// What it is not: the container. The engine and the clients run as root of a
// user namespace (one uid), not as mysql and the unit account; the account
// and layout checks are the supervisor's, proven by the universe's proof.
//
//   MARIADB_BASEDIR=<extracted MariaDB, holding usr/sbin/mariadbd> \
//     unshare -r node --test software/runtime/unit-mariadb/test/birth.live.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { birthOrKeep } from '../birth.mjs';
import { createDatabaseOps } from '../database-ops.mjs';
import { engineArgs, installDbArgs, readConfig, rootClientArgs, run } from '../lib.mjs';

const BASE = process.env.MARIADB_BASEDIR;
const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
if (!BASE || !fs.existsSync(path.join(BASE, 'usr/sbin/mariadbd'))) {
  throw new Error('MARIADB_BASEDIR must name an extracted MariaDB holding usr/sbin/mariadbd; no other database is substituted');
}
if (process.getuid() !== 0) {
  throw new Error('run it as root of a user namespace: unshare -r node --test …/birth.live.mjs (the root path authenticates by unix_socket)');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ubl-'));
const env = { PATH: `${path.join(BASE, 'usr/bin')}:${path.join(BASE, 'usr/sbin')}:/usr/bin:/bin`, HOME: root, LANG: 'C.UTF-8' };
const extra = [`--basedir=${path.join(BASE, 'usr')}`];
const serverExtra = [...extra, `--plugin-dir=${path.join(BASE, 'usr/lib/mysql/plugin')}`, `--lc-messages-dir=${path.join(BASE, 'usr/share/mariadb')}`];
const engines = [];
after(async () => {
  for (const e of engines) if (e.exitCode === null) { e.kill('SIGTERM'); await new Promise((r) => { e.once('exit', r); setTimeout(r, 20000); }); }
  fs.rmSync(root, { recursive: true, force: true });
});

function unit(slug, schemaFile, version) {
  const config = readConfig({
    SHAPER_UNIT_SLUG: slug, UNIT_UID: '10610', UNIT_ENGINE_UID: '10611', UNIT_SCHEMA_FILE: schemaFile, UNIT_SCHEMA_VERSION: String(version),
    UNIT_APPS_ROOT: path.join(root, 'apps'), UNIT_RUN_ROOT: path.join(root, 'run'),
  });
  for (const dir of [config.paths.sav, config.paths.runDir, path.join(root, 'state', slug)]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { config, password: 'e'.repeat(48) + slug.replace(/[^a-f0-9]/g, '').padEnd(16, '0').slice(0, 16), stateDir: path.join(root, 'state', slug) };
}

/** The runtime's own server arguments; one uid in a user namespace, so it runs as that root. */
async function startEngine(config) {
  const child = spawn(path.join(BASE, 'usr/sbin/mariadbd'), [...engineArgs(config.paths), ...serverExtra, '--user=root'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  child.stderr.on('data', (d) => { log += d; });
  engines.push(child);
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`mariadbd exited: ${log.slice(-1500)}`);
    const probe = await run('mariadb', [...rootClientArgs(config.paths.socket), '-e', 'SELECT 1'], { env, timeoutMs: 5000 }).catch(() => null);
    if (probe && probe.code === 0) return child;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`mariadbd did not answer: ${log.slice(-1500)}`);
}
async function stopEngine(child) {
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
}

async function bornTwice(slug, schemaFile, version) {
  const { config, password, stateDir } = unit(slug, schemaFile, version);
  const install = await run('mariadb-install-db', [...installDbArgs(config.paths).map((a) => (a === '--user=mysql' ? '--user=root' : a)), ...extra], { env, timeoutMs: 300000 });
  assert.equal(install.code, 0, install.stderr);
  const ops = createDatabaseOps({ config, password, env, stateDir });
  const lines = [];

  let engine = await startEngine(config);
  const first = await birthOrKeep({ config, fresh: true, password, ops, log: (m) => lines.push(m) });
  assert.deepEqual(first, { schema: 'applied', version });
  assert.deepEqual(await ops.checkCredential({ database: true }), { ok: true, detail: `${slug}@localhost|${slug}` });
  await stopEngine(engine);

  // The container restarts: the same datadir and password file, a new engine.
  engine = await startEngine(config);
  const second = await birthOrKeep({ config, fresh: false, password, ops, log: (m) => lines.push(m) });
  assert.deepEqual(second, { schema: 'retained', version });
  // The application's path: its own database, DML yes, DDL no.
  const file = path.join(stateDir, 'app.cnf');
  fs.writeFileSync(file, `[client]\nuser=${slug}\npassword=${password}\nsocket=${config.paths.socket}\n`, { mode: 0o600 });
  const ddl = await run('mariadb', [`--defaults-file=${file}`, '-e', 'CREATE TABLE ddl_refused (i INT)', slug], { env, timeoutMs: 10000 });
  assert.notEqual(ddl.code, 0);
  assert.match(ddl.stderr, /denied/);
  const dml = await run('mariadb', [`--defaults-file=${file}`, '-N', '-B', '-e', 'SELECT COUNT(*) FROM schema_meta', slug], { env, timeoutMs: 10000 });
  assert.equal(dml.code, 0, dml.stderr);
  fs.rmSync(file);
  assert.deepEqual(fs.readdirSync(stateDir), [], 'no option file left behind');
  await stopEngine(engine);
  return { config, ops, lines };
}

describe('a unit is born from an empty datadir, then kept across a restart, by its real birth', () => {
  test('vault, with its real schema (version 3)', async () => {
    const { lines } = await bornTwice('vault', path.join(SOFTWARE, 'packages/pkg-vault/sql/schema.sql'), 3);
    assert.ok(lines.some((l) => /^schema: applied — vault at version 3/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => /^schema: retained vault at exactly version 3/.test(l)), lines.join('\n'));
    assert.equal(lines.filter((l) => /^account: vault@localhost opens vault/.test(l)).length, 2);
  });

  test('brick-voice, a hyphenated slug (DECISIONS-20261011 §K)', async () => {
    const schema = path.join(root, 'brick-voice.sql');
    fs.writeFileSync(schema, `CREATE TABLE IF NOT EXISTS schema_meta (unit VARCHAR(64) NOT NULL PRIMARY KEY, version INT NOT NULL) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS calls (id INT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO schema_meta (unit, version) VALUES ('brick-voice', 1) ON DUPLICATE KEY UPDATE version = GREATEST(version, VALUES(version));
`);
    await bornTwice('brick-voice', schema, 1);
  });
});

describe('what the first birth used to meet', () => {
  test('a real server refuses an account its database before any grant (1044): that check cannot precede the grants', async () => {
    const { config, password, stateDir } = unit('probe', path.join(root, 'none.sql'), 1);
    const install = await run('mariadb-install-db', [...installDbArgs(config.paths).map((a) => (a === '--user=mysql' ? '--user=root' : a)), ...extra], { env, timeoutMs: 300000 });
    assert.equal(install.code, 0, install.stderr);
    const engine = await startEngine(config);
    const ops = createDatabaseOps({ config, password, env, stateDir });
    await ops.rootSql("CREATE DATABASE probe; CREATE USER 'probe'@'localhost' IDENTIFIED BY '" + password + "';");
    const opens = await ops.checkCredential({ database: true });
    assert.equal(opens.ok, false);
    assert.match(opens.detail, /ERROR 1044/);
    assert.doesNotMatch(opens.detail, new RegExp(password), 'the password never reaches a message');
    assert.deepEqual(await ops.checkCredential({ database: false }), { ok: true, detail: 'probe@localhost|' });
    await stopEngine(engine);
  });
});
