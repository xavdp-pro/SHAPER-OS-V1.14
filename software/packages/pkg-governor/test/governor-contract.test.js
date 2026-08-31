import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor } from '../index.js';

// Intent: software/packages/pkg-governor/INTENT.md
//
// The governor's contract, as tests. Each block holds one invariant of the
// design closed on 31 August: identity is the host, enrolment is the
// tandem's act, no work for unproven bytes, desired state is idempotent,
// the poll is the heartbeat, deadlines are desired state, and a referenced
// matrix may never be deleted.

function governorWithMaker(nowRef = { t: 1_000_000 }) {
  const g = createGovernor({ now: () => nowRef.t });
  const { token } = g.enrolMaker({ host: 'gbs-test' });
  return { g, token, nowRef };
}

describe('identity is the host', () => {
  it('refuses a poll without enrolment, and a credential used from another host', () => {
    const { g, token } = governorWithMaker();
    assert.equal(g.poll({ token: 'forged', host: 'gbs-test' }).code, 401);
    const wrongHost = g.poll({ token, host: 'gbs-p2' });
    assert.equal(wrongHost.code, 403);
    assert.match(wrongHost.error, /identity is its host/);
  });

  it('enrolment is once per host — the fleet is not a place one walks into', () => {
    const { g } = governorWithMaker();
    assert.throws(() => g.enrolMaker({ host: 'gbs-test' }), /already enrolled/);
  });
});

describe('desired state is idempotent', () => {
  it('the double-click births one universe', () => {
    const { g } = governorWithMaker();
    const ask = { account: 'a1', klass: 'univ-demo-crm', matrix: 'crm', digest: 'sha256:aa', machine: 'gbs-test' };
    const first = g.desire(ask);
    const second = g.desire(ask);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.row.id, first.row.id);
    assert.equal(g.listRows().length, 1);
  });

  it('a reaped row frees the slot: the visitor may come back', () => {
    const { g, token } = governorWithMaker();
    const ask = { account: 'a1', klass: 'univ-demo-crm', matrix: 'crm', digest: 'sha256:aa', machine: 'gbs-test' };
    const { row } = g.desire(ask);
    g.report({ token, rowId: row.id, event: 'REAPED' });
    assert.equal(g.desire(ask).created, true);
  });
});

describe('no work for bytes unproven', () => {
  it('withholds work whose digest the maker has not declared, and orders a preload', () => {
    const { g, token } = governorWithMaker();
    g.desire({ account: 'a1', klass: 'univ-demo-crm', matrix: 'crm', digest: 'sha256:absent', machine: 'gbs-test' });
    const empty = g.poll({ token, host: 'gbs-test', inventory: [] });
    assert.equal(empty.work.length, 0, 'work was handed to a host that never proved it holds the bytes');
    assert.deepEqual(empty.preload, ['sha256:absent']);
    const stocked = g.poll({ token, host: 'gbs-test', inventory: ['sha256:absent'] });
    assert.equal(stocked.work.length, 1);
    assert.equal(stocked.work[0].kind, 'stamp');
  });

  it('never assigns another machine\'s rows', () => {
    const { g, token } = governorWithMaker();
    g.desire({ account: 'a1', klass: 'univ-demo-crm', matrix: 'crm', digest: 'sha256:aa', machine: 'gbs-p2' });
    const out = g.poll({ token, host: 'gbs-test', inventory: ['sha256:aa'] });
    assert.equal(out.work.length, 0);
  });
});

describe('the poll is the heartbeat', () => {
  it('dates every ask, and lists the silent host — never the talking one', () => {
    const nowRef = { t: 1_000_000 };
    const g = createGovernor({ now: () => nowRef.t });
    const a = g.enrolMaker({ host: 'gbs-test' });
    g.enrolMaker({ host: 'gbs-p2' });
    g.poll({ token: a.token, host: 'gbs-test', inventory: [] });
    nowRef.t += 60_000;
    const silent = g.silentMakers({ maxAgeMs: 30_000 });
    assert.deepEqual(silent.map((s) => s.host).sort(), ['gbs-p2', 'gbs-test']);
    g.poll({ token: a.token, host: 'gbs-test', inventory: [] });
    const after = g.silentMakers({ maxAgeMs: 30_000 });
    assert.deepEqual(after.map((s) => s.host), ['gbs-p2'],
      'a maker that never polled must stay listed; the one that just asked must not');
  });
});

describe('deadlines are desired state', () => {
  it('a row past its deadline yields reap work on the next poll — no timer inside a robot', () => {
    const { g, token, nowRef } = governorWithMaker();
    const { row } = g.desire({
      account: 'a1', klass: 'univ-demo-crm', matrix: 'crm', digest: 'sha256:aa',
      machine: 'gbs-test', deadlineAt: new Date(nowRef.t + 3 * 24 * 3600 * 1000).toISOString(),
    });
    g.report({ token, rowId: row.id, event: 'STAMPED' });
    assert.equal(g.getRow(row.id).state, 'PURRING');
    const before = g.poll({ token, host: 'gbs-test', inventory: ['sha256:aa'] });
    assert.equal(before.work.length, 0, 'a living row before its deadline owes nothing');
    nowRef.t += 3 * 24 * 3600 * 1000 + 1;
    const due = g.poll({ token, host: 'gbs-test', inventory: ['sha256:aa'] });
    assert.equal(due.work.length, 1);
    assert.equal(due.work[0].kind, 'reap');
    g.report({ token, rowId: row.id, event: 'REAPED' });
    assert.equal(g.getRow(row.id).state, 'REAPED');
    const after = g.poll({ token, host: 'gbs-test', inventory: ['sha256:aa'] });
    assert.equal(after.work.length, 0, 'REAPED is terminal');
  });
});

describe('events are a table, not branches', () => {
  it('an unknown event is recorded for audit and transitions nothing', () => {
    const { g, token } = governorWithMaker();
    const { row } = g.desire({ account: 'a1', klass: 'univ-demo-crm', matrix: 'crm', digest: 'sha256:aa', machine: 'gbs-test' });
    const out = g.report({ token, rowId: row.id, event: 'SOMETHING_NEW', data: { note: 'kept' } });
    assert.equal(out.ok, true);
    assert.equal(g.getRow(row.id).state, 'DESIRED');
    assert.equal(g.getRow(row.id).events.at(-1).event, 'SOMETHING_NEW');
  });
});

describe('a referenced matrix may never be deleted', () => {
  it('the ledger is the reference counter', () => {
    const { g, token } = governorWithMaker();
    const { row } = g.desire({ account: 'a1', klass: 'univ-demo-crm', matrix: 'crm', digest: 'sha256:aa', machine: 'gbs-test' });
    assert.ok(g.referencedDigests().has('sha256:aa'));
    g.report({ token, rowId: row.id, event: 'REAPED' });
    assert.ok(!g.referencedDigests().has('sha256:aa'),
      'a digest no living row references is releasable');
  });
});
