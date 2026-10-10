import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendOutbox, relayOutbox } from '../outbox.js';

// Database-free refusal and delivery-debt tests. Installed transaction,
// concurrency and restore proof are separate; this pool is not MariaDB.
function fixture() {
  let row = null, rollbackSnapshot;
  const conn = {
    beginTransaction: async () => { rollbackSnapshot = structuredClone(row); },
    commit: async () => {},
    rollback: async () => { row = rollbackSnapshot; },
    release() {},
    query: async () => [[row && !row.receipt && row.last_error !== 'OUTBOX_ROW_INVALID' ? structuredClone(row) : null].filter(Boolean)],
    execute: async (sql, params) => {
      if (sql.startsWith('INSERT')) {
        row = { event_id: params[0], body: params[1], body_digest: params[2], attempts: 0, receipt: null };
      } else if (sql.includes('SET receipt = ?')) { row.receipt = JSON.parse(params[0]); row.attempts++; }
      else if (sql.includes("'OUTBOX_ROW_INVALID'")) { row.last_error = 'OUTBOX_ROW_INVALID'; }
      else if (sql.includes("'DELIVERY_UNCONFIRMED'")) { row.attempts++; row.last_error = 'DELIVERY_UNCONFIRMED'; }
      else if (sql.includes('SET next_attempt_at')) { row.leased = (row.leased || 0) + 1; }
      else throw new Error(`unexpected statement: ${sql}`);
      return [{}];
    },
  };
  return { conn, pool: { getConnection: async () => conn }, row: () => row };
}

test('a delivery outage preserves the exact stable event for a later relay instance', async () => {
  const f = fixture();
  await appendOutbox(f.conn, { event: 'JOB_CREATED', executionId: 'job-1' }, { eventId: 'source-1' });
  const original = f.row().body;
  assert.deepEqual(await relayOutbox(f.pool, { maxEvents: 1, deliver: async () => { throw new Error('remote token must not enter debt'); } }),
    { delivered: 0, deferred: 1 });
  assert.equal(f.row().receipt, null);
  assert.equal(f.row().body, original);
  assert.equal(f.row().last_error, 'DELIVERY_UNCONFIRMED');
  const result = await relayOutbox(f.pool, { deliver: async (event) => {
    assert.equal(event.sourceEventId, 'source-1');
    return { id: 'verified-receipt' };
  } });
  assert.deepEqual(result, { delivered: 1, deferred: 0 });
  assert.equal(f.row().receipt.id, 'verified-receipt');
});

test('a transport response without a receipt never clears delivery debt', async () => {
  const f = fixture();
  await appendOutbox(f.conn, { event: 'JOB_CREATED' });
  assert.deepEqual(await relayOutbox(f.pool, { maxEvents: 1, deliver: async () => null }),
    { delivered: 0, deferred: 1 });
  assert.equal(f.row().receipt, null);
});

test('corrupted stored bytes are set aside, never sent, never guessed around', async () => {
  const f = fixture();
  await appendOutbox(f.conn, { event: 'JOB_CREATED' });
  f.row().body = '{}';
  let calls = 0;
  assert.deepEqual(await relayOutbox(f.pool, { deliver: async () => { calls++; return {}; } }), { delivered: 0, deferred: 0, invalid: 1 });
  assert.equal(calls, 0);
  assert.equal(f.row().body, '{}', 'kept as it is for whoever repairs it');
  assert.equal(f.row().last_error, 'OUTBOX_ROW_INVALID');
  assert.equal(f.row().receipt, null, 'still owed');
});

test('a row is leased before it is sent, so no lock is held during delivery', async () => {
  const f = fixture();
  await appendOutbox(f.conn, { event: 'JOB_CREATED' });
  await relayOutbox(f.pool, { maxEvents: 1, deliver: async () => {
    assert.equal(f.row().leased, 1, 'the claim committed its lease before the send');
    return { id: 'r' };
  } });
});

test('deadline abort is not a receipt and records retryable debt', async () => {
  const f = fixture();
  await appendOutbox(f.conn, { event: 'JOB_CREATED' });
  assert.deepEqual(await relayOutbox(f.pool, { maxEvents: 1, timeoutMs: 5,
    deliver: async (_event, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ id: 'too-late' }))),
  }), { delivered: 0, deferred: 1 });
});

test('invalid limits and oversized events fail before entering the database', async () => {
  const f = fixture();
  await assert.rejects(appendOutbox(f.conn, { data: 'x'.repeat(65536) }), { code: 'OUTBOX_EVENT_TOO_LARGE' });
  assert.equal(f.row(), null);
  await assert.rejects(relayOutbox(f.pool, { deliver: async () => ({}), maxEvents: 101 }), { code: 'OUTBOX_RELAY_INVALID' });
});
