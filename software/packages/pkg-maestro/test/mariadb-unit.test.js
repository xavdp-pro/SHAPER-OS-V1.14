import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { MaestroScheduler, createMaestroServer, storeErrorStatus } from '../index.js';
import { MAESTRO_SCHEMA_VERSION, msOf, sqlTime } from '../mariadb-store.js';
import { MISSED_POLICIES, OCCURRENCE_STATES, ScheduleError } from '../occurrence.js';
import { UnitDbError } from '../../pkg-db/index.js';

// Intent: software/packages/pkg-maestro/INTENT.md#private-mariadb
// Non-regression (Rule 29): Maestro's schedules, timer phase and counters lived
// only in process memory, and a restart re-armed every timer from zero with no
// record of which instants had already been handed to Queue (Rule 26 could not
// qualify it). These tests hold the MariaDB path's contract where no database
// is needed — schema, refusals, 503 mapping, brick shape. Persistence, restart
// and idempotency are proven live by the universe against the real database.

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(here, '..');
const brickDir = path.join(pkgDir, '../../bricks/brick-maestro');
const schema = fs.readFileSync(path.join(pkgDir, 'sql/schema.sql'), 'utf8');
const sqlOnly = schema.replace(/--.*$/gm, '');

describe('the schema belongs to the administrative path', () => {
  it('creates every table idempotently, as ordinary InnoDB', () => {
    const creates = [...sqlOnly.matchAll(/CREATE TABLE\s+(IF NOT EXISTS\s+)?(\w+)/g)];
    assert.deepEqual(creates.map((m) => m[2]).sort(), ['event_outbox', 'occurrences', 'recovery_points', 'schedule_revisions', 'schedules', 'schema_meta']);
    for (const m of creates) assert.ok(m[1], `${m[2]} is not created IF NOT EXISTS`);
    assert.equal((sqlOnly.match(/ENGINE=InnoDB/g) || []).length, creates.length);
    assert.doesNotMatch(sqlOnly, /PARTITION/i, 'active responsibility is not partitioned; archival is a declared gap');
  });

  it('grants nothing, creates no account and alters nothing', () => {
    assert.doesNotMatch(sqlOnly, /\b(GRANT|REVOKE|CREATE USER|IDENTIFIED|ALTER|DROP|TRUNCATE)\b/i);
  });

  it('records the version the store requires, without lowering a newer one', () => {
    const m = sqlOnly.match(/INSERT INTO schema_meta \(unit, version\) VALUES \('maestro', (\d+)\)\s+ON DUPLICATE KEY UPDATE version = GREATEST\(version, VALUES\(version\)\)/);
    assert.ok(m, 'an idempotent schema_meta row for maestro');
    assert.equal(Number(m[1]), MAESTRO_SCHEMA_VERSION);
  });

  it('makes the occurrence identity the primary key and one instant per schedule revision unique', () => {
    assert.match(sqlOnly, /occurrence_id\s+CHAR\(68\)[^,]*PRIMARY KEY/);
    assert.match(sqlOnly, /UNIQUE KEY \w+ \(schedule_id, revision, planned_at\)/);
    assert.match(sqlOnly, /schedule_id\s+VARCHAR\(191\)[^,]*PRIMARY KEY/, 'one current row per schedule');
  });

  it('knows exactly the states and policies the code knows', () => {
    const states = sqlOnly.match(/CHECK \(state IN \(([^)]+)\)\)/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
    assert.deepEqual(states.sort(), [...OCCURRENCE_STATES].sort());
    const policies = sqlOnly.match(/CHECK \(missed_policy IN \(([^)]+)\)\)/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
    assert.deepEqual(policies.sort(), [...MISSED_POLICIES].sort());
    assert.match(sqlOnly, /missed_policy\s+VARCHAR\(32\)\s+NOT NULL,/, 'the policy has no default: it is stored explicitly');
  });

  it('keeps instants as DATETIME written by the application, never a session-zone TIMESTAMP', () => {
    for (const column of ['planned_at', 'next_due_at', 'last_planned_at', 'anchor_at', 'enqueued_at', 'last_attempt_at']) {
      assert.match(sqlOnly, new RegExp(`\\b${column}\\s+DATETIME\\(3\\)`), column);
    }
    const t = Date.parse('2026-09-24T10:05:00.123Z');
    assert.equal(sqlTime(t), '2026-09-24 10:05:00.123');
    assert.equal(msOf('2026-09-24 10:05:00.123'), t, 'read back as UTC, whatever the host zone');
  });

  it('the application issues no DDL', () => {
    for (const file of ['mariadb-store.js', 'durable-scheduler.js', 'server.js', 'index.js']) {
      const text = fs.readFileSync(path.join(pkgDir, file), 'utf8');
      assert.doesNotMatch(text, /\b(CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE DATABASE|GRANT)\b/, file);
    }
  });
});

describe('the durable path goes through Queue only, and never lists Queue', () => {
  const durable = ['durable-scheduler.js', 'mariadb-store.js', 'occurrence.js']
    .map((f) => fs.readFileSync(path.join(pkgDir, f), 'utf8')).join('\n');

  it('has no direct-to-bridge execution', () => {
    assert.doesNotMatch(durable, /pkg-agent-runtime\/index\.js|createAgentRuntimeHandler|\/api\/inject/);
  });

  it('asks Queue about a job only by its idempotency key', () => {
    const reads = [...durable.matchAll(/\/api\/jobs([^`'"]*)/g)].map((m) => m[1]);
    assert.ok(reads.length >= 2);
    for (const suffix of reads) {
      assert.ok(suffix === '' || suffix.startsWith('?idempotencyKey='), `unexpected Queue path /api/jobs${suffix}`);
    }
    // The only bare /api/jobs is the POST.
    assert.match(durable, /\/api\/jobs`, \{\s*method: 'POST'/);
  });
});

describe('a storage failure is an unavailable Maestro, not a bad request', () => {
  const dbDown = () => new UnitDbError('DB_UNAVAILABLE', 'private MariaDB refused or unreachable: ECONNREFUSED');

  it('maps database errors to 503 and named refusals to their status', () => {
    assert.equal(storeErrorStatus(dbDown()), 503);
    for (const code of ['ER_LOCK_DEADLOCK', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'POOL_CLOSED', 'ETIMEDOUT']) {
      assert.equal(storeErrorStatus(Object.assign(new Error('x'), { code })), 503, code);
    }
    assert.equal(storeErrorStatus(new ScheduleError('INVALID_SCHEDULE', 'x')), 400);
    assert.equal(storeErrorStatus(new ScheduleError('SCHEDULE_UNKNOWN', 'x', 404)), 404);
    assert.equal(storeErrorStatus(new Error('plain')), 500);
    // Non-regression (Rule 29): with its MariaDB stopped, the socket file is
    // gone and the driver fails connect() with ENOENT; Maestro answered 500.
    for (const code of ['ENOENT', 'EACCES']) {
      const gone = Object.assign(new Error(`connect ${code} /run/mysqld/mysqld.sock`), { code, syscall: 'connect', address: '/run/mysqld/mysqld.sock' });
      assert.equal(storeErrorStatus(gone), 503, `${code} on connect is storage unavailable`);
    }
    assert.equal(storeErrorStatus(Object.assign(new Error('no file'), { code: 'ENOENT', syscall: 'open' })), 500, 'a missing file elsewhere is not the database');
  });

  it('answers 503 with a typed code on every route when its database is gone', async () => {
    const fail = async () => { throw dbDown(); };
    const scheduler = {
      service: 'brick-maestro',
      isRunning: false,
      health: async () => ({ ok: false, body: { status: 'unavailable', db: { ok: false, error: 'ECONNREFUSED' } } }),
      vitals: fail,
      listRegisteredTasks: fail,
      registerTask: fail,
      triggerBeat: fail,
      listOccurrences: fail,
      startScheduler: () => Promise.resolve(null),
      stopScheduler: () => {},
    };
    await withServer(scheduler, async (base) => {
      const health = await fetch(`${base}/api/health`);
      assert.equal(health.status, 503);
      assert.equal((await health.json()).status, 'unavailable');

      for (const [method, route, body] of [
        ['GET', '/api/tasks'],
        ['GET', '/api/vitals'],
        ['GET', '/api/occurrences?schedule=task-proof'],
        ['POST', '/api/tasks/register', { slug: 'task-proof', cadenceSeconds: 60 }],
        ['POST', '/api/tasks/task-proof/tick'],
      ]) {
        const res = await fetch(`${base}${route}`, { method, body: body ? JSON.stringify(body) : undefined });
        assert.equal(res.status, 503, `${method} ${route}`);
        const json = await res.json();
        assert.equal(json.code, 'DB_UNAVAILABLE', `${method} ${route}`);
        assert.equal(json.error, 'Maestro storage unavailable');
      }
    });
  });

  it('refuses a malformed request with 400 and an unknown schedule with 404, before any storage answer', async () => {
    const scheduler = {
      service: 'brick-maestro',
      isRunning: false,
      health: async () => ({ ok: true, body: { status: 'ok' } }),
      listOccurrences: async () => { throw new Error('must not be reached'); },
      registerTask: async (task) => { throw new ScheduleError('INVALID_SCHEDULE', `bad ${task.slug}`); },
      triggerBeat: async (slug) => { throw new ScheduleError('SCHEDULE_UNKNOWN', `Task not registered in Maestro: ${slug}`, 404); },
    };
    await withServer(scheduler, async (base) => {
      assert.equal((await fetch(`${base}/api/occurrences?state=DONE`)).status, 400);
      assert.equal((await fetch(`${base}/api/occurrences?limit=100000`)).status, 400);
      const reg = await fetch(`${base}/api/tasks/register`, { method: 'POST', body: '{"slug":"x"}' });
      assert.equal(reg.status, 400);
      assert.equal((await reg.json()).code, 'INVALID_SCHEDULE');
      assert.equal((await fetch(`${base}/api/tasks/register`, { method: 'POST', body: '{not json' })).status, 400);
      const tick = await fetch(`${base}/api/tasks/task-none/tick`, { method: 'POST' });
      assert.equal(tick.status, 404);
      assert.equal((await tick.json()).code, 'SCHEDULE_UNKNOWN');
    });
  });

  it('says plainly that the memory scaffolding records no occurrence', async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-mem-'));
    try {
      await withServer(new MaestroScheduler({ logDir }), async (base) => {
        const res = await fetch(`${base}/api/occurrences`);
        assert.equal(res.status, 501);
        assert.equal((await res.json()).code, 'NO_DURABLE_STORE');
      });
    } finally {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });
});

describe('the entrypoint refuses to start rather than fall back', () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-entry-'));
  after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const run = (env) => spawnSync(process.execPath, [path.join(pkgDir, 'server.js')], {
    env: { PATH: process.env.PATH, MAESTRO_PORT: '0', HOST: '127.0.0.1', LOG_DIR: logDir, ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
  const durable = { SHAPER_UNIVERSE_ID: 'univ-proof-dev', MAESTRO_QUEUE_URL: 'http://127.0.0.1:9' };

  it('defaults to MariaDB and needs the universe identity', () => {
    const r = run({ MAESTRO_QUEUE_URL: 'http://127.0.0.1:9' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: UNIVERSE_ID_MISSING/);
    const bad = run({ ...durable, SHAPER_UNIVERSE_ID: 'univ|proof' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /refusing to start: UNIVERSE_ID_INVALID/);
  });

  it('needs a queue, and never falls back to the bridge', () => {
    const r = run({ SHAPER_UNIVERSE_ID: 'univ-proof-dev', MAESTRO_BRIDGE_URL: 'http://127.0.0.1:4330' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: QUEUE_URL_MISSING/);
  });

  // SOL-DECISIONS-2 §M: the bridge token is a private file, never an
  // environment value on MariaDB, and no refusal prints it.
  it('refuses BRIDGE_AUTH_TOKEN as an environment value, reads it from its private file', () => {
    const token = 'c5'.repeat(32);
    const inEnv = run({ ...durable, BRIDGE_AUTH_TOKEN: token });
    assert.equal(inEnv.status, 1);
    assert.match(inEnv.stderr, /refusing to start: SECRET_IN_ENVIRONMENT — BRIDGE_AUTH_TOKEN is set/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-token-'));
    try {
      const file = path.join(dir, 'BRIDGE_AUTH_TOKEN');
      fs.writeFileSync(file, token, { mode: 0o400 });
      const byFile = run({ ...durable, BRIDGE_AUTH_TOKEN_FILE: file });
      assert.equal(byFile.status, 1);
      assert.match(byFile.stderr, /refusing to start: PASSWD_MISSING/, 'the token stage passed');
      for (const r of [inEnv, byFile]) assert.ok(!r.stderr.includes(token) && !r.stdout.includes(token));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to start on MariaDB without its passwd file, and says why', () => {
    const r = run(durable);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: PASSWD_MISSING/);
  });

  it('refuses a declaration it does not understand before touching the database', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-decl-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'task-schedule.json');
    fs.writeFileSync(file, JSON.stringify({ tasks: [{ slug: 'task-proof', cadenceSeconds: 60, missedPolicy: 'halt' }] }));
    const r = run({ ...durable, MAESTRO_TASKS_FILE: file });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: INVALID_SCHEDULE — missedPolicy "halt"/);
    assert.doesNotMatch(r.stderr, /PASSWD/);

    const missing = run({ ...durable, MAESTRO_TASKS_FILE: path.join(dir, 'absent.json') });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /refusing to start: TASKS_FILE_MISSING/);
  });

  it('refuses an unknown store', () => {
    const r = run({ MAESTRO_STORE: 'sqlite' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /MAESTRO_STORE must be "mariadb" or "memory"/);
  });

  it('runs the in-memory scaffolding only when asked, and says what it is', async () => {
    const child = spawn(process.execPath, [path.join(pkgDir, 'server.js')], {
      env: { PATH: process.env.PATH, MAESTRO_PORT: '0', HOST: '127.0.0.1', LOG_DIR: logDir, MAESTRO_STORE: 'memory' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no Ready line; stdout=${out} stderr=${err}`)), 8000);
        child.stdout.on('data', () => { if (/Ready/.test(out)) { clearTimeout(timer); resolve(); } });
        child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited ${code}: ${err}`)); });
      });
      assert.match(err, /DEV scaffolding: MAESTRO_STORE=memory/);
    } finally {
      child.kill('SIGTERM');
    }
  });
});

describe('the brick runs Maestro as its own account on its own database', () => {
  // The one-container shape (Rule 4, Turbinobash method; runtime/unit-mariadb):
  // Maestro and its own MariaDB server in one container, the supervisor
  // dropping to each account. The shape shared by every base unit is held by
  // runtime/unit-mariadb/test/units-contract.test.mjs; what is Maestro's own is
  // held here.
  const containerfile = fs.readFileSync(path.join(brickDir, 'Containerfile'), 'utf8');
  const brick = JSON.parse(fs.readFileSync(path.join(brickDir, 'brick.json'), 'utf8'));
  const quadlet = fs.readFileSync(path.join(brickDir, 'cfg-maestro.container'), 'utf8');
  const app = '/apps/maestro/app/packages';

  it('declares the unit the image births, with the schema version this store needs', () => {
    assert.deepEqual(brick.unit, {
      slug: 'maestro', uid: 10630, engineUid: 10631, database: 'mariadb-in-unit',
      schema: `${app}/pkg-maestro/sql/schema.sql`, schemaVersion: MAESTRO_SCHEMA_VERSION,
      volumes: ['etc/mysql', 'sav'],
    });
    assert.ok(fs.existsSync(path.join(pkgDir, 'sql/schema.sql')));
    assert.match(containerfile, new RegExp(`^\\s+UNIT_SCHEMA_VERSION=${MAESTRO_SCHEMA_VERSION} \\\\$`, 'm'));
    assert.ok(containerfile.includes(`LABEL org.shaper.unit.schema-version="${MAESTRO_SCHEMA_VERSION}"`));
  });

  it('puts pkg-db where ../pkg-db/ resolves, with its pinned driver installed there, and pkg-auth beside it', () => {
    for (const pkg of ['pkg-db', 'pkg-auth', 'pkg-logger', 'pkg-maestro']) {
      assert.ok(containerfile.includes(`COPY --from=shaper_base /shaper/packages/${pkg}/ ${app}/${pkg}/`), `${pkg} copied`);
    }
    assert.match(containerfile, new RegExp(`cd ${app}/pkg-db && npm ci --omit=dev`));
    assert.match(containerfile, new RegExp(`^WORKDIR ${app}/pkg-maestro$`, 'm'));
  });

  it('runs as maestro under the unit supervisor, on MariaDB by default, with no local log', () => {
    assert.match(containerfile, /adduser -S -D -H -h \/apps\/maestro -s \/sbin\/nologin -u "\$\{UNIT_UID\}" -G maestro maestro/);
    assert.match(containerfile, /^\s+MAESTRO_STORE=mariadb \\$/m);
    assert.match(containerfile, /^\s+SHAPER_UNIT_SLUG=maestro \\$/m);
    assert.match(containerfile, /^\s+SHAPER_DB_SOCKET=\/run\/maestro\/mysqld\.sock \\$/m);
    assert.doesNotMatch(containerfile, /^USER /m, 'the supervisor is root and starts Maestro as its own account');
    // The durable path writes no JSONL audit: LOG_DIR serves the memory scaffolding only.
    assert.doesNotMatch(containerfile, /LOG_DIR/);
  });

  it('runs one container: no log volume, no socket mount, localhost, the universe UUID and its credential inputs', () => {
    assert.doesNotMatch(quadlet, /^User=/m);
    assert.match(quadlet, /^Network=host$/m);
    assert.match(quadlet, /^Environment=HOST=127\.0\.0\.1$/m);
    assert.match(quadlet, /^Environment=SHAPER_UNIVERSE_ID=@UNIVERSE_ID@$/m);
    assert.match(quadlet, /^Environment=SHAPER_UNIT_INCARNATION=@INCARNATION@$/m);
    assert.match(quadlet, /^Environment=MAESTRO_QUEUE_URL=\S+$/m);
    assert.match(quadlet, /^Environment=LOGGER_URL=\S+$/m);
    assert.match(quadlet, /^Environment=VAULT_URL=\S+$/m);
    assert.match(quadlet, /^Environment=UNIT_BOOTSTRAP_TOKEN_FILE=\/apps\/maestro\/etc\/identity\/bootstrap$/m);
    assert.match(quadlet, /^Environment=UNIT_AUTH_PUBLIC_KEY_FILE=\/apps\/maestro\/etc\/identity\/vault-signing\.pub$/m);
    assert.match(quadlet, /^Volume=\/apps\/maestro\/etc\/mysql:\/apps\/maestro\/etc\/mysql:Z$/m);
    assert.match(quadlet, /^Volume=\/apps\/maestro\/sav:\/apps\/maestro\/sav:Z$/m);
    assert.doesNotMatch(quadlet, /^Volume=\/apps\/maestro\/log/m, 'no log volume: the outbox is the record');
    assert.doesNotMatch(quadlet, /^Volume=[^\n]*:\/run/m, 'the socket stays inside the container');
    assert.doesNotMatch(quadlet, /^PublishPort=/m);
    assert.doesNotMatch(quadlet, /MAESTRO_BRIDGE_URL|MAESTRO_STORE=memory|SHAPER_UNIVERSE_ID=%i/);
  });
});

// allowAnonymous: these prove storage refusals and request validation, not
// authorization (that is test/authorization.test.js).
async function withServer(scheduler, work) {
  const server = createMaestroServer({ port: 0, host: '127.0.0.1', scheduler, allowAnonymous: true });
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await work(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}
