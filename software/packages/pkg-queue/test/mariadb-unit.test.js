import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { JobQueue, createQueueServer } from '../index.js';
import {
  QueueError,
  canonicalJson,
  normalizeCreateRequest,
  queueErrorStatus,
  replayOrConflict,
  requestDigest,
  transitionDetail,
  validateIdempotencyKey,
} from '../job-contract.js';
import {
  JOB_COLUMN_NAMES,
  MariaDbJobQueue,
  QUEUE_SCHEMA_VERSION,
  duplicateKeyTarget,
  jobToParams,
  rowToJob,
} from '../mariadb-store.js';
import { startQueueAgentWorker } from '../worker.js';

// Intent: software/packages/pkg-queue/INTENT.md#private-mariadb
// Non-regression (Rule 29): the Queue kept its jobs in a Map, appended JSONL,
// logged a failed write and still answered success, and skipped a line it
// could not parse — no functional-unit gate could qualify it (Rule 26), and a
// retried enqueue created a second job. These tests hold the MariaDB path's
// contract where no database is needed: the schema the administrative path
// installs, the idempotency decision, the 503 answer when the database is
// gone, the refusal to start without one. Persistence, the concurrent enqueue
// under one key and restart survival are proven live by the universe's proof,
// against the real private MariaDB (Rule 0G).

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '../server.js');
const schema = fs.readFileSync(path.join(here, '../sql/schema.sql'), 'utf8');
const sql = schema.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');

/** name → { columns, options } for every CREATE TABLE in the schema. */
const tables = Object.fromEntries([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\)\s*ENGINE=InnoDB([^;]*);/g)]
  .map((m) => [m[1], { columns: m[2], options: m[3] }]));

const listening = (server) => new Promise((resolve) => server.once('listening', resolve));
const base = (server) => `http://127.0.0.1:${server.address().port}`;
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patch = (url, body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('the schema belongs to the administrative path', () => {
  it('creates every table idempotently, and records its version idempotently', () => {
    const creates = [...sql.matchAll(/CREATE TABLE\s+(IF NOT EXISTS\s+)?(\w+)/g)];
    assert.deepEqual(creates.map((m) => m[2]).sort(), ['job_transitions', 'jobs', 'schema_meta']);
    for (const m of creates) assert.ok(m[1], `${m[2]} is not created IF NOT EXISTS`);
    const meta = sql.match(/INSERT INTO schema_meta \(unit, version\) VALUES \('queue', (\d+)\)\s+ON DUPLICATE KEY UPDATE/);
    assert.ok(meta, 'schema_meta row for queue, re-runnable');
    assert.equal(Number(meta[1]), QUEUE_SCHEMA_VERSION);
  });

  it('grants nothing, creates no account and alters nothing: that is provisioning, not schema', () => {
    assert.doesNotMatch(sql, /\b(GRANT|REVOKE|CREATE USER|IDENTIFIED|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('partitions the append-only history monthly, and never the active jobs table', () => {
    assert.doesNotMatch(tables.jobs.options, /PARTITION/i, 'jobs carries the UNIQUE idempotency key and live state: not partitioned');
    assert.doesNotMatch(tables.schema_meta.options, /PARTITION/i);

    const history = tables.job_transitions.options;
    assert.match(history, /PARTITION BY RANGE COLUMNS \(recorded_at\)/);
    const partitions = [...history.matchAll(/PARTITION (\w+) VALUES LESS THAN \(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
    const expected = [];
    for (let y = 2026, mo = 8; y < 2027 || mo <= 3; mo === 12 ? (y += 1, mo = 1) : (mo += 1)) {
      const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
      expected.push([`p${y}_${String(mo).padStart(2, '0')}`, `'${next}-01 00:00:00'`]);
    }
    expected.push(['p_future', 'MAXVALUE']);
    assert.deepEqual(partitions, expected);
  });

  it('keeps the partition column in every unique key of the history, and holds no foreign key anywhere', () => {
    assert.match(tables.job_transitions.columns, /PRIMARY KEY \(transition_id, recorded_at\)/);
    assert.doesNotMatch(tables.job_transitions.columns, /UNIQUE/i);
    assert.match(tables.job_transitions.columns, /recorded_at\s+DATETIME\(3\)\s+NOT NULL/, 'RANGE COLUMNS needs DATETIME, not TIMESTAMP');
    assert.doesNotMatch(sql, /FOREIGN KEY|REFERENCES/i);
  });

  it('holds every column the store writes, with the idempotency key unique and the reads indexed', () => {
    for (const column of JOB_COLUMN_NAMES) {
      assert.match(tables.jobs.columns, new RegExp(`^\\s+${column}\\s`, 'm'), `jobs has no column ${column}`);
    }
    assert.match(tables.jobs.columns, /UNIQUE KEY jobs_idempotency_key \(idempotency_key\)/);
    assert.match(tables.jobs.columns, /idempotency_key\s+VARCHAR\(190\)\s+NULL/);
    assert.match(tables.jobs.columns, /request_digest\s+CHAR\(64\)\s+NOT NULL/);
    for (const index of [/KEY jobs_status \(status/, /KEY jobs_type \(type/, /KEY jobs_created \(created_at\)/, /KEY jobs_updated \(updated_at\)/]) {
      assert.match(tables.jobs.columns, index);
    }
  });
});

describe('the idempotency key has one grammar', () => {
  it('accepts 1 to 190 characters from [A-Za-z0-9._:-], including a Maestro occurrence id', () => {
    for (const key of ['a', 'A.b_c:d-9', `occ-${'f'.repeat(64)}`, 'k'.repeat(190)]) {
      assert.equal(validateIdempotencyKey(key), key);
    }
  });

  it('refuses anything else with IDEMPOTENCY_KEY_INVALID (400)', () => {
    for (const key of ['', 'k'.repeat(191), 'has space', 'é', 'a/b', "a'b", null, 5, {}, ['a']]) {
      assert.throws(() => validateIdempotencyKey(key), (err) => err.code === 'IDEMPOTENCY_KEY_INVALID' && queueErrorStatus(err) === 400, JSON.stringify(key));
    }
    assert.throws(() => normalizeCreateRequest({ type: 't', idempotencyKey: null }), { code: 'IDEMPOTENCY_KEY_INVALID' });
  });
});

describe('the request digest names the logical request, not its spelling', () => {
  const digest = (request) => requestDigest(normalizeCreateRequest(request));

  it('ignores key order at every depth', () => {
    const a = { type: 'agent.inject', totalSteps: 2, payload: { message: 'm', nested: { x: 1, y: [1, { b: 2, a: 1 }] } } };
    const b = { payload: { nested: { y: [1, { a: 1, b: 2 }], x: 1 }, message: 'm' }, totalSteps: 2, type: 'agent.inject' };
    assert.equal(digest(a), digest(b));
    assert.equal(canonicalJson(a.payload), canonicalJson(b.payload));
  });

  it('applies the defaults before hashing: an absent totalSteps is 1, an absent contractType is null', () => {
    assert.equal(digest({ type: 't', payload: {} }), digest({ type: 't', payload: {}, totalSteps: 1, contractType: null }));
    assert.equal(digest({ type: 't' }), digest({ type: 't', payload: {} }));
  });

  it('changes with anything the request asks for, array order included', () => {
    const reference = digest({ type: 't', payload: { list: [1, 2] } });
    assert.notEqual(reference, digest({ type: 't', payload: { list: [2, 1] } }));
    assert.notEqual(reference, digest({ type: 'u', payload: { list: [1, 2] } }));
    assert.notEqual(reference, digest({ type: 't', payload: { list: [1, 2] }, totalSteps: 2 }));
    assert.notEqual(reference, digest({ type: 't', payload: { list: [1, 2] }, contractType: 'code' }));
    assert.match(reference, /^[0-9a-f]{64}$/);
  });

  it('does not depend on the idempotency key itself', () => {
    assert.equal(digest({ type: 't', idempotencyKey: 'a' }), digest({ type: 't', idempotencyKey: 'b' }));
  });
});

describe('a replay is answered from the job that holds the key', () => {
  const existing = { id: 'job-1', requestDigest: 'a'.repeat(64) };

  it('same digest: the original job, duplicate, nothing new (200)', () => {
    const answer = replayOrConflict(existing, 'a'.repeat(64), 'k');
    assert.equal(answer.job, existing);
    assert.equal(answer.duplicate, true);
  });

  it('another digest: IDEMPOTENCY_CONFLICT naming the job (409)', () => {
    assert.throws(() => replayOrConflict(existing, 'b'.repeat(64), 'k'), (err) => {
      assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(err.jobId, 'job-1');
      assert.equal(queueErrorStatus(err), 409);
      return true;
    });
  });

  it('knows which unique key an INSERT collided with, whatever the key value says', () => {
    const dup = (sqlMessage) => Object.assign(new Error(sqlMessage), { code: 'ER_DUP_ENTRY', errno: 1062, sqlMessage });
    assert.equal(duplicateKeyTarget(dup("Duplicate entry 'occ-1' for key 'jobs_idempotency_key'")), 'idempotency_key');
    assert.equal(duplicateKeyTarget(dup("Duplicate entry 'occ-1' for key 'jobs.jobs_idempotency_key'")), 'idempotency_key');
    assert.equal(duplicateKeyTarget(dup("Duplicate entry 'PRIMARY' for key 'jobs_idempotency_key'")), 'idempotency_key');
    assert.equal(duplicateKeyTarget(dup("Duplicate entry 'jobs_idempotency_key' for key 'PRIMARY'")), 'primary');
    assert.equal(duplicateKeyTarget(Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' })), null);
  });
});

describe('a row is read back exactly, or refused with a typed integrity error', () => {
  const job = {
    id: 'job-1790000000000-0a1b2c3d4e5f',
    type: 'agent.inject',
    payload: { message: 'Reply PONG', conversation: 'c1', nested: [1, { a: null }] },
    contractType: null,
    status: 'COMPLETED',
    progress: 100,
    step: 2,
    totalSteps: 2,
    createdAt: '2026-09-24T08:15:30.120Z',
    updatedAt: '2026-09-24T08:15:31.004Z',
    result: { answer: 'PONG', exit_code: 0 },
    error: null,
    qualityGateStatus: 'NEEDS_CONTRACT',
    idempotencyKey: 'occ-abc',
    requestDigest: 'c'.repeat(64),
  };
  // The shape the pool hands back: dateStrings, JSON as text.
  const asRow = (record) => Object.fromEntries(JOB_COLUMN_NAMES.map((name, i) => [name, jobToParams(record)[i]]));

  it('maps a job to its row and back without loss', () => {
    assert.deepEqual(rowToJob(asRow(job)), job);
    assert.deepEqual(rowToJob(asRow({ ...job, result: null, idempotencyKey: null, error: 'boom' })).error, 'boom');
  });

  it('refuses a row it cannot read, naming the job — never skips it', () => {
    const cases = [
      { ...asRow(job), payload: '{not json' },
      { ...asRow(job), created_at: 'yesterday' },
      { ...asRow(job), request_digest: 'short' },
      { ...asRow(job), step: 'two' },
      { ...asRow(job), idempotency_key: 'has space' },
    ];
    for (const row of cases) {
      assert.throws(() => rowToJob(row), (err) => {
        assert.ok(err instanceof QueueError);
        assert.equal(err.code, 'QUEUE_ROW_INVALID');
        assert.equal(err.jobId, job.id);
        assert.equal(queueErrorStatus(err), 500);
        return true;
      });
    }
  });

  it('keeps a history row bounded, whatever the error text', () => {
    const detail = transitionDetail('updated', { ...job, error: null }, { ...job, error: '\u0000'.repeat(50000) });
    assert.ok(detail.length <= 1024, `detail is ${detail.length} characters`);
    assert.doesNotThrow(() => JSON.parse(detail));
    assert.doesNotMatch(transitionDetail('created', null, job), /PONG/, 'history never copies the result');
  });
});

describe('a storage failure is an unavailable queue, never a success', () => {
  it('maps database errors to 503 and request errors to their own status', () => {
    assert.equal(queueErrorStatus(Object.assign(new Error('x'), { name: 'UnitDbError', code: 'DB_UNAVAILABLE' })), 503);
    for (const code of ['ER_ACCESS_DENIED_ERROR', 'ECONNREFUSED', 'ENOENT', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT']) {
      assert.equal(queueErrorStatus(Object.assign(new Error('x'), { code })), 503, code);
    }
    assert.equal(queueErrorStatus(new Error('plain')), 500);
    assert.equal(queueErrorStatus(new QueueError('INVALID_JOB_REQUEST', 'x')), 400);
    assert.equal(queueErrorStatus(new QueueError('JOB_NOT_FOUND', 'x')), 404);
  });

  describe('the MariaDB store over HTTP, with its database gone', () => {
    // The real store and the real server; only the socket is gone. Every call
    // the pool receives fails as the driver fails when the socket file is
    // absent. Nothing here stores anything: it proves the refusal path only.
    const gone = () => Object.assign(new Error('connect ENOENT /run/mysqld/mysqld.sock'), { code: 'ENOENT', fatal: true });
    const deadPool = {
      getConnection: async () => { throw gone(); },
      execute: async () => { throw gone(); },
      query: async () => { throw gone(); },
      end: async () => {},
    };
    const audits = [];
    let server;
    let store;
    const events = [];

    before(async () => {
      store = new MariaDbJobQueue({
        pool: deadPool,
        loggerUrl: 'http://127.0.0.1:1',
        fetchImpl: async (url, opts) => { audits.push(JSON.parse(opts.body).event); return { ok: true, json: async () => ({}) }; },
      });
      for (const name of ['jobCreated', 'jobUpdated', 'statusChange']) store.on(name, (job) => events.push([name, job.id]));
      server = createQueueServer({ port: 0, host: '127.0.0.1', queue: store });
      await listening(server);
    });

    after(() => server.close());

    it('answers 503 with a typed code on every write and read, and emits nothing', async () => {
      const created = await post(`${base(server)}/api/jobs`, { type: 'agent.inject', payload: { message: 'm' }, idempotencyKey: 'occ-1' });
      assert.equal(created.status, 503);
      const body = await created.json();
      assert.equal(body.code, 'ENOENT');
      assert.equal(body.error, 'Queue storage unavailable');

      const plain = await post(`${base(server)}/api/jobs`, { type: 'agent.inject', payload: { message: 'm' } });
      assert.equal(plain.status, 503, 'without a key the INSERT itself must be refused, not assumed');

      const updated = await patch(`${base(server)}/api/jobs/job-1`, { status: 'COMPLETED' });
      assert.equal(updated.status, 503);
      for (const url of ['/api/jobs', '/api/jobs?idempotencyKey=occ-1', '/api/jobs/job-1', '/api/capacity']) {
        assert.equal((await fetch(`${base(server)}${url}`)).status, 503, url);
      }
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(events, [], 'no success event for a state that was never committed');
      assert.deepEqual(audits, [], 'no audit line for a job that does not exist');
    });

    it('says so on health and vitals', async () => {
      const health = await fetch(`${base(server)}/api/health`);
      assert.equal(health.status, 503);
      const h = await health.json();
      assert.equal(h.status, 'unavailable');
      assert.equal(h.db.ok, false);
      const v = await fetch(`${base(server)}/api/vitals`);
      assert.equal(v.status, 503);
      assert.equal((await v.json()).checks.storage.ok, false);
    });
  });
});

describe('the HTTP idempotency contract (memory store, selected explicitly)', () => {
  const audits = [];
  const streamed = [];
  let server;
  let queue;

  before(async () => {
    queue = new JobQueue({
      loggerUrl: 'http://127.0.0.1:1',
      fetchImpl: async (url, opts) => { audits.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({}) }; },
    });
    queue.on('jobCreated', (job) => streamed.push(job.id));
    server = createQueueServer({ port: 0, host: '127.0.0.1', queue });
    await listening(server);
  });

  after(() => server.close());

  it('creates once, replays the original, refuses a different request, and finds the job by key', async () => {
    const request = { type: 'agent.inject', totalSteps: 2, payload: { message: 'm', conversation: 'c' }, idempotencyKey: 'occ-http-1' };
    const first = await post(`${base(server)}/api/jobs`, request);
    assert.equal(first.status, 201);
    const a = await first.json();
    assert.equal(a.status, 'ok');
    assert.equal(a.duplicate, false);
    assert.equal(a.job.idempotencyKey, 'occ-http-1');

    // Same logical request, spelled differently.
    const replay = await post(`${base(server)}/api/jobs`, {
      idempotencyKey: 'occ-http-1', payload: { conversation: 'c', message: 'm' }, totalSteps: 2, type: 'agent.inject',
    });
    assert.equal(replay.status, 200);
    const b = await replay.json();
    assert.equal(b.duplicate, true);
    assert.equal(b.job.id, a.job.id);

    const conflict = await post(`${base(server)}/api/jobs`, { ...request, payload: { message: 'other' } });
    assert.equal(conflict.status, 409);
    const c = await conflict.json();
    assert.equal(c.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(c.jobId, a.job.id);
    assert.ok(c.error);

    const found = await (await fetch(`${base(server)}/api/jobs?idempotencyKey=occ-http-1`)).json();
    assert.deepEqual(found.jobs.map((j) => j.id), [a.job.id]);
    const none = await (await fetch(`${base(server)}/api/jobs?idempotencyKey=occ-unknown`)).json();
    assert.deepEqual(none, { status: 'ok', jobs: [] });

    const jobs = (await (await fetch(`${base(server)}/api/jobs`)).json()).jobs.filter((j) => j.idempotencyKey === 'occ-http-1');
    assert.equal(jobs.length, 1, 'a replay creates nothing');
    assert.deepEqual(streamed.filter((id) => id === a.job.id), [a.job.id], 'one creation event');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(audits.filter((e) => e.event === 'JOB_CREATED' && e.correlationId === a.job.id).length, 1, 'one audit line');

    // Close it so the ledger holds no PENDING residue.
    const closed = await patch(`${base(server)}/api/jobs/${a.job.id}`, { status: 'COMPLETED', progress: 100 });
    assert.equal((await closed.json()).job.status, 'COMPLETED');
  });

  it('without a key, every POST is a new job, as before', async () => {
    const one = await (await post(`${base(server)}/api/jobs`, { type: 'ping' })).json();
    const two = await (await post(`${base(server)}/api/jobs`, { type: 'ping' })).json();
    assert.equal(one.duplicate, false);
    assert.notEqual(one.job.id, two.job.id);
    assert.equal(one.job.idempotencyKey, null);
  });

  it('refuses a malformed key, a malformed request and a malformed update, with their codes', async () => {
    const badKey = await post(`${base(server)}/api/jobs`, { type: 'ping', idempotencyKey: 'has space' });
    assert.equal(badKey.status, 400);
    assert.equal((await badKey.json()).code, 'IDEMPOTENCY_KEY_INVALID');
    assert.equal((await fetch(`${base(server)}/api/jobs?idempotencyKey=`)).status, 400);

    const noType = await post(`${base(server)}/api/jobs`, { payload: {} });
    assert.equal(noType.status, 400);
    assert.equal((await noType.json()).code, 'INVALID_JOB_REQUEST');

    const notJson = await fetch(`${base(server)}/api/jobs`, { method: 'POST', body: '{' });
    assert.equal(notJson.status, 400);
    assert.equal((await notJson.json()).code, 'INVALID_JSON');

    const job = (await (await post(`${base(server)}/api/jobs`, { type: 'ping' })).json()).job;
    const badUpdate = await patch(`${base(server)}/api/jobs/${job.id}`, { progress: 'half' });
    assert.equal(badUpdate.status, 400);
    assert.equal((await badUpdate.json()).code, 'INVALID_JOB_UPDATE');

    const missing = await patch(`${base(server)}/api/jobs/job-nope`, { status: 'COMPLETED' });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'JOB_NOT_FOUND');
  });
});

describe('the worker acts only on what the ledger recorded', () => {
  const bridge = (calls) => async (url, opts) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ ok: true, runId: 'r1' }) };
  };
  const follower = () => ({ done: Promise.resolve({ observable: true, exitCode: 0 }), cancel() {} });

  it('never sends a job a stale read still showed as PENDING', async () => {
    // A read can be older than the last commit. Before the claim was made
    // conditional, the lane set RUNNING over COMPLETED and ran the job again.
    const inner = new JobQueue();
    const job = inner.createJob({ type: 'agent.inject', payload: { message: 'once' } });
    const stale = [{ ...job }];
    inner.updateJobProgress(job.id, { status: 'COMPLETED', progress: 100 });
    const view = {
      listJobs: async ({ status } = {}) => (status === 'PENDING' ? stale : []),
      updateJobProgress: async (...args) => inner.updateJobProgress(...args),
    };
    const calls = [];
    const worker = startQueueAgentWorker({ queue: view, pollMs: 20, fetchImpl: bridge(calls), followImpl: follower });
    await new Promise((r) => setTimeout(r, 80));
    worker.stop();
    assert.deepEqual(calls, [], 'the bridge was called for a job that had already ended');
    assert.equal(inner.getJob(job.id).status, 'COMPLETED');
  });

  it('sends nothing to a bridge when RUNNING could not be recorded', async () => {
    const inner = new JobQueue();
    const job = inner.createJob({ type: 'agent.inject', payload: { message: 'm' } });
    const view = {
      listJobs: async (filter) => inner.listJobs(filter),
      updateJobProgress: async () => { throw Object.assign(new Error('socket gone'), { code: 'ENOENT' }); },
    };
    const calls = [];
    const logged = console.error;
    console.error = () => {};
    try {
      const worker = startQueueAgentWorker({ queue: view, pollMs: 20, fetchImpl: bridge(calls), followImpl: follower });
      await new Promise((r) => setTimeout(r, 80));
      worker.stop();
    } finally {
      console.error = logged;
    }
    assert.deepEqual(calls, [], 'a run was started that the ledger never recorded');
    assert.equal(inner.getJob(job.id).status, 'PENDING', 'the job waits for the store, it is not lost');
  });
});

describe('the entrypoint never falls back to a file or to memory', () => {
  const env = (extra) => ({ PATH: process.env.PATH, QUEUE_PORT: '0', HOST: '127.0.0.1', ...extra });
  const run = (extra) => spawnSync(process.execPath, [SERVER], { env: env(extra), encoding: 'utf8', timeout: 10000 });

  /** Starts the server, waits until it says it is ready, stops it, returns its output. */
  const startThenStop = (extra) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: env(extra) });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`never ready:\n${out}`)); }, 10000);
    const read = (chunk) => {
      out += chunk;
      if (out.includes('Ready and listening')) child.kill('SIGTERM');
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', () => { clearTimeout(timer); resolve(out); });
  });

  it('refuses to start on MariaDB without its passwd file, and says why', () => {
    const r = run({ SHAPER_UNIT_SLUG: 'queue' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: PASSWD_MISSING/);
  });

  it('is MariaDB when nothing is chosen, even with a JSONL path lying in the environment', () => {
    const r = run({ QUEUE_STORAGE_FILE: path.join(os.tmpdir(), 'never-used.jsonl') });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: PASSWD_MISSING/);
  });

  it('uses the file store only when asked, with an explicit file', () => {
    const r = run({ QUEUE_STORE: 'file' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /QUEUE_STORE=file needs an explicit QUEUE_STORAGE_FILE/);
  });

  it('refuses an unknown store', () => {
    const r = run({ QUEUE_STORE: 'sqlite' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /must be "mariadb", "file" or "memory"/);
  });

  it('serves from memory or from a file only when chosen, and says it is DEV scaffolding', async () => {
    const memory = await startThenStop({ QUEUE_STORE: 'memory' });
    assert.match(memory, /DEV scaffolding: in-memory store/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-file-store-'));
    try {
      const file = await startThenStop({ QUEUE_STORE: 'file', QUEUE_STORAGE_FILE: path.join(dir, 'jobs.jsonl') });
      assert.match(file, /DEV scaffolding: JSONL file store/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
