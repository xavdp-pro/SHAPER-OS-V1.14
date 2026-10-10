/**
 * Live (real private MariaDB, the queue unit's outbox): the relay holds no
 * lock and no connection while it waits for the recipient, a relay that dies
 * mid-delivery leaves its row to another after the lease, and one damaged row
 * does not stop the rows behind it.
 *
 * Run through software/packages/pkg-db/test/live/run-live.mjs.
 * Intent: software/packages/pkg-db/INTENT.md#transactional-outbox-helper
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminQuery, resetUnit, unitDb } from './live/live-env.mjs';
import { openUnitDb, withTransaction } from '../pool.js';
import { appendOutbox, outboxStatus, relayOutbox } from '../outbox.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let pool;

before(async () => {
  await resetUnit('queue');
  ({ pool } = await openUnitDb({ slug: 'queue', ...unitDb(), connectionLimit: 3 }));
});
after(async () => { await pool.end(); });

const append = (n) => withTransaction(pool, (conn) => appendOutbox(conn, { pod: 'queue', event: 'LIVE_PROBE', executionId: `x-${n}`, data: { n } }));

describe('the relay holds nothing while it waits for the recipient', () => {
  it('a unit keeps writing evidence while a delivery is stalled', async () => {
    await append(1);
    let release;
    const stalled = new Promise((r) => { release = r; });
    let entered;
    const inDelivery = new Promise((r) => { entered = r; });
    const relaying = relayOutbox(pool, { maxEvents: 1, timeoutMs: 5000, deliver: async () => { entered(); await stalled; return { id: 'r1' }; } });
    await inDelivery;
    // With the relay's transaction open across the send, these inserts waited
    // on its locks for the whole round trip, and filled the pool.
    const started = Date.now();
    await Promise.all([append(2), append(3), append(4)]);
    const waited = Date.now() - started;
    release();
    assert.deepEqual(await relaying, { delivered: 1, deferred: 0 });
    assert.ok(waited < 1000, `writers waited ${waited} ms on the relay`);
  });

  it('a second relay never sends the row the first one is sending', async () => {
    await adminQuery('DELETE FROM queue.event_outbox');
    await append(5);
    let release;
    const stalled = new Promise((r) => { release = r; });
    const sent = [];
    const first = relayOutbox(pool, { maxEvents: 1, timeoutMs: 5000, deliver: async (e) => { sent.push(e.sourceEventId); await stalled; return { id: 'a' }; } });
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(await relayOutbox(pool, { maxEvents: 5, deliver: async (e) => { sent.push(e.sourceEventId); return { id: 'b' }; } }), { delivered: 0, deferred: 0 });
    release();
    await first;
    assert.equal(sent.length, 1);
  });
});

describe('a relay that dies mid-delivery', () => {
  it('leaves the row leased, then due again, never lost and never cleared', async () => {
    await adminQuery('DELETE FROM queue.event_outbox');
    await append(6);
    const script = `
      const { openUnitDb } = await import(${JSON.stringify(path.join(here, '../pool.js'))});
      const { relayOutbox } = await import(${JSON.stringify(path.join(here, '../outbox.js'))});
      const { pool } = await openUnitDb({ slug: 'queue', ...${JSON.stringify(unitDb())} });
      await relayOutbox(pool, { maxEvents: 1, timeoutMs: 1000, deliver: async () => { process.kill(process.pid, 'SIGKILL'); await new Promise(() => {}); } });
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const [row] = await adminQuery('SELECT receipt, attempts, next_attempt_at > UTC_TIMESTAMP(3) AS leased FROM queue.event_outbox');
    assert.equal(row.receipt, null);
    assert.equal(Number(row.leased), 1, 'the row waits for its lease to run out');
    assert.deepEqual(await relayOutbox(pool, { deliver: async () => assert.fail('a leased row is not sent twice') }), { delivered: 0, deferred: 0 });
    await new Promise((r) => setTimeout(r, 6500)); // lease: timeout (1 s) + 5 s
    assert.deepEqual(await relayOutbox(pool, { deliver: async () => ({ id: 'after-lease' }) }), { delivered: 1, deferred: 0 });
  });
});

describe('a damaged row', () => {
  it('is set aside with a typed mark, and the rows behind it are delivered', async () => {
    await adminQuery('DELETE FROM queue.event_outbox');
    await append(7);
    await new Promise((r) => setTimeout(r, 5));
    await append(8);
    const [oldest] = await adminQuery('SELECT event_id FROM queue.event_outbox ORDER BY created_at, event_id LIMIT 1');
    await adminQuery("UPDATE queue.event_outbox SET body = '{\"tampered\":true}' WHERE event_id = ?", [oldest.event_id]);
    const sent = [];
    const result = await relayOutbox(pool, { deliver: async (e) => { sent.push(e.data.n); return { id: 'ok' }; } });
    assert.deepEqual(result, { delivered: 1, deferred: 0, invalid: 1 });
    assert.deepEqual(sent, [8]);
    const [damaged] = await adminQuery('SELECT body, receipt, last_error FROM queue.event_outbox WHERE event_id = ?', [oldest.event_id]);
    assert.deepEqual({ ...damaged }, { body: '{"tampered":true}', receipt: null, last_error: 'OUTBOX_ROW_INVALID' });
    const status = await outboxStatus(pool);
    assert.equal(status.invalid, 1, 'the damage is observable');
    assert.equal(status.pending, 1, 'and still owed');
  });
});
