import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileStorage, createGovernor } from '../index.js';

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

describe('two names, bound once — found on terrain at the first birth', () => {
  it('work written for the fleet name reaches the maker asking under its hostname', () => {
    const g = createGovernor();
    // The machine answers `vps-053c1354`; the fleet map calls it `gbs-test`.
    const { token } = g.enrolMaker({ host: 'vps-053c1354', fleetName: 'gbs-test' });
    g.desire({
      account: 'a1', klass: 'univ-demo-crm', matrix: 'crm',
      digest: 'sha256:aa', machine: 'gbs-test',
    });
    const out = g.poll({ token, host: 'vps-053c1354', inventory: ['sha256:aa'] });
    assert.equal(out.work.length, 1,
      'a row written for the fleet name found no maker: the two names were never bound, and nothing would ever happen — silently');
  });

  it('a fleet name binds to exactly one host', () => {
    const g = createGovernor();
    g.enrolMaker({ host: 'vps-aaa', fleetName: 'gbs-test' });
    assert.throws(() => g.enrolMaker({ host: 'vps-bbb', fleetName: 'gbs-test' }),
      /already bound/, 'two machines answering to one fleet name would split the ledger in half');
  });

  it('without a fleet name, the hostname is the name — no ceremony for a simple fleet', () => {
    const g = createGovernor();
    const { token, fleetName } = g.enrolMaker({ host: 'solo-host' });
    assert.equal(fleetName, 'solo-host');
    g.desire({ account: 'a1', klass: 'k', matrix: 'm', digest: 'sha256:aa', machine: 'solo-host' });
    assert.equal(g.poll({ token, host: 'solo-host', inventory: ['sha256:aa'] }).work.length, 1);
  });
});

describe('the ledger survives its governor', () => {
  it('a restarted governor recovers its rows, its enrolments and its credentials', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-ledger-'));
    const file = path.join(dir, 'ledger.jsonl');

    const first = createGovernor({ storage: createFileStorage(file) });
    const { token } = first.enrolMaker({ host: 'vps-aaa', fleetName: 'gbs-test' });
    const { row } = first.desire({
      account: 'Atelier Vallier', klass: 'univ-demo-crm', matrix: 'crm',
      digest: 'sha256:aa', machine: 'gbs-test',
      deadlineAt: new Date(Date.now() + 86400000).toISOString(),
    });
    first.report({ token, rowId: row.id, event: 'STAMPED' });

    // The process dies. The universe it asked for is still running out there.
    const second = createGovernor({ storage: createFileStorage(file) });

    const recovered = second.getRow(row.id);
    assert.ok(recovered, 'a governor that forgets its rows abandons every universe it asked for');
    assert.equal(recovered.state, 'PURRING');
    assert.equal(recovered.account, 'Atelier Vallier');

    // The credential still works, and still names the same two names.
    const out = second.poll({ token, host: 'vps-aaa', inventory: ['sha256:aa'] });
    assert.equal(out.ok, true, 'an enrolment lost on restart would silence the whole fleet');
    assert.ok(second.referencedDigests().has('sha256:aa'));

    // And idempotence survives too: no twin after a restart.
    const again = second.desire({
      account: 'Atelier Vallier', klass: 'univ-demo-crm', matrix: 'crm',
      digest: 'sha256:aa', machine: 'gbs-test',
    });
    assert.equal(again.created, false);
    assert.equal(again.row.id, row.id);
  });

  it('without storage it stays in memory — the contract is testable on a naked clone', () => {
    const g = createGovernor();
    g.desire({ account: 'a', klass: 'k', matrix: 'm', digest: 'sha256:aa', machine: 'h' });
    assert.equal(g.listRows().length, 1);
  });
});
