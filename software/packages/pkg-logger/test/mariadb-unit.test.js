import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  LoggerIngestError,
  MAX_EVENT_BYTES_CEILING,
  VALID_LEVELS,
  buildRecord,
  canonicalJson,
  claimDigest,
  createEventIdGenerator,
  createLoggerServer,
  eventDigest,
  fromDbDatetime,
  normalizeIngestEntry,
  planBatch,
  recordToRow,
  replayDecision,
  resolveLimits,
  rowToRecord,
  sourceEventConflict,
  storeErrorStatus,
  toDbDatetime,
} from '../index.js';
import {
  EVENT_COLUMNS,
  KEY_COLUMNS,
  LOGGER_SCHEMA_VERSION,
  asStoreError,
  partitionHorizon,
} from '../mariadb-store.js';
import { UnitDbError } from '../../pkg-db/index.js';

// Intent: software/packages/pkg-logger/INTENT.md#private-mariadb
// Non-regression (Rule 29): the Logger kept its events in JSONL files that no
// functional-unit gate could qualify (Rule 26), accepted every retry as a new
// event, and answered 200 whether or not anything was kept. These tests hold
// the MariaDB path's contract where no database is needed; the live contract —
// identity, commit before receipt, replay, partition placement — is proven by
// the universe's proof against the unit's real private MariaDB (Rule 0G).

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(here, '..');
const brickDir = path.join(pkgDir, '../../bricks/brick-logger');
const schema = fs.readFileSync(path.join(pkgDir, 'sql/schema.sql'), 'utf8');
const schemaCode = schema.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
const statements = schemaCode.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);

function tableBlock(name) {
  const m = schemaCode.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB[^;]*`));
  assert.ok(m, `table ${name} is declared`);
  return { body: m[1], full: m[0] };
}
function columnsOf(body) {
  return body.split('\n')
    .map((line) => line.match(/^\s+([a-z_]+)\s+(DATETIME|CHAR|VARCHAR|DECIMAL|LONGTEXT|SMALLINT|INT|TIMESTAMP)\b/))
    .filter(Boolean).map((m) => m[1]);
}

describe('the schema belongs to the administrative path', () => {
  it('is idempotent: every statement creates IF NOT EXISTS or converges schema_meta', () => {
    assert.ok(statements.length >= 6);
    for (const statement of statements) {
      assert.match(
        statement,
        /^(CREATE TABLE IF NOT EXISTS |CREATE TRIGGER IF NOT EXISTS |INSERT INTO schema_meta \(unit, version\) VALUES \('logger', \d+\)\s+ON DUPLICATE KEY UPDATE )/,
        `not idempotent:\n${statement.slice(0, 120)}`,
      );
    }
  });

  it('grants nothing, creates no account and alters nothing', () => {
    assert.doesNotMatch(schemaCode, /\b(GRANT|CREATE USER|IDENTIFIED|DROP|ALTER|TRUNCATE|RENAME)\b/i);
  });

  it('records the version the store requires', () => {
    const m = schemaCode.match(/INSERT INTO schema_meta \(unit, version\) VALUES \('logger', (\d+)\)/);
    assert.ok(m, 'schema_meta row for logger');
    assert.equal(Number(m[1]), LOGGER_SCHEMA_VERSION);
  });

  it('holds exactly the columns the store writes', () => {
    assert.deepEqual(columnsOf(tableBlock('events').body).sort(), [...EVENT_COLUMNS].sort());
    assert.deepEqual(columnsOf(tableBlock('ingest_keys').body).sort(), [...KEY_COLUMNS].sort());
  });

  it('bounds the stored body as the application does, and knows the levels it accepts', () => {
    const { body } = tableBlock('events');
    const bound = body.match(/OCTET_LENGTH\(data\) <= (\d+)/);
    assert.ok(bound);
    assert.equal(Number(bound[1]), MAX_EVENT_BYTES_CEILING);
    assert.match(body, /CHECK \(JSON_VALID\(data\)\)/);
    const levels = body.match(/level IN \(([^)]+)\)/)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    assert.deepEqual(levels.sort(), [...VALID_LEVELS].sort());
  });
});

describe('events are partitioned monthly by receipt time', () => {
  const { body, full } = tableBlock('events');

  it('partitions by RANGE COLUMNS on a DATETIME receipt time (TIMESTAMP is not a COLUMNS type)', () => {
    assert.match(full, /PARTITION BY RANGE COLUMNS \(received_at\)/);
    assert.match(body, /^\s+received_at\s+DATETIME\(3\)\s+NOT NULL/m);
  });

  it('declares 2026-08 through 2027-03, one month each, then the guarded p_future', () => {
    const parts = [...full.matchAll(/PARTITION (\w+) VALUES LESS THAN \(([^)]+)\)/g)].map((m) => [m[1], m[2]]);
    const monthly = parts.slice(0, -1);
    const expected = [];
    for (let y = 2026, mo = 8; y < 2027 || mo <= 3; mo === 12 ? (y += 1, mo = 1) : (mo += 1)) {
      const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
      expected.push([`p${y}_${String(mo).padStart(2, '0')}`, `'${next}-01 00:00:00'`]);
    }
    assert.deepEqual(monthly, expected);
    assert.deepEqual(parts.at(-1), ['p_future', 'MAXVALUE']);
  });

  it('puts the partition column in every unique key, and no foreign key anywhere', () => {
    const uniques = [...body.matchAll(/(PRIMARY KEY|UNIQUE(?: KEY| INDEX)?(?: \w+)?)\s*\(([^)]+)\)/g)];
    assert.ok(uniques.length >= 1);
    for (const [, kind, cols] of uniques) {
      assert.ok(cols.split(',').map((c) => c.trim()).includes('received_at'), `${kind} (${cols}) omits received_at`);
    }
    assert.doesNotMatch(schemaCode, /\b(FOREIGN KEY|REFERENCES)\b/i);
  });

  it('indexes what /api/events/last filters on, each with receipt time', () => {
    for (const column of ['pod', 'correlation_id', 'event']) {
      assert.match(body, new RegExp(`KEY \\w+ \\(${column}, received_at\\)`), `no index on ${column}`);
    }
  });

  it('refuses UPDATE and DELETE on events through triggers', () => {
    for (const op of ['UPDATE', 'DELETE']) {
      assert.match(schemaCode, new RegExp(`CREATE TRIGGER IF NOT EXISTS \\w+ BEFORE ${op} ON events\\s+FOR EACH ROW SIGNAL SQLSTATE '45000'`));
    }
  });

  it('holds source-id uniqueness in an unpartitioned table keyed by (pod, source_event_id)', () => {
    const keys = tableBlock('ingest_keys');
    assert.match(keys.body, /PRIMARY KEY \(pod, source_event_id\)/);
    assert.doesNotMatch(keys.full, /PARTITION BY/);
  });
});

describe('an event is a canonical claim plus what Logger assigned on receipt', () => {
  const entry = {
    pod: 'queue', event: 'job_completed', level: 'info', correlationId: 'job-7',
    data: { b: 2, a: { y: [1, 'x'], x: null } }, durationMs: 45.67, sourceEventId: 'job-7/completed',
  };

  it('writes canonical JSON: sorted keys, no whitespace, finite numbers only', () => {
    assert.equal(canonicalJson({ b: 1, a: [true, null, { d: 'é', c: 1.5 }] }), '{"a":[true,null,{"c":1.5,"d":"é"}],"b":1}');
    assert.equal(canonicalJson(JSON.parse(canonicalJson(entry.data))), canonicalJson(entry.data));
    assert.throws(() => canonicalJson({ n: Infinity }), /non-finite/);
  });

  it('normalises as formatEventRecord always did, and bounds what it keeps', () => {
    const claim = normalizeIngestEntry(entry);
    assert.equal(claim.event, 'JOB_COMPLETED');
    assert.equal(claim.level, 'INFO');
    assert.equal(claim.durationMs, 45.7);
    assert.equal(claim.dataJson, '{"a":{"x":null,"y":[1,"x"]},"b":2}');
    assert.equal(normalizeIngestEntry({ event: 'E', data: { jobId: 42 } }).correlationId, '42');
    assert.equal(normalizeIngestEntry({ event: 'E' }).pod, 'unknown');
    const refuse = (e, code) => assert.throws(() => normalizeIngestEntry(e, { maxEventBytes: 64 }), (err) => err.code === code);
    refuse({}, 'EVENT_REQUIRED');
    refuse([], 'INVALID_ENTRY');
    refuse({ event: 'E', pod: 'p'.repeat(129) }, 'FIELD_TOO_LONG');
    refuse({ event: 'E', correlationId: 'c'.repeat(192) }, 'FIELD_TOO_LONG');
    refuse({ event: 'E', data: { blob: 'x'.repeat(100) } }, 'EVENT_TOO_LARGE');
    refuse({ event: 'E', sourceEventId: '' }, 'INVALID_SOURCE_EVENT_ID');
    refuse({ event: 'E', sourceEventId: 'a\nb' }, 'INVALID_SOURCE_EVENT_ID');
    refuse({ event: 'E', sourceEventId: 7 }, 'INVALID_SOURCE_EVENT_ID');
    refuse({ event: 'E', durationMs: 1e15 }, 'FIELD_OUT_OF_RANGE');
  });

  it('stores a row that reads back to the same record, whose digest anyone can recompute', () => {
    const record = buildRecord(normalizeIngestEntry(entry), { id: '01926a6e-8f00-7000-8000-000000000001', receivedAtMs: Date.parse('2026-09-24T10:11:12.345Z') });
    assert.equal(record.digest, eventDigest(record));
    assert.match(record.digest, /^[0-9a-f]{64}$/);

    const row = recordToRow(record);
    assert.equal(row.received_at, '2026-09-24 10:11:12.345');
    assert.equal(row.duration_ms, '45.7');
    // What mysql2 returns with dateStrings: DATETIME and DECIMAL as strings.
    const read = rowToRecord({ ...row });
    assert.deepEqual(read, record);
    assert.equal(JSON.stringify(read), JSON.stringify(record), 'a replay answers byte for byte');
    assert.equal(eventDigest(read), row.digest);

    const tampered = rowToRecord({ ...row, data: '{"a":{"x":null,"y":[1,"x"]},"b":3}' });
    assert.notEqual(eventDigest(tampered), row.digest);
    const moved = rowToRecord({ ...row, received_at: '2026-09-24 10:11:12.346' });
    assert.notEqual(eventDigest(moved), row.digest);
  });

  it('keeps receipt time in UTC through the DATETIME column', () => {
    assert.equal(toDbDatetime('2026-12-31T23:59:59.999Z'), '2026-12-31 23:59:59.999');
    assert.equal(fromDbDatetime('2026-12-31 23:59:59.999'), '2026-12-31T23:59:59.999Z');
    assert.equal(fromDbDatetime('2027-01-01 00:00:00'), '2027-01-01T00:00:00.000Z');
  });
});

describe('Logger-assigned ids order receipts exactly', () => {
  const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('is a UUIDv7 carrying the millisecond it returns', () => {
    const next = createEventIdGenerator({ now: () => Date.parse('2026-09-24T10:00:00.000Z') });
    const { id, ms } = next();
    assert.match(id, UUID_V7);
    assert.equal(parseInt(id.replace(/-/g, '').slice(0, 12), 16), ms);
  });

  it('never reorders: same millisecond, a clock stepping back, a full counter', () => {
    const clock = [1000, 1000, 1000, 999, 998, 1001];
    let i = 0;
    const next = createEventIdGenerator({ now: () => clock[Math.min(i++, clock.length - 1)] });
    const seen = clock.map(() => next());
    for (let k = 1; k < seen.length; k += 1) {
      assert.ok(seen[k].ms >= seen[k - 1].ms, 'receipt time never goes back');
      assert.ok(seen[k].id > seen[k - 1].id, `id ${k} sorts after id ${k - 1}`);
    }
    const burst = createEventIdGenerator({ now: () => 5000 });
    let last = burst();
    for (let k = 0; k < 4200; k += 1) {
      const cur = burst();
      assert.ok(cur.id > last.id);
      last = cur;
    }
    assert.equal(last.ms, 5001, 'the 4097th id of one millisecond moves to the next');
  });
});

describe('the idempotency decision holds without a database', () => {
  const base = { pod: 'queue', event: 'JOB_COMPLETED', correlationId: 'job-1', data: { a: 1, b: 2 }, sourceEventId: 's-1' };
  const claim = (over = {}) => normalizeIngestEntry({ ...base, ...over });

  it('same content is the same claim, whatever the key order or level spelling', () => {
    assert.equal(claimDigest(claim()), claimDigest(claim({ data: { b: 2, a: 1 }, level: 'info' })));
    assert.notEqual(claimDigest(claim()), claimDigest(claim({ data: { a: 1, b: 3 } })));
    assert.notEqual(claimDigest(claim()), claimDigest(claim({ sourceEventId: 's-2' })));
    assert.notEqual(claimDigest(claim()), claimDigest(claim({ correlationId: 'job-2' })));
  });

  it('what Logger generates is not part of the claim', () => {
    const c = claim();
    const r1 = buildRecord(c, { id: 'a', receivedAtMs: 1 });
    const r2 = buildRecord(c, { id: 'b', receivedAtMs: 2 });
    assert.notEqual(r1.execution_id, r2.execution_id);
    assert.equal(claimDigest(c), claimDigest(claim()));
  });

  it('replays the same claim and refuses a different one', () => {
    assert.equal(replayDecision('x'.repeat(64), 'x'.repeat(64)), 'replay');
    assert.equal(replayDecision('x'.repeat(64), 'y'.repeat(64)), 'conflict');
  });

  it('resolves duplicates inside one batch before the database sees them', () => {
    const plan = planBatch([claim(), claim({ data: { b: 2, a: 1 } }), claim({ sourceEventId: null }), claim({ sourceEventId: null })]);
    assert.deepEqual(plan.map((s) => s.duplicateOf), [null, 0, null, null], 'entries without a source id are never deduplicated');
    const otherPod = planBatch([claim(), claim({ pod: 'maestro' })]);
    assert.deepEqual(otherPod.map((s) => s.duplicateOf), [null, null], 'the id is scoped to its source');
    assert.throws(
      () => planBatch([claim(), claim({ data: { a: 9 } })]),
      (err) => err instanceof LoggerIngestError && err.status === 409 && err.code === 'SOURCE_EVENT_CONFLICT'
        && err.details.index === 1 && /^[0-9a-f]{64}$/.test(err.evidence.storedClaimDigest),
    );
  });
});

describe('a storage failure is an unavailable logger, not a bad request', () => {
  it('maps database errors to 503 and typed refusals to their own status', () => {
    assert.equal(storeErrorStatus(new UnitDbError('DB_UNAVAILABLE', 'x')), 503);
    for (const code of ['ER_ACCESS_DENIED_ERROR', 'ECONNREFUSED', 'ENOENT', 'PROTOCOL_CONNECTION_LOST', 'ER_LOCK_DEADLOCK']) {
      assert.equal(storeErrorStatus(Object.assign(new Error('x'), { code })), 503, code);
    }
    assert.equal(storeErrorStatus(sourceEventConflict({ pod: 'p', sourceEventId: 's' })), 409);
    assert.equal(storeErrorStatus(new Error('plain')), 500);
  });

  it('wraps every driver failure into one typed code and leaves decisions alone', () => {
    const wrapped = asStoreError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', errno: -111 }));
    assert.equal(wrapped.name, 'UnitDbError');
    assert.equal(wrapped.code, 'DB_UNAVAILABLE');
    const conflict = sourceEventConflict({ pod: 'p', sourceEventId: 's' });
    assert.equal(asStoreError(conflict), conflict);
    const bug = new TypeError('bug');
    assert.equal(asStoreError(bug), bug);
  });

  it('reads the partition horizon from information_schema', () => {
    const rows = [
      { name: 'p2027_02', bound: "'2027-03-01 00:00:00'" },
      { name: 'p2027_03', bound: "'2027-04-01 00:00:00'" },
      { name: 'p_future', bound: 'MAXVALUE' },
    ];
    assert.equal(partitionHorizon(rows), '2027-04-01T00:00:00.000Z');
    assert.equal(partitionHorizon([{ name: 'p_future', bound: 'MAXVALUE' }]), null);
  });

  it('answers 503 on health, ingest, reads and pods when its database is gone', async () => {
    const dbError = new UnitDbError('DB_UNAVAILABLE', 'socket gone');
    const store = {
      storageKind: 'mariadb',
      emitter: new EventEmitter(),
      probe: async () => ({ ok: false, latencyMs: 1, error: 'ECONNREFUSED' }),
      ingest: async () => { throw dbError; },
      query: async () => { throw dbError; },
      listPods: async () => { throw Object.assign(new Error('raw driver error'), { code: 'PROTOCOL_CONNECTION_LOST' }); },
      vitals: async () => ({}),
    };
    await withServer({ store }, async (base) => {
      const health = await fetch(`${base}/api/health`);
      assert.equal(health.status, 503);
      assert.equal((await health.json()).status, 'unavailable');
      const write = await post(base, { pod: 'p', event: 'E' });
      assert.equal(write.status, 503);
      const body = await write.json();
      assert.equal(body.code, 'DB_UNAVAILABLE');
      assert.equal(body.record, undefined, 'no receipt without a commit');
      assert.equal((await fetch(`${base}/api/events/last?correlationId=x`)).status, 503);
      assert.equal((await fetch(`${base}/api/pods`)).status, 503);
    });
  });

  it('answers only after the store has committed', async () => {
    let release;
    const committed = new Promise((resolve) => { release = resolve; });
    const store = standIn({
      ingest: async (claims) => {
        await committed;
        return claims.map((c) => ({ record: { event: c.event }, replayed: false }));
      },
    });
    await withServer({ store }, async (base) => {
      let answered = false;
      const pending = post(base, { event: 'E' }).then((r) => { answered = true; return r; });
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(answered, false);
      release();
      assert.equal((await pending).status, 200);
    });
  });
});

describe('POST /api/ingest refuses before anything is written', () => {
  it('validates the whole batch first, and names the entry at fault', async () => {
    const store = standIn();
    await withServer({ store }, async (base) => {
      const res = await post(base, [{ event: 'A' }, { pod: 'x' }]);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.code, 'EVENT_REQUIRED');
      assert.equal(body.index, 1);
      assert.equal(body.error, 'Ingest entry requires an event field');
      assert.equal((await post(base, '{not json')).status, 400);
      assert.equal(store.calls, 0);
    });
  });

  it('bounds the body, the batch and each event', async () => {
    const store = standIn();
    await withServer({ store, limits: { maxBodyBytes: 256, maxBatch: 2, maxEventBytes: 32 } }, async (base) => {
      const big = await post(base, { event: 'E', data: { x: 'y'.repeat(400) } });
      assert.equal(big.status, 413);
      assert.equal((await big.json()).code, 'BODY_TOO_LARGE');
      const batch = await post(base, [{ event: 'A' }, { event: 'B' }, { event: 'C' }]);
      assert.equal(batch.status, 413);
      assert.equal((await batch.json()).code, 'BATCH_TOO_LARGE');
      const event = await post(base, { event: 'E', data: { x: 'y'.repeat(40) } });
      assert.equal(event.status, 413);
      assert.equal((await event.json()).code, 'EVENT_TOO_LARGE');
      const streamed = await postChunked(base, [`{"event":"E","data":{"x":"`, 'y'.repeat(200), 'y'.repeat(200), '"}}']);
      assert.equal(streamed.status, 413, 'a body without Content-Length is bounded while it streams');
      assert.equal(streamed.body.code, 'BODY_TOO_LARGE');
      assert.equal(store.calls, 0);
    });
  });

  it('answers a conflicting replay with 409 and a typed code', async () => {
    const store = standIn({
      ingest: async () => {
        throw sourceEventConflict({ pod: 'queue', sourceEventId: 's-1', originalEventId: 'e-1', storedClaimDigest: 'a'.repeat(64), submittedClaimDigest: 'b'.repeat(64) });
      },
    });
    await withServer({ store }, async (base) => {
      const res = await post(base, { pod: 'queue', event: 'E', sourceEventId: 's-1' });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.code, 'SOURCE_EVENT_CONFLICT');
      assert.equal(body.sourceEventId, 's-1');
      assert.equal(body.originalEventId, 'e-1');
      assert.equal(JSON.stringify(body).match(/[0-9a-f]{64}/), null, 'no claim digest is handed to an unauthenticated submitter');
    });
  });

  it('says when a receipt is the original one, keeping the response shape', async () => {
    const original = { id: 'e-1', event: 'E' };
    const store = standIn({ ingest: async (claims) => claims.map(() => ({ record: original, replayed: true })) });
    await withServer({ store }, async (base) => {
      const one = await (await post(base, { event: 'E', sourceEventId: 's-1' })).json();
      assert.deepEqual(one, { status: 'ok', record: original, replayed: true });
      const many = await (await post(base, [{ event: 'E', sourceEventId: 's-1' }])).json();
      assert.deepEqual(many, { status: 'ok', processed: 1, records: [original], replayed: [0] });
    });
  });

  it('refuses a malformed query instead of guessing', async () => {
    await withServer({ store: standIn() }, async (base) => {
      const res = await fetch(`${base}/api/events/last?limit=abc`);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, 'INVALID_QUERY');
      assert.equal((await fetch(`${base}/api/events/last?since=yesterday`)).status, 400);
    });
  });
});

describe('the JSONL scaffolding keeps its contract and claims nothing more', () => {
  it('filters by correlation, and does not pretend to be idempotent', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-file-store-'));
    try {
      await withServer({ logDir: tmpDir }, async (base) => {
        await post(base, { pod: 'queue', event: 'JOB_CREATED', correlationId: 'job-1' });
        await post(base, { pod: 'queue', event: 'JOB_CREATED', correlationId: 'job-2' });
        await post(base, { pod: 'maestro', event: 'BEAT_ENQUEUED', correlationId: 'job-1' });
        const byCorrelation = await (await fetch(`${base}/api/events/last?correlationId=job-1`)).json();
        assert.deepEqual(byCorrelation.events.map((e) => e.pod).sort(), ['maestro', 'queue']);
        const byPod = await (await fetch(`${base}/api/events/last?pod=queue&limit=10`)).json();
        assert.equal(byPod.events.length, 2);

        const first = await (await post(base, { pod: 'queue', event: 'E', sourceEventId: 's-1' })).json();
        const again = await (await post(base, { pod: 'queue', event: 'E', sourceEventId: 's-1' })).json();
        assert.equal(first.replayed, undefined);
        assert.equal(again.replayed, undefined);
        const health = await (await fetch(`${base}/api/health`)).json();
        assert.equal(health.storage, 'file');
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('the entrypoint never falls back to a file', () => {
  const serverJs = path.join(pkgDir, 'server.js');
  const run = (env) => spawnSync(process.execPath, [serverJs], {
    env: { PATH: process.env.PATH, LOGGER_PORT: '0', HOST: '127.0.0.1', ...env },
    encoding: 'utf8',
    timeout: 10000,
  });

  it('refuses to start on MariaDB without its passwd file, and says why', () => {
    const r = run({});
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: PASSWD_MISSING/);
  });

  it('uses the JSONL scaffolding only when asked, with an explicit LOG_DIR', () => {
    const r = run({ LOGGER_STORE: 'file' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /LOGGER_STORE=file needs an explicit LOG_DIR/);
  });

  it('refuses an unknown store', () => {
    const r = run({ LOGGER_STORE: 'sqlite' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /LOGGER_STORE must be "mariadb" or "file"/);
  });

  it('refuses a limit it cannot honour rather than using another', () => {
    const r = run({ LOGGER_STORE: 'file', LOG_DIR: os.tmpdir(), LOGGER_MAX_EVENT_BYTES: String(MAX_EVENT_BYTES_CEILING + 1) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: INVALID_LIMIT/);
  });

  it('starts the declared scaffolding and says what it is', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-entrypoint-'));
    const child = spawn(process.execPath, [serverJs], {
      env: { PATH: process.env.PATH, LOGGER_PORT: '0', HOST: '127.0.0.1', LOGGER_STORE: 'file', LOG_DIR: tmpDir },
    });
    try {
      let stdout = '';
      let stderr = '';
      child.stderr.on('data', (c) => { stderr += c; });
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no listening line:\n${stdout}\n${stderr}`)), 8000);
        child.stdout.on('data', (c) => {
          stdout += c;
          const m = stdout.match(/Ready and listening on http:\/\/127\.0\.0\.1:(\d+)/);
          if (m) { clearTimeout(timer); resolve(Number(m[1])); }
        });
      });
      assert.match(stderr, /DEV scaffolding: JSONL files under/);
      const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
      assert.equal(health.storage, 'file');
    } finally {
      child.kill('SIGTERM');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('limits are declared, bounded and never guessed', () => {
  it('defaults, reads and refuses', () => {
    assert.deepEqual(resolveLimits({}), { maxBodyBytes: 1048576, maxEventBytes: 65536, maxBatch: 500, maxQueryLimit: 1000 });
    assert.equal(resolveLimits({ LOGGER_MAX_BATCH: '10' }).maxBatch, 10);
    for (const bad of [{ LOGGER_MAX_BODY_BYTES: 'lots' }, { LOGGER_MAX_BATCH: '0' }, { LOGGER_MAX_EVENT_BYTES: String(MAX_EVENT_BYTES_CEILING + 1) }]) {
      assert.throws(() => resolveLimits(bad), (err) => err.code === 'INVALID_LIMIT');
    }
  });
});

describe('the library surface other units import stays dependency-free', () => {
  // brick-maestro, brick-queue and the bridges ship pkg-logger without pkg-db;
  // one sibling import in these files and their images stop at start-up.
  it('only mariadb-store.js reaches another package', () => {
    const library = ['index.js', 'events.js', 'vitals.js', 'ingest-client.js', 'ingest-contract.js'];
    for (const file of library) {
      const text = fs.readFileSync(path.join(pkgDir, file), 'utf8');
      assert.doesNotMatch(text, /(from\s+|import\s*\(\s*)['"]\.\.\//, `${file} imports a sibling package`);
      assert.doesNotMatch(text, /(from\s+|import\s*\(\s*)['"]\.\/mariadb-store/, `${file} loads the MariaDB store`);
    }
    assert.match(fs.readFileSync(path.join(pkgDir, 'mariadb-store.js'), 'utf8'), /from '\.\.\/pkg-db\/pool\.js'/);
  });
});

describe('the brick runs the logger as its own account on its own database', () => {
  const containerfile = fs.readFileSync(path.join(brickDir, 'Containerfile'), 'utf8');
  const brick = JSON.parse(fs.readFileSync(path.join(brickDir, 'brick.json'), 'utf8'));
  const quadlet = fs.readFileSync(path.join(brickDir, 'cfg-logger.container'), 'utf8');

  it('declares the unit the provisioning reads, with a schema path that exists in the image', () => {
    assert.deepEqual(brick.unit, { slug: 'logger', uid: 10620, schema: '/app/sql/schema.sql' });
    assert.ok(brick.buildPackages.includes('pkg-db'));
    // pkg-logger is flattened into WORKDIR /app, so its sql/ lands at /app/sql/.
    assert.match(containerfile, /^WORKDIR \/app$/m);
    assert.match(containerfile, /^COPY --from=shaper_base \/shaper\/packages\/pkg-logger\/ \.\/$/m);
    assert.ok(fs.existsSync(path.join(pkgDir, 'sql/schema.sql')));
  });

  it('builds the fixed-uid account, installs the pinned driver and runs as it', () => {
    assert.match(containerfile, /ARG UNIT_UID=10620/);
    assert.match(containerfile, /adduser -S -D -H -u "\$\{UNIT_UID\}" -G logger -s \/sbin\/nologin logger/);
    assert.match(containerfile, /COPY --from=shaper_base \/shaper\/packages\/pkg-db\/ \/pkg-db\//);
    assert.match(containerfile, /cd \/pkg-db && npm ci --omit=dev/);
    assert.match(containerfile, /^ENV LOGGER_STORE=mariadb$/m);
    assert.match(containerfile, /^ENV SHAPER_UNIT_SLUG=logger$/m);
    assert.match(containerfile, /^USER logger$/m);
    assert.doesNotMatch(containerfile, /LOG_DIR/, 'the image must not preselect the JSONL scaffolding');
  });

  it('mounts only the socket directory and the passwd file, and binds localhost', () => {
    assert.match(quadlet, /^User=10620:10620$/m);
    assert.match(quadlet, /^Volume=\/apps\/logger\/nosav\/run\/mysqld:\/run\/mysqld:z$/m);
    assert.match(quadlet, /^Volume=\/apps\/logger\/etc\/mysql\/localhost\/passwd:\/apps\/logger\/etc\/mysql\/localhost\/passwd:ro,Z$/m);
    assert.match(quadlet, /^Environment=HOST=127\.0\.0\.1$/m);
    assert.doesNotMatch(quadlet, /LOG_DIR|vol-%i-log/);
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

function standIn(overrides = {}) {
  const store = {
    storageKind: 'mariadb',
    emitter: new EventEmitter(),
    calls: 0,
    probe: async () => ({ ok: true, latencyMs: 1 }),
    query: async () => [],
    listPods: async () => [],
    vitals: async () => ({}),
    ...overrides,
  };
  const ingest = overrides.ingest || (async (claims) => claims.map((c) => ({ record: { event: c.event }, replayed: false })));
  store.ingest = async (claims) => { store.calls += 1; return ingest(claims); };
  return store;
}

async function withServer(options, work) {
  const server = createLoggerServer({ port: 0, host: '127.0.0.1', ...options });
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await work(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function postChunked(base, chunks) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    const write = (i) => {
      if (i === chunks.length) { req.end(); return; }
      req.write(chunks[i], () => setTimeout(() => write(i + 1), 5));
    };
    write(0);
  });
}

function post(base, body) {
  return fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
