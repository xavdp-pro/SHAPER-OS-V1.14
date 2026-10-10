// Intent: software/runtime/unit-mariadb/INTENT.md
// The entrypoints' refusals that need no root and no server: what the
// supervisor and the readiness probe answer before they touch anything.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV = {
  PATH: process.env.PATH,
  SHAPER_UNIT_SLUG: 'vault',
  UNIT_UID: '10610',
  UNIT_ENGINE_UID: '10611',
  UNIT_SCHEMA_FILE: '/apps/vault/app/packages/pkg-vault/sql/schema.sql',
  UNIT_SCHEMA_VERSION: '1',
  SHAPER_DB_SOCKET: '/run/vault/mysqld.sock',
};
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const run = (file, env, args = []) => spawnSync(process.execPath, [path.join(HERE, '..', file), ...args], { env, encoding: 'utf8', timeout: 10000 });

test('the supervisor refuses an invalid declaration before anything else, with its exit code', () => {
  const r = run('supervisor.mjs', { ...ENV, SHAPER_DB_SOCKET: '/run/mysqld/mysqld.sock' }, ['node', 'server.js']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\[unit-mariadb:vault\] refusing: CONFIG_INVALID — SHAPER_DB_SOCKET/);
});

test('the supervisor refuses to serve without an application command', () => {
  const r = run('supervisor.mjs', ENV, []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no application command/);
});

test('the supervisor refuses to run as anything but root, before touching the filesystem', { skip: asRoot && 'running as root' }, () => {
  const r = run('supervisor.mjs', ENV, ['node', 'server.js']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /runs as root; it starts mariadbd as mysql and the application as its own account/);
});

test('the readiness probe is not ready while the supervisor has not finished birth', { skip: fs.existsSync('/run/shaper-unit/state.json') && 'a unit runs here' }, () => {
  const r = run('ready.mjs', ENV);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, 'not ready: the supervisor has not finished birth\n');
});

test('the readiness probe refuses an invalid declaration', () => {
  const r = run('ready.mjs', { ...ENV, UNIT_UID: '0' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^not ready: CONFIG_INVALID — UNIT_UID/);
});
