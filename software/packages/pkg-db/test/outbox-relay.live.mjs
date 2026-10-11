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
import { appendOutbox, createEvidenceRelay, outboxStatus, pruneDeliveredOutbox, relayOutbox } from '../outbox.js';

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

describe('the lane asks for a credential only when something is due (DECISIONS §C)', () => {
  it('an empty or not-yet-due outbox obtains no credential; a due row does, once per round', async () => {
    await adminQuery('DELETE FROM queue.event_outbox');
    let asked = 0;
    const relay = createEvidenceRelay({ pool, credentials: async () => { asked += 1; return {}; }, deliver: async () => ({ id: 'r' }) });
    for (let i = 0; i < 3; i++) assert.deepEqual(await relay.tick(), { delivered: 0, deferred: 0 });
    await append(20);
    await adminQuery('UPDATE queue.event_outbox SET next_attempt_at = TIMESTAMPADD(HOUR, 1, UTC_TIMESTAMP(3))');
    assert.deepEqual(await relay.tick(), { delivered: 0, deferred: 0 }, 'a row in backoff is not deliverable work');
    assert.equal(asked, 0);
    await adminQuery('UPDATE queue.event_outbox SET next_attempt_at = UTC_TIMESTAMP(3)');
    assert.deepEqual(await relay.tick(), { delivered: 1, deferred: 0 });
    assert.equal(asked, 1);
    // A row set aside as damaged is owed, not deliverable: it draws no credential.
    await append(21);
    await adminQuery("UPDATE queue.event_outbox SET last_error = 'OUTBOX_ROW_INVALID', next_attempt_at = UTC_TIMESTAMP(3) WHERE receipt IS NULL");
    assert.deepEqual(await relay.tick(), { delivered: 0, deferred: 0 });
    assert.equal(asked, 1, 'no credential for a damaged row alone');
    await relay.close();
  });
});

describe('delivered evidence is removed only as the dataLifecycle declares (DECISIONS §C)', () => {
  const at = (days) => `TIMESTAMPADD(DAY, -${days}, UTC_TIMESTAMP(3))`;
  async function rows() {
    await adminQuery('DELETE FROM queue.event_outbox');
    await adminQuery('DELETE FROM queue.recovery_points');
    for (const n of [1, 2, 3, 4, 5, 6]) await append(100 + n);
    const ids = (await adminQuery('SELECT event_id, JSON_VALUE(body, "$.data.n") AS n FROM queue.event_outbox'))
      .reduce((m, r) => ({ ...m, [r.n]: r.event_id }), {});
    const receipt = JSON.stringify({ id: 'logger-record', digest: 'd' });
    // 101: delivered 40 days ago, receipted — removable under a later point.
    await adminQuery(`UPDATE queue.event_outbox SET receipt = ?, delivered_at = ${at(40)} WHERE event_id = ?`, [receipt, ids[101]]);
    // 102: delivered 10 days ago — inside the retention.
    await adminQuery(`UPDATE queue.event_outbox SET receipt = ?, delivered_at = ${at(10)} WHERE event_id = ?`, [receipt, ids[102]]);
    // 103: still owed after 40 days of failed attempts.
    await adminQuery(`UPDATE queue.event_outbox SET created_at = ${at(40)}, attempts = 90, last_error = 'DELIVERY_UNCONFIRMED' WHERE event_id = ?`, [ids[103]]);
    // 104: set aside as invalid 40 days ago.
    await adminQuery(`UPDATE queue.event_outbox SET created_at = ${at(40)}, last_error = 'OUTBOX_ROW_INVALID' WHERE event_id = ?`, [ids[104]]);
    // 105: delivered 35 days ago, after the recovery point below was taken.
    await adminQuery(`UPDATE queue.event_outbox SET receipt = ?, delivered_at = ${at(35)} WHERE event_id = ?`, [receipt, ids[105]]);
    // 106: delivered 40 days ago with a receipt that names no Logger record.
    await adminQuery(`UPDATE queue.event_outbox SET receipt = '{}', delivered_at = ${at(40)} WHERE event_id = ?`, [ids[106]]);
    return ids;
  }
  const remaining = async () => (await adminQuery('SELECT JSON_VALUE(body, "$.data.n") AS n FROM queue.event_outbox ORDER BY 1')).map((r) => Number(r.n));

  it('without a recovery point, nothing is removed', async () => {
    await rows();
    assert.deepEqual(await pruneDeliveredOutbox(pool), { removed: 0, coveredUntil: null });
    assert.deepEqual(await remaining(), [101, 102, 103, 104, 105, 106]);
  });

  it('a verified recovery point removes only the receipted rows it holds, delivered over 30 days ago', async () => {
    await rows();
    await adminQuery(`INSERT INTO queue.recovery_points (recovery_point_id, snapshot_at, verified_at, dump_sha256)
      VALUES ('rp-live', ${at(38)}, ${at(38)}, REPEAT('a', 64))`);
    const result = await pruneDeliveredOutbox(pool);
    assert.equal(result.removed, 1);
    assert.deepEqual(await remaining(), [102, 103, 104, 105, 106], 'owed, invalid, recent, uncovered and unreceipted rows stay');
  });

  it('the application account does it with its own grants (no DDL, no root)', async () => {
    const [[who]] = await pool.query('SELECT CURRENT_USER() AS u');
    assert.equal(who.u, 'queue@localhost');
  });
});
