import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendOutbox, createEvidenceRelay } from '../outbox.js';

// Intent: software/packages/pkg-db/INTENT.md#transactional-outbox-helper
// Database-free lane semantics. The real transaction, crash and drain proofs
// run against MariaDB in the units' *.live.mjs files (run-live.mjs).

const here = path.dirname(fileURLToPath(import.meta.url));

function fixture() {
  const rows = [];
  let open = 0;
  const conn = {
    beginTransaction: async () => { open += 1; },
    commit: async () => { open -= 1; },
    rollback: async () => { open -= 1; },
    release() {},
    query: async () => [rows.filter((r) => !r.receipt).slice(0, 1).map((r) => structuredClone(r))],
    execute: async (sql, params) => {
      if (sql.startsWith('INSERT')) rows.push({ event_id: params[0], body: params[1], body_digest: params[2], attempts: 0, receipt: null });
      else if (sql.includes('SET receipt = ?')) { const r = rows.find((x) => x.event_id === params[1]); r.receipt = params[0]; }
      else if (sql.includes("'DELIVERY_UNCONFIRMED'")) { const r = rows.find((x) => x.event_id === params[1]); r.attempts += 1; r.last_error = 'DELIVERY_UNCONFIRMED'; r.deferred = true; }
      else if (!sql.includes('SET next_attempt_at')) throw new Error(`unexpected statement: ${sql}`);
      return [{}];
    },
  };
  const pool = {
    getConnection: async () => conn,
    // hasDueEvidence: one read, outside any transaction.
    query: async (sql) => {
      if (!/^SELECT 1 AS due FROM event_outbox/.test(sql)) throw new Error(`unexpected pool query: ${sql}`);
      pool.dueReads += 1;
      return [rows.filter((r) => !r.receipt).slice(0, 1).map(() => ({ due: 1 }))];
    },
    dueReads: 0,
  };
  return { rows, conn, openTransactions: () => open, pool };
}

describe('the evidence relay lane', () => {
  it('obtains its transport credential before opening the relay transaction, and never stores it', async () => {
    const f = fixture();
    await appendOutbox(f.conn, { pod: 'vault', event: 'SECRET_STORED', executionId: 'e1' });
    const seen = [];
    const relay = createEvidenceRelay({
      pool: f.pool,
      credentials: async () => { seen.push(['credentials', f.openTransactions()]); return { Authorization: 'Bearer transient' }; },
      deliver: async (entry, _signal, headers) => { seen.push(['deliver', f.openTransactions(), headers.Authorization]); return { id: 'r1' }; },
    });
    assert.deepEqual(await relay.tick(), { delivered: 1, deferred: 0 });
    assert.deepEqual(seen, [['credentials', 0], ['deliver', 0, 'Bearer transient']], 'no transaction is open during the send');
    assert.doesNotMatch(JSON.stringify(f.rows), /transient/);
  });

  it('obtains no credential while nothing is due: an idle unit asks Vault for nothing (DECISIONS §C)', async () => {
    const f = fixture();
    let asked = 0;
    const relay = createEvidenceRelay({
      pool: f.pool,
      credentials: async () => { asked += 1; return { Authorization: 'Bearer transient' }; },
      deliver: async () => assert.fail('nothing to send'),
    });
    for (let i = 0; i < 5; i++) assert.deepEqual(await relay.tick(), { delivered: 0, deferred: 0 });
    assert.equal(asked, 0, 'no credential without deliverable work');
    assert.equal(f.pool.dueReads, 5);
    assert.equal(relay.last.idle, true);
    await appendOutbox(f.conn, { pod: 'queue', event: 'JOB_CREATED', executionId: 'j1' });
    const busy = createEvidenceRelay({ pool: f.pool, credentials: async () => { asked += 1; return {}; }, deliver: async () => ({ id: 'r1' }) });
    assert.deepEqual(await busy.tick(), { delivered: 1, deferred: 0 });
    assert.equal(asked, 1, 'work brings the credential');
  });

  it('a refused credential is asked again after a backoff, not on every tick', async () => {
    const f = fixture();
    await appendOutbox(f.conn, { pod: 'queue', event: 'JOB_CREATED', executionId: 'j1' });
    let clock = 1_000_000, asked = 0, refuse = true;
    const relay = createEvidenceRelay({
      pool: f.pool, intervalMs: 2000, now: () => clock,
      credentials: async () => { asked += 1; if (refuse) throw Object.assign(new Error('x'), { code: 'IDENTITY_ISSUE_DENIED' }); return {}; },
      deliver: async () => ({ id: 'r1' }),
    });
    assert.equal(await relay.tick(), null);
    assert.equal(await relay.tick(), null);
    clock += 3999;
    assert.equal(await relay.tick(), null);
    assert.equal(asked, 1, 'within the backoff, Vault is not asked again');
    clock += 1;
    assert.equal(await relay.tick(), null);
    assert.equal(asked, 2, 'after it, once');
    clock += 7999;
    assert.equal(await relay.tick(), null);
    assert.equal(asked, 2, 'the backoff doubles');
    clock += 1; refuse = false;
    assert.deepEqual(await relay.tick(), { delivered: 1, deferred: 0 });
    assert.equal(asked, 3);
    clock += 1;
    assert.deepEqual(await relay.tick(), { delivered: 0, deferred: 0 }, 'a success resets the backoff');
  });

  it('runs one batch at a time: a tick during a tick shares it', async () => {
    const f = fixture();
    await appendOutbox(f.conn, { pod: 'queue', event: 'JOB_CREATED', executionId: 'j1' });
    let release;
    const gate = new Promise((r) => { release = r; });
    let deliveries = 0;
    const relay = createEvidenceRelay({ pool: f.pool, deliver: async () => { deliveries += 1; await gate; return { id: 'r' }; } });
    const first = relay.tick();
    assert.equal(relay.tick(), first);
    release();
    assert.deepEqual(await first, { delivered: 1, deferred: 0 });
    assert.equal(deliveries, 1);
  });

  it('a credential it cannot obtain leaves the debt untouched and says so once', async () => {
    const f = fixture();
    await appendOutbox(f.conn, { pod: 'queue', event: 'JOB_CREATED', executionId: 'j1' });
    const reports = [];
    const relay = createEvidenceRelay({
      pool: f.pool,
      credentials: async () => { throw Object.assign(new Error('no grant'), { code: 'IDENTITY_ISSUE_DENIED' }); },
      deliver: async () => assert.fail('nothing is sent without a credential'),
      report: (e) => reports.push(e),
    });
    assert.equal(await relay.tick(), null);
    assert.equal(await relay.tick(), null);
    assert.deepEqual(reports, [{ event: 'EVIDENCE_CREDENTIAL_UNAVAILABLE', code: 'IDENTITY_ISSUE_DENIED' }]);
    assert.equal(f.rows[0].receipt, null);
    assert.equal(f.rows[0].attempts, 0);
  });

  it('close waits for the batch in flight, and refuses success when it does not settle in time', async () => {
    const f = fixture();
    await appendOutbox(f.conn, { pod: 'queue', event: 'JOB_CREATED', executionId: 'j1' });
    let release, entered;
    const gate = new Promise((r) => { release = r; });
    const sending = new Promise((r) => { entered = r; });
    const relay = createEvidenceRelay({ pool: f.pool, shutdownMs: 100, deliver: async () => { entered(); await gate; return { id: 'r' }; } });
    const running = relay.tick();
    await sending;
    await assert.rejects(relay.close(), { code: 'OUTBOX_RELAY_SHUTDOWN_UNCONFIRMED' });
    assert.equal(f.rows[0].receipt, null, 'nothing is claimed delivered');
    release();
    await running;
    assert.equal(await relay.tick(), null, 'a closed lane starts nothing');
  });

  it('a lane closed before its send starts sends nothing', async () => {
    const f = fixture();
    await appendOutbox(f.conn, { pod: 'queue', event: 'JOB_CREATED', executionId: 'j1' });
    const relay = createEvidenceRelay({ pool: f.pool, deliver: async () => assert.fail('closing lanes start no send') });
    const running = relay.tick();
    await relay.close();
    assert.deepEqual(await running, { delivered: 0, deferred: 0 });
    assert.equal(f.rows[0].receipt, null);
  });

  it('refuses unbounded settings', () => {
    const f = fixture();
    for (const bad of [{ intervalMs: 10 }, { maxEvents: 0 }, { maxEvents: 101 }, { timeoutMs: 60000 }, { shutdownMs: 'x' }]) {
      assert.throws(() => createEvidenceRelay({ pool: f.pool, deliver: async () => ({}), ...bad }), { code: 'OUTBOX_RELAY_INVALID' });
    }
  });
});

describe('every unit installs the same outbox and recovery-point tables', () => {
  const normalize = (text) => text.replace(/--[^\n]*\n/g, '\n').replace(/\s+/g, ' ').trim();
  const table = (file, name) => {
    const m = fs.readFileSync(file, 'utf8').match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
    assert.ok(m, `${file} has no ${name} table`);
    return normalize(m[0]);
  };
  for (const name of ['event_outbox', 'recovery_points']) {
    const reference = table(path.join(here, '../sql/outbox.sql'), name);
    for (const unit of ['vault', 'queue', 'maestro']) {
      it(`${unit}'s schema carries the pkg-db ${name} definition`, () => {
        assert.equal(table(path.join(here, `../../pkg-${unit}/sql/schema.sql`), name), reference);
      });
    }
  }
});
