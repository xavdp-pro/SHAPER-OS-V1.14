import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { appendOutbox, createEvidenceRelay } from '../outbox.js';

// Intent: software/packages/pkg-db/INTENT.md#transactional-outbox-helper
// Database-free lane semantics. The real transaction, crash and drain proofs
// run against MariaDB in the units' *.live.mjs files (run-live.mjs).

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
      else if (sql.includes('receipt = ?')) { const r = rows.find((x) => x.event_id === params[1]); r.receipt = params[0]; }
      else { const r = rows.find((x) => x.event_id === params[1]); r.attempts += 1; r.last_error = 'DELIVERY_UNCONFIRMED'; r.deferred = true; }
      return [{}];
    },
  };
  return { rows, conn, openTransactions: () => open, pool: { getConnection: async () => conn } };
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
    assert.deepEqual(seen, [['credentials', 0], ['deliver', 1, 'Bearer transient']]);
    assert.doesNotMatch(JSON.stringify(f.rows), /transient/);
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
    let release;
    const gate = new Promise((r) => { release = r; });
    const relay = createEvidenceRelay({ pool: f.pool, shutdownMs: 100, deliver: async () => { await gate; return { id: 'r' }; } });
    const running = relay.tick();
    await assert.rejects(relay.close(), { code: 'OUTBOX_RELAY_SHUTDOWN_UNCONFIRMED' });
    assert.equal(f.rows[0].receipt, null, 'nothing is claimed delivered');
    release();
    await running;
    assert.equal(await relay.tick(), null, 'a closed lane starts nothing');
  });

  it('refuses unbounded settings', () => {
    const f = fixture();
    for (const bad of [{ intervalMs: 10 }, { maxEvents: 0 }, { maxEvents: 101 }, { timeoutMs: 60000 }, { shutdownMs: 'x' }]) {
      assert.throws(() => createEvidenceRelay({ pool: f.pool, deliver: async () => ({}), ...bad }), { code: 'OUTBOX_RELAY_INVALID' });
    }
  });
});
