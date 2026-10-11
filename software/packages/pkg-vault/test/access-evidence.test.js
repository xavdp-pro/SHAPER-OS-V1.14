import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRefusalRecorder, requestIdOf, resourceId } from '../access-evidence.js';

// Intent: software/packages/pkg-vault/INTENT.md#access-evidence
// DECISIONS-20261011 §H, database-free: authenticated refusals are recorded
// individually once per window and counted after; unauthenticated ones are
// only counted; counts flush as bounded aggregates; nothing carries a secret.
// The transactional read-before-return and the relay-loop bound are proven
// live (test/evidence-outbox.live.mjs).

function fakePool({ failing = false } = {}) {
  const rows = [];
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    execute: async (sql, params) => {
      if (failing) throw Object.assign(new Error('gone'), { code: 'ER_NO_SUCH_TABLE' });
      rows.push(JSON.parse(params[1]));
      return [{}];
    },
  };
  return { rows, pool: { getConnection: async () => conn } };
}
const universe = '550e8400-e29b-41d4-a716-446655440000';

describe('refusal evidence', () => {
  it('an authenticated refusal is recorded once per window with its typed reason, then counted', async () => {
    const f = fakePool();
    let clock = 1_000_000;
    const r = createRefusalRecorder({ pool: f.pool, universe, now: () => clock, individualWindowMs: 300000 });
    const fact = { action: 'identity.issue', reason: 'AUDIENCE_NOT_GRANTED', requestId: 'req-1', authenticated: true, unit: 'brick-voice', incarnation: 'v-1' };
    assert.equal(await r.refused(fact), 'recorded');
    for (let i = 0; i < 5; i++) assert.equal(await r.refused({ ...fact, requestId: `req-${i + 2}` }), 'counted');
    assert.equal(f.rows.length, 1);
    const [one] = f.rows;
    assert.equal(one.event, 'VAULT_REQUEST_REFUSED');
    assert.deepEqual([one.data.action, one.data.reason, one.data.result, one.data.unit, one.data.incarnation, one.data.universe, one.data.requestId],
      ['identity.issue', 'AUDIENCE_NOT_GRANTED', 'refused', 'brick-voice', 'v-1', universe, 'req-1']);
    assert.equal(await r.flush(), 1);
    const agg = f.rows[1];
    assert.deepEqual([agg.event, agg.data.count, agg.data.authenticated], ['VAULT_REFUSALS_AGGREGATED', 5, true]);
    clock += 300000;
    assert.equal(await r.refused(fact), 'recorded', 'a new window records it again');
  });

  it('unauthenticated refusals are only counted, one aggregate per key, keys bounded', async () => {
    const f = fakePool();
    const r = createRefusalRecorder({ pool: f.pool, universe, maxKeys: 4 });
    for (let i = 0; i < 100; i++) await r.refused({ action: 'admin', reason: 'VAULT_TOKEN_INVALID', requestId: `x${i}`, authenticated: false });
    for (let i = 0; i < 10; i++) await r.refused({ action: 'identity.issue', reason: `R${i}`, requestId: 'y', authenticated: false });
    assert.equal(f.rows.length, 0, 'nothing written per attempt');
    assert.equal(await r.flush(), 4, 'at most maxKeys aggregates');
    const byReason = Object.fromEntries(f.rows.map((e) => [e.data.reason, e.data.count]));
    assert.equal(byReason.VAULT_TOKEN_INVALID, 100);
    assert.equal(byReason.REFUSALS_OVERFLOW, 8, 'the rest folded into one overflow key');
    assert.equal(await r.flush(), 0, 'a flushed window is not flushed twice');
  });

  it('counts survive a flush the outbox refuses; a refusal is never failed by its evidence', async () => {
    const f = fakePool({ failing: true });
    const events = [];
    const r = createRefusalRecorder({ pool: f.pool, universe, report: (e) => events.push(e.event) });
    assert.equal(await r.refused({ action: 'identity.check', reason: 'CREDENTIAL_NOT_CURRENT', requestId: 'z', authenticated: true, unit: 'vault' }), 'counted');
    assert.equal(await r.flush(), 0);
    assert.equal(r.pending(), 1);
    assert.deepEqual(events, ['VAULT_REFUSAL_UNRECORDED', 'VAULT_REFUSALS_UNFLUSHED']);
  });
});

describe('what evidence names', () => {
  it('a secret by an opaque, stable id that reveals no path', () => {
    const key = Buffer.alloc(32, 9);
    const id = resourceId(key, 'secret/mail/contact-ops');
    assert.match(id, /^res-[0-9a-f]{32}$/);
    assert.equal(resourceId(key, 'secret/mail/contact-ops'), id);
    assert.notEqual(resourceId(key, 'secret/mail/contact-ops2'), id);
    assert.notEqual(resourceId(Buffer.alloc(32, 8), 'secret/mail/contact-ops'), id, 'another Vault, another id');
    assert.doesNotMatch(id, /mail|contact/);
  });

  it('a request by the caller\'s id when it is one, else a new one', () => {
    assert.equal(requestIdOf({ headers: { 'x-request-id': 'abc-123' } }), 'abc-123');
    assert.match(requestIdOf({ headers: { 'x-request-id': 'bad id with spaces' } }), /^[0-9a-f-]{36}$/);
    assert.match(requestIdOf({ headers: {} }), /^[0-9a-f-]{36}$/);
  });
});
