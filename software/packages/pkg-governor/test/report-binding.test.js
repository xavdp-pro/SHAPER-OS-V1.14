import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileStorage, createGovernor, createGovernorServer } from '../index.js';

// Intent: software/packages/pkg-governor/INTENT.md#identity-is-the-host
// Intent: software/packages/pkg-governor/INTENT.md#a-birth-is-a-fact
// Intent: software/universes/_maker-template/INTENT.md#never-command-a-host
//
// Found by reading, 2 September 2026. poll() bound a credential to its
// machine and never handed it another machine's rows; report() did not:
// any enrolled token could write any event on any row. A stolen credential
// "impersonates a worker, never commands a host" — but REAPED written on a
// stranger's row frees its slot, dereferences its matrix and births a twin
// at the next ask: the governor's only memory, rewritten. And STAMPED used
// to purr whatever its facts said: a stopped container, or no facts at all,
// was a birth. Q3 of the doctrine — "how do you know it happened? the
// recipe looked, and reported a fact" — must be true of the code.

const ASK = { account: 'A', klass: 'univ-demo-crm', matrix: 'crm', digest: 'sha256:aa' };

describe('a maker reports only for its own machine', () => {
  it('a maker may report only on rows written for its own machine', () => {
    const g = createGovernor();
    const own = g.enrolMaker({ host: 'vps-aaa', fleetName: 'gbs-test' });
    const other = g.enrolMaker({ host: 'vps-bbb', fleetName: 'gbs-p2' });
    const { row } = g.desire({ ...ASK, machine: 'gbs-test' });

    const lie = g.report({ token: other.token, rowId: row.id, event: 'REAPED' });
    assert.equal(lie.ok, false);
    assert.equal(lie.code, 403, 'a credential bound to another machine wrote on this row');
    assert.equal(g.getRow(row.id).state, 'DESIRED', 'the lie reached the ledger');
    assert.equal(g.getRow(row.id).events.length, 0);
    assert.equal(g.desire({ ...ASK, machine: 'gbs-test' }).created, false, 'the slot was freed by a stranger');

    // The refusal is a security fact, journaled: who, about which row, when.
    const [refusal] = g.listRefusals();
    assert.equal(refusal.host, 'vps-bbb');
    assert.equal(refusal.rowId, row.id);
    assert.equal(refusal.event, 'REAPED');
    assert.ok(refusal.at);

    // Its own machine's rows, under either of its two names, it may report on.
    assert.equal(g.report({ token: own.token, rowId: row.id, event: 'STAMPING' }).ok, true);
    const { row: byHost } = g.desire({ ...ASK, account: 'B', machine: 'vps-aaa' });
    assert.equal(g.report({ token: own.token, rowId: byHost.id, event: 'STAMPING' }).ok, true);
  });

  it('the journal of refusals survives the governor', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-refusals-'));
    const file = path.join(dir, 'ledger.jsonl');
    const first = createGovernor({ storage: createFileStorage(file) });
    const other = first.enrolMaker({ host: 'vps-bbb', fleetName: 'gbs-p2' });
    const { row } = first.desire({ ...ASK, machine: 'gbs-test' });
    first.report({ token: other.token, rowId: row.id, event: 'REAPED' });
    const second = createGovernor({ storage: createFileStorage(file) });
    assert.equal(second.listRefusals().length, 1, 'a security fact forgotten at restart was never a fact');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('a birth is a fact, not a claim', () => {
  it('a stamp that reports a stopped container never purrs', () => {
    const g = createGovernor();
    const { token } = g.enrolMaker({ host: 'gbs-test' });
    const { row } = g.desire({ ...ASK, machine: 'gbs-test' });
    g.report({ token, rowId: row.id, event: 'STAMPING' });
    const out = g.report({ token, rowId: row.id, event: 'STAMPED', data: { instance: 'i', state: 'STOPPED', checks: true } });
    assert.equal(out.ok, true, 'the report is recorded — it is the fact that is judged');
    assert.equal(g.getRow(row.id).state, 'DEGRADED', 'a stopped container was taken for a birth');
    assert.deepEqual(out.unmet, ['state']);
    assert.deepEqual(g.getRow(row.id).events.at(-1).unmet, ['state'], 'the ledger says which fact was missing');
    assert.deepEqual(g.poll({ token, host: 'gbs-test', inventory: ['sha256:aa'] }).work, [],
      'a degraded child is not offered for validation');
  });

  it('a STAMPED without facts is not a birth either, and RUNNING in any case is', () => {
    const g = createGovernor();
    const { token } = g.enrolMaker({ host: 'gbs-test' });
    const { row: mute } = g.desire({ ...ASK, machine: 'gbs-test' });
    g.report({ token, rowId: mute.id, event: 'STAMPED', data: { stdout: 'just words' } });
    assert.equal(g.getRow(mute.id).state, 'DEGRADED', 'a tail of prose was taken for a birth');
    // LXD's list column says RUNNING, its API says Running: the word, not its case.
    for (const state of ['RUNNING', 'Running']) {
      const { row } = g.desire({ ...ASK, account: `acct-${state}`, machine: 'gbs-test' });
      g.report({ token, rowId: row.id, event: 'STAMPED', data: { state } });
      assert.equal(g.getRow(row.id).state, 'PURRING', `a container reported ${state} must purr`);
    }
  });
});

describe('the door answers enrol, poll, events — nothing else', () => {
  it('a report is accepted only at /api/work/<rowId>/events', async () => {
    const governor = createGovernor();
    const server = createGovernorServer({ governor, adminToken: 'tandem-secret' });
    await new Promise((r) => server.on('listening', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const { token } = governor.enrolMaker({ host: 'gbs-test' });
    const { row } = governor.desire({ ...ASK, machine: 'gbs-test' });
    const post = (p) => fetch(`${url}${p}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'REAPED', data: {} }),
    });
    try {
      for (const stray of [`/api/work/${row.id}`, `/api/work/${row.id}/anything`, `/api/work/${row.id}/events/more`]) {
        assert.equal((await post(stray)).status, 404, `${stray} was taken for a report`);
      }
      assert.equal(governor.getRow(row.id).state, 'DESIRED', 'a stray route reached the ledger');
      const exact = await post(`/api/work/${row.id}/events`);
      assert.equal(exact.status, 200);
      assert.equal(governor.getRow(row.id).state, 'REAPED');
    } finally {
      server.close();
    }
  });
});
