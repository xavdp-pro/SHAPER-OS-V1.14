#!/usr/bin/env node
/**
 * Live test runner: one throwaway MariaDB server, the four base units
 * provisioned on it the way the administrative path provisions a unit, and the
 * given live test files run against it. Everything is removed afterwards.
 *
 *   MARIADB_BASEDIR=<dir holding usr/sbin/mariadbd> \
 *     node software/packages/pkg-db/test/live/run-live.mjs \
 *     software/packages/pkg-<unit>/test/<name>.live.mjs …
 *
 * What it builds, per unit slug (vault, logger, queue, maestro): a database and
 * an account of that name, the account granted SELECT, INSERT, UPDATE and
 * DELETE on its own database only, its schema installed by root, and its
 * password written to <apps>/<slug>/etc/mysql/localhost/passwd (0600). The
 * server listens on a private Unix socket only (--skip-networking).
 *
 * What it is not: the unit's container. Application and MariaDB here run as
 * the current user on one workstation, so this proves the services' SQL,
 * transactions, outbox and recovery against a real server (Rule 0G) — not the
 * Rule 26 container inventory, which belongs to the universe's qualification.
 *
 * Root administers through the socket without a password: acceptable for a
 * server that lives in a private temporary directory for one run, never a
 * provisioning recipe.
 *
 * Intent: software/packages/pkg-db/INTENT.md#live-tests
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIVE_UNITS = ['vault', 'logger', 'queue', 'maestro'];
const here = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES = path.resolve(here, '../../..');

export const schemaFile = (slug) => path.join(PACKAGES, `pkg-${slug}`, 'sql', 'schema.sql');

function fail(message) {
  console.error(`[live] ${message}`);
  process.exit(2);
}

async function waitFor(predicate, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) fail('no live test file given');
  const base = process.env.MARIADB_BASEDIR;
  if (!base || !fs.existsSync(path.join(base, 'usr/sbin/mariadbd'))) {
    fail('MARIADB_BASEDIR must name a directory holding usr/sbin/mariadbd (an extracted MariaDB server); no other database is substituted');
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-live-'));
  // A Unix socket path is limited to 107 bytes: keep it short.
  const runDir = fs.mkdtempSync(path.join(process.env.XDG_RUNTIME_DIR && fs.existsSync(process.env.XDG_RUNTIME_DIR) ? process.env.XDG_RUNTIME_DIR : os.tmpdir(), 'slv-'));
  const socket = path.join(runDir, 'mysqld.sock');
  const dataDir = path.join(root, 'data');
  const appsRoot = path.join(root, 'apps');
  fs.chmodSync(root, 0o700);
  fs.chmodSync(runDir, 0o700);

  let server = null;
  let code = 1;
  try {
    const install = spawnSync(path.join(base, 'usr/bin/mariadb-install-db'), [
      '--no-defaults', `--basedir=${path.join(base, 'usr')}`, `--datadir=${dataDir}`,
      '--auth-root-authentication-method=normal', '--skip-test-db',
    ], { encoding: 'utf8' });
    if (install.status !== 0) throw new Error(`mariadb-install-db failed: ${install.stderr || install.stdout}`);

    server = spawn(path.join(base, 'usr/sbin/mariadbd'), [
      '--no-defaults', `--basedir=${path.join(base, 'usr')}`, `--datadir=${dataDir}`,
      `--socket=${socket}`, `--pid-file=${path.join(runDir, 'mysqld.pid')}`, '--skip-networking',
      `--plugin-dir=${path.join(base, 'usr/lib/mysql/plugin')}`, `--lc-messages-dir=${path.join(base, 'usr/share/mariadb')}`,
      `--log-error=${path.join(root, 'mariadbd.err')}`,
    ], { stdio: 'ignore' });
    let exited = false;
    server.on('exit', () => { exited = true; });
    await waitFor(() => exited || fs.existsSync(socket), 30000, 'the MariaDB socket');
    if (exited) throw new Error(`mariadbd exited: ${fs.readFileSync(path.join(root, 'mariadbd.err'), 'utf8').slice(-2000)}`);

    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection({ socketPath: socket, user: 'root', multipleStatements: true });
    const [[{ version }]] = await admin.query('SELECT VERSION() AS version');
    for (const slug of LIVE_UNITS) {
      const password = crypto.randomBytes(24).toString('base64url');
      await admin.query(`CREATE DATABASE \`${slug}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
      await admin.query('CREATE USER ?@? IDENTIFIED BY ?', [slug, 'localhost', password]);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${slug}\`.* TO ?@?`, [slug, 'localhost']);
      await admin.query(`USE \`${slug}\``);
      await admin.query(fs.readFileSync(schemaFile(slug), 'utf8'));
      const passwd = path.join(appsRoot, slug, 'etc/mysql/localhost/passwd');
      fs.mkdirSync(path.dirname(passwd), { recursive: true, mode: 0o700 });
      fs.writeFileSync(passwd, `${password}\n`, { mode: 0o600 });
    }
    await admin.end();
    console.log(`[live] MariaDB ${version} on ${socket} (no TCP); units ${LIVE_UNITS.join(', ')} provisioned with DML-only grants`);

    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
      stdio: 'inherit',
      env: { ...process.env, SHAPER_LIVE_SOCKET: socket, SHAPER_LIVE_APPS_ROOT: appsRoot, SHAPER_LIVE_WORKDIR: root },
    });
    code = await new Promise((resolve) => child.on('exit', (c, signal) => resolve(signal ? 1 : c)));
  } catch (err) {
    console.error(`[live] ${err.message}`);
    code = 1;
  } finally {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 20000); });
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
