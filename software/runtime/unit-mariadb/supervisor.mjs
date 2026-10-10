#!/usr/bin/env node
// Intent: software/runtime/unit-mariadb/INTENT.md
/**
 * The functional unit's container process: one application and its private
 * MariaDB server, two processes in one container (Rule 4, Turbinobash method).
 *
 * Runs as root — the container's administrative path — and never runs
 * application code itself:
 *
 *   1. checks the declared accounts and the Rule 4 layout, and that the
 *      application cannot modify or replace the data, socket, password or
 *      administrative paths, writable ancestors included;
 *   2. births the datadir once (mariadb-install-db, as mysql), or keeps it —
 *      an existing datadir of another owner is refused, never chowned;
 *   3. starts mariadbd as mysql, socket only (--skip-networking), and waits
 *      for THAT process to answer the root path — not any server on the socket;
 *   4. births or keeps the database through the root path (./birth.mjs);
 *   5. starts the application as its own account (UNIT_MODE=serve), or stops
 *      after birth (birth), or keeps only the database up (database);
 *   6. on SIGTERM: the application drains first, then MariaDB shuts down
 *      (./lifecycle.mjs). If either process ends on its own, the other is
 *      stopped in the same order and the container exits, so its restart
 *      policy recreates both together.
 *
 * Usage (the image's ENTRYPOINT, under tini; CMD is the application):
 *   supervisor.mjs node server.js
 */
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { birthOrKeep } from './birth.mjs';
import {
  EXIT, STATE_DIR, UnitError,
  applicationEnv, assertPassword, assertProtectedFrom, engineArgs, exitCodeOf, installDbArgs,
  readConfig, redact, resolveAccounts, rootClientArgs, run,
} from './lib.mjs';
import { stopInOrder, terminate, track } from './lifecycle.mjs';

const ENGINE_PATH = '/usr/sbin:/usr/bin:/sbin:/bin';
const secrets = [];
let slugForLog = process.env.SHAPER_UNIT_SLUG || 'unit';

function log(message) {
  process.stderr.write(`[unit-mariadb:${slugForLog}] ${redact(message, secrets)}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const engineEnv = (home) => ({ PATH: ENGINE_PATH, HOME: home, LANG: 'C.UTF-8' });

// ── State shared with the readiness probe (root-only directory) ───────────
function writeState(state) {
  const file = path.join(STATE_DIR, 'state.json');
  const tmp = `${file}.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...state, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const clearState = () => fs.rmSync(path.join(STATE_DIR, 'state.json'), { force: true });

// ── Layout (single entries only; never a recursive ownership change) ──────
function ensureDir(p, { uid, gid, mode }) {
  let stat;
  try {
    stat = fs.lstatSync(p);
  } catch (err) {
    if (err.code !== 'ENOENT') throw new UnitError('LAYOUT_UNSAFE', `${p}: ${err.code || err.message}`, EXIT.LAYOUT);
    fs.mkdirSync(p, { mode });
    stat = fs.lstatSync(p);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new UnitError('LAYOUT_UNSAFE', `${p} must be a real directory`, EXIT.LAYOUT);
  }
  if (stat.uid !== uid || stat.gid !== gid) {
    fs.chownSync(p, uid, gid);
    log(`layout: ${p} owner converged to ${uid}:${gid}`);
  }
  if ((stat.mode & 0o7777) !== mode) {
    fs.chmodSync(p, mode);
    log(`layout: ${p} mode converged to ${mode.toString(8).padStart(4, '0')}`);
  }
}

function prepareLayout(config, accounts) {
  const p = config.paths;
  const { app, engine } = accounts;
  ensureDir(p.home, { uid: 0, gid: 0, mode: 0o755 });
  ensureDir(p.etc, { uid: 0, gid: 0, mode: 0o755 });
  ensureDir(p.etcMysql, { uid: 0, gid: 0, mode: 0o755 });
  ensureDir(p.credDir, { uid: 0, gid: app.gid, mode: 0o750 });
  ensureDir(p.sav, { uid: 0, gid: 0, mode: 0o755 });
  ensureDir(p.log, { uid: app.uid, gid: app.gid, mode: 0o750 });
  ensureDir(p.nosav, { uid: app.uid, gid: app.gid, mode: 0o750 });

  // The datadir: created here only when absent. An existing one must already
  // belong to this image's engine account — no recursive chown repairs it.
  let stat = null;
  try {
    stat = fs.lstatSync(p.datadir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (!stat) {
    fs.mkdirSync(p.datadir, { mode: 0o700 });
    fs.chownSync(p.datadir, engine.uid, engine.gid);
    fs.chmodSync(p.datadir, 0o700);
    log(`layout: datadir ${p.datadir} created for mysql (${engine.uid})`);
  } else {
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new UnitError('LAYOUT_UNSAFE', `${p.datadir} must be a real directory`, EXIT.LAYOUT);
    }
    if (stat.uid !== engine.uid) {
      throw new UnitError(
        'DATADIR_OWNER_MISMATCH',
        `${p.datadir} belongs to uid ${stat.uid}; this image's engine account is ${engine.uid}. No recursive ownership change is made: restore a logical dump into a fresh volume (UNIT_RESTORE_DUMP), or a human decides.`,
        EXIT.LAYOUT,
      );
    }
    if ((stat.mode & 0o7777) !== 0o700) fs.chmodSync(p.datadir, 0o700);
  }

  // The socket directory is runtime only: rebuilt at every start, owned by the
  // engine, traversable by the unit's group and by nobody else.
  fs.rmSync(p.runDir, { recursive: true, force: true });
  fs.mkdirSync(p.runDir, { mode: 0o750 });
  fs.chownSync(p.runDir, engine.uid, app.gid);
  fs.chmodSync(p.runDir, 0o750);

  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.chownSync(STATE_DIR, 0, 0);
  fs.chmodSync(STATE_DIR, 0o700);
  clearState();
}

/** Rule 4, Turbinobash point 2 — observed before anything starts. */
function assertProtected(config, accounts) {
  const p = config.paths;
  const checks = [
    [p.datadir, 'data directory'],
    [p.runDir, 'socket directory'],
    [p.credDir, 'password directory'],
    [config.schemaFile, 'schema'],
    [path.dirname(new URL(import.meta.url).pathname), 'administrative runtime'],
    [STATE_DIR, 'supervisor state'],
  ];
  for (const candidate of ['/etc/my.cnf', '/etc/my.cnf.d', '/root']) {
    if (fs.existsSync(candidate)) checks.push([candidate, 'administrative configuration']);
  }
  if (fs.existsSync('/etc/my.cnf.d')) {
    for (const entry of fs.readdirSync('/etc/my.cnf.d')) checks.push([path.join('/etc/my.cnf.d', entry), 'administrative configuration']);
  }
  if (config.restoreDump) checks.push([config.restoreDump, 'restore dump']);
  for (const [target, what] of checks) assertProtectedFrom(target, accounts.app, { what });
  log(`layout: data, socket, password, schema and administrative paths are not writable by ${accounts.app.name}`);
}

// ── The password file ─────────────────────────────────────────────────────
function ensurePassword(config, accounts, fresh) {
  const file = config.paths.passwd;
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw new UnitError('PASSWD_INVALID', `${file}: ${err.code || err.message}`, EXIT.PASSWD);
  }
  if (!stat) {
    if (!fresh) {
      throw new UnitError(
        'PASSWD_MISSING_FOR_EXISTING_DATABASE',
        `${file} is absent but the database already exists. A new password would silently rotate the account: restore the file, or rotate through the explicit procedure.`,
        EXIT.PASSWD,
      );
    }
    const password = crypto.randomBytes(32).toString('hex');
    secrets.push(password);
    const tmp = path.join(config.paths.credDir, `.passwd.${crypto.randomBytes(6).toString('hex')}`);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeSync(fd, `${password}\n`);
      fs.fchownSync(fd, accounts.app.uid, accounts.app.gid);
      fs.fchmodSync(fd, 0o600);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    log(`password: generated once into ${file} (0600, ${accounts.app.name})`);
    return password;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new UnitError('PASSWD_INVALID', `${file} must be a regular file`, EXIT.PASSWD);
  if (stat.uid !== accounts.app.uid) throw new UnitError('PASSWD_INVALID', `${file} belongs to uid ${stat.uid}; Rule 4 requires ${accounts.app.name} (${accounts.app.uid})`, EXIT.PASSWD);
  if ((stat.mode & 0o7777) !== 0o600) throw new UnitError('PASSWD_INVALID', `${file} has mode ${(stat.mode & 0o7777).toString(8)}; Rule 4 requires 0600`, EXIT.PASSWD);
  const password = fs.readFileSync(file, 'utf8').replace(/\n$/, '');
  assertPassword(password);
  secrets.push(password);
  log(`password: ${file} kept (0600, ${accounts.app.name})`);
  return password;
}

// ── The engine ────────────────────────────────────────────────────────────
async function rootSql(config, sql, { database = null, what = 'statement' } = {}) {
  const result = await run('mariadb', rootClientArgs(config.paths.socket, { database }), {
    input: sql, env: engineEnv('/root'), timeoutMs: 3600000,
  });
  if (result.code !== 0) {
    throw new UnitError('ROOT_PATH_FAILED', `${what}: ${redact(result.stderr.trim() || `exit ${result.code}`, secrets)}`, EXIT.ENGINE);
  }
  return result.stdout;
}

async function initEngine(config, accounts) {
  log('engine: first birth — mariadb-install-db as mysql, root by unix_socket, no test database');
  const result = await run('mariadb-install-db', installDbArgs(config.paths), {
    uid: accounts.engine.uid, gid: accounts.engine.gid, env: engineEnv(config.paths.datadir), timeoutMs: 600000,
  });
  if (result.code !== 0) {
    throw new UnitError('ENGINE_INIT_FAILED', `mariadb-install-db failed: ${result.stderr.trim().split('\n').slice(-5).join(' / ')}`, EXIT.ENGINE);
  }
}

function startEngine(config, accounts) {
  const child = track(spawn('mariadbd', engineArgs(config.paths), {
    uid: accounts.engine.uid,
    gid: accounts.engine.gid,
    env: engineEnv(config.paths.datadir),
    detached: true, // its own process group: only this supervisor signals it, in order
    stdio: ['ignore', 'inherit', 'inherit'],
  }));
  log(`engine: mariadbd started as mysql (${accounts.engine.uid}), pid ${child.pid}, socket ${config.paths.socket}, no TCP`);
  return child;
}

/**
 * Port of c0ab540's init-vs-ready distinction, for one container: the server
 * that answers must be the process this supervisor started — the pid file
 * names our child and the server reports that pid file — and the root path
 * must work through the socket.
 */
async function waitEngineReady(config, engine, abort) {
  const deadline = Date.now() + config.engineStartSeconds * 1000;
  while (Date.now() < deadline) {
    abort();
    if (!engine.alive) throw new UnitError('ENGINE_NOT_READY', 'mariadbd exited before it accepted connections', EXIT.ENGINE);
    let pid = null;
    try {
      pid = Number(fs.readFileSync(config.paths.pidFile, 'utf8').trim());
    } catch { /* not written yet */ }
    if (pid === engine.pid) {
      const probe = await run('mariadb', [...rootClientArgs(config.paths.socket), '-e', 'SELECT @@pid_file'], { env: engineEnv('/root'), timeoutMs: 10000 });
      if (probe.code === 0 && probe.stdout.trim() === config.paths.pidFile) {
        log(`engine: ready — pid ${engine.pid} answers root by unix_socket on ${config.paths.socket}`);
        return;
      }
    }
    await sleep(250);
  }
  throw new UnitError('ENGINE_NOT_READY', `mariadbd did not answer within ${config.engineStartSeconds}s`, EXIT.ENGINE);
}

function databaseOps(config, password) {
  const load = async (input, what, code, exitCode) => {
    const result = await run('mariadb', rootClientArgs(config.paths.socket, what === 'schema' ? { database: config.slug } : {}), {
      input, env: engineEnv('/root'), timeoutMs: 3600000,
    });
    if (result.code !== 0) {
      throw new UnitError(code, `the ${what} did not load: ${redact(result.stderr.trim().split('\n').slice(-3).join(' / '), secrets)}`, exitCode);
    }
  };
  return {
    rootSql: (sql, options) => rootSql(config, sql, options),
    loadSchema: () => load(fs.readFileSync(config.schemaFile), 'schema', 'SCHEMA_APPLY_FAILED', EXIT.SCHEMA_APPLY),
    loadDump: async () => {
      const stat = fs.lstatSync(config.restoreDump);
      if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o077)) {
        throw new UnitError('RESTORE_FAILED', `${config.restoreDump} must be a regular file owned by root and private to it`, EXIT.RESTORE);
      }
      const dump = fs.readFileSync(config.restoreDump);
      log(`restore: loading ${config.restoreDump} (${dump.length} bytes, sha256 ${crypto.createHash('sha256').update(dump).digest('hex').slice(0, 16)}…) through the root path into a fresh datadir`);
      await load(dump, 'dump', 'RESTORE_FAILED', EXIT.RESTORE);
    },
    // The application's own credential, through a client option file private
    // to root and removed at once: never on a command line.
    checkCredential: async () => {
      const file = path.join(STATE_DIR, `.client-${crypto.randomBytes(6).toString('hex')}.cnf`);
      const fd = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeSync(fd, `[client]\nuser=${config.slug}\npassword=${password}\nsocket=${config.paths.socket}\n`);
      } finally {
        fs.closeSync(fd);
      }
      try {
        const result = await run('mariadb', [`--defaults-file=${file}`, '--batch', '--skip-column-names', '-e', "SELECT CONCAT(CURRENT_USER(), '|', IFNULL(DATABASE(), ''))", config.slug], {
          env: engineEnv('/root'), timeoutMs: 30000,
        });
        const answer = result.stdout.trim();
        const ok = result.code === 0 && answer === `${config.slug}@localhost|${config.slug}`;
        return { ok, detail: redact(result.stderr.trim() || answer, secrets) };
      } finally {
        fs.rmSync(file, { force: true });
      }
    },
  };
}

// ── The application ───────────────────────────────────────────────────────
function startApplication(config, accounts, argv) {
  const [command, ...args] = argv;
  const child = track(spawn(command, args, {
    uid: accounts.app.uid,
    gid: accounts.app.gid,
    cwd: process.cwd(),
    env: applicationEnv(process.env, { slug: config.slug, home: config.paths.home, socket: config.paths.socket }),
    detached: true, // its own process group: only this supervisor signals it, in order
    stdio: ['ignore', 'inherit', 'inherit'],
  }));
  child.on('error', (err) => log(`application: cannot start ${command}: ${err.code || err.message}`));
  log(`application: ${argv.join(' ')} started as ${accounts.app.name} (${accounts.app.uid}), pid ${child.pid}`);
  return child;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const config = readConfig(process.env);
  slugForLog = config.slug;
  if (config.mode === 'serve' && argv.length === 0) {
    throw new UnitError('CONFIG_INVALID', 'no application command: the image CMD names it', EXIT.CONFIG);
  }
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new UnitError('CONFIG_INVALID', 'the supervisor is the administrative path and runs as root; it starts mariadbd as mysql and the application as its own account', EXIT.CONFIG);
  }
  const accounts = resolveAccounts(config, fs.readFileSync('/etc/passwd', 'utf8'), fs.readFileSync('/etc/group', 'utf8'));
  log(`starting in mode ${config.mode}: ${config.slug} (${accounts.app.uid}) with its own MariaDB as mysql (${accounts.engine.uid})`);

  let stopping = null;
  let birthDone = false;
  let engine = null;
  let app = null;
  // During birth a stop request is honoured at the next step boundary; after
  // birth, the coordinated stop takes over.
  const abort = () => { if (stopping) throw new UnitError('STOP_REQUESTED', `stop requested (${stopping}) during birth`, 143); };

  let shutdownPromise = null;
  const shutdown = (reason, exitCode) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      log(`stopping: ${reason}`);
      writeState({ phase: 'stopping', slug: config.slug, enginePid: engine?.pid ?? null, appPid: app?.pid ?? null });
      const { drained, clean } = await stopInOrder({
        app, engine, drainSeconds: config.drainSeconds, engineStopSeconds: config.engineStopSeconds, log,
      });
      clearState();
      log(`stopped: application ${app ? (drained ? 'drained' : 'killed') : 'not running'}, then MariaDB ${clean ? 'shut down cleanly' : 'killed'}`);
      process.exit(exitCode ?? (drained && clean ? EXIT.OK : EXIT.APP_FAILED));
    })();
    return shutdownPromise;
  };
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      if (!stopping) stopping = signal;
      if (birthDone) shutdown(`${signal} received`, undefined);
    });
  }

  prepareLayout(config, accounts);
  assertProtected(config, accounts);
  const fresh = !fs.existsSync(path.join(config.paths.datadir, 'mysql'));
  if (config.restoreDump && !fresh) {
    throw new UnitError('RESTORE_REQUIRES_FRESH_DATADIR', `UNIT_RESTORE_DUMP is honoured only by a fresh datadir; ${config.paths.datadir} already holds a database`, EXIT.RESTORE);
  }
  const password = ensurePassword(config, accounts, fresh);
  abort();

  try {
    if (fresh) await initEngine(config, accounts);
    abort();
    engine = startEngine(config, accounts);
    await waitEngineReady(config, engine, abort);
    await birthOrKeep({ config, fresh, password, ops: databaseOps(config, password), abort, log });
  } catch (err) {
    if (engine) {
      const { graceful } = await terminate(engine, config.engineStopSeconds);
      log(`engine: ${graceful ? 'shut down cleanly' : 'killed'} after the refusal below`);
    }
    throw err;
  }
  birthDone = true;
  writeState({ phase: 'database-ready', slug: config.slug, enginePid: engine.pid, appPid: null });

  engine.exited.then(({ code, signal }) => {
    if (!shutdownPromise) {
      log(`engine: mariadbd ended on its own (${signal || `exit ${code}`}) — the application is stopped and the container exits`);
      shutdown('MariaDB is gone', EXIT.ENGINE_LOST);
    }
  });

  if (stopping) return shutdown(`${stopping} received during birth`, 143);
  if (config.mode === 'birth') return shutdown('birth complete (UNIT_MODE=birth)', EXIT.OK);
  if (config.mode === 'database') {
    writeState({ phase: 'database-only', slug: config.slug, enginePid: engine.pid, appPid: null });
    log('database only (UNIT_MODE=database): no application; stop the container to end');
    return undefined;
  }

  app = startApplication(config, accounts, argv);
  writeState({ phase: 'running', slug: config.slug, enginePid: engine.pid, appPid: app.pid });
  app.exited.then(({ code, signal }) => {
    if (!shutdownPromise) {
      log(`application: ended on its own (${signal || `exit ${code}`}) — MariaDB is stopped cleanly and the container exits`);
      shutdown('the application is gone', exitCodeOf(code, signal) || EXIT.APP_FAILED);
    }
  });
  return undefined;
}

main().catch((err) => {
  const code = err instanceof UnitError ? err.code : 'UNEXPECTED';
  if (code === 'STOP_REQUESTED') log(`stopped during birth: ${err.message}; MariaDB was shut down first`);
  else log(`refusing: ${code} — ${err.message}`);
  process.exit(err instanceof UnitError ? err.exitCode : EXIT.APP_FAILED);
});
