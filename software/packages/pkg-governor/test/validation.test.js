import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor } from '../index.js';

// Intent: software/packages/pkg-governor/INTENT.md
//
// A governor validates its child — through the maker's hands, from facts the
// ledger holds. The stamp recipe reports whether the child ships an
// acceptance spec; the governor derives validation work from that fact and
// learns nothing else about what the class is. The spec's content never
// crosses this boundary.

function purringRow(g, token, { checks }) {
  const { row } = g.desire({
    account: 'A', klass: 'univ-demo-crm', matrix: 'demo-crm-nu',
    digest: 'sha256:aa', machine: 'gbs-test', env: 'demo',
  });
  g.poll({ token, host: 'gbs-test', inventory: ['sha256:aa'], version: 't', lanes: 2 });
  g.report({ token, rowId: row.id, event: 'STAMPING' });
  g.report({ token, rowId: row.id, event: 'STAMPED', data: { instance: 'i', checks } });
  return row;
}

const enrolled = (g) => g.enrolMaker({ host: 'gbs-test' }).token;
const workKinds = (g, token) => g.poll({
  token, host: 'gbs-test', inventory: ['sha256:aa'], version: 't', lanes: 2,
}).work.map((w) => w.kind);

describe('the governor derives validation from facts', () => {
  it('a purring child that ships a spec is offered for validation', () => {
    const g = createGovernor();
    const token = enrolled(g);
    const row = purringRow(g, token, { checks: true });
    assert.equal(g.getRow(row.id).state, 'PURRING');
    assert.deepEqual(workKinds(g, token), ['validate']);
  });

  it('a child that ships no spec is never validated — and never faked as validated', () => {
    const g = createGovernor();
    const token = enrolled(g);
    purringRow(g, token, { checks: false });
    assert.deepEqual(workKinds(g, token), []);
  });

  it('a verdict ends the offers, pass or fail', () => {
    const g = createGovernor();
    const token = enrolled(g);
    const row = purringRow(g, token, { checks: true });
    g.report({ token, rowId: row.id, event: 'VALIDATING' });
    assert.deepEqual(workKinds(g, token), [], 'a claimed validation is not re-offered');
    g.report({ token, rowId: row.id, event: 'VALIDATED', data: { passed: true } });
    assert.equal(g.getRow(row.id).state, 'PURRING');
    assert.deepEqual(workKinds(g, token), []);
  });

  it('a failed validation degrades the row — loudly, never silently', () => {
    const g = createGovernor();
    const token = enrolled(g);
    const row = purringRow(g, token, { checks: true });
    g.report({ token, rowId: row.id, event: 'VALIDATING' });
    g.report({
      token, rowId: row.id, event: 'VALIDATION_FAILED',
      data: { passed: false, steps: [{ i: 2, op: 'expectText', ok: false }] },
    });
    assert.equal(g.getRow(row.id).state, 'DEGRADED');
    const kept = g.getRow(row.id).events.find((e) => e.event === 'VALIDATION_FAILED');
    assert.equal(kept.data.steps[0].i, 2, 'the failing step rides the event into the ledger');
  });

  it('a VALIDATING claim that goes silent past its budget is offered again', () => {
    let clock = 1000;
    const g = createGovernor({ now: () => clock });
    const token = enrolled(g);
    const row = purringRow(g, token, { checks: true });
    g.report({ token, rowId: row.id, event: 'VALIDATING' });
    clock += 9 * 60 * 1000;
    assert.deepEqual(workKinds(g, token), [], 'nine minutes is patience');
    clock += 2 * 60 * 1000;
    assert.deepEqual(workKinds(g, token), ['validate'], 'eleven minutes of silence is an event');
  });
});
