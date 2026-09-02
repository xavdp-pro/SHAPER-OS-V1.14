import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor } from '../index.js';

// Intent: software/packages/pkg-governor/INTENT.md#one-live-row
// Intent: software/packages/pkg-governor/INTENT.md#deadlines-are-desired-state
//
// Found by reading, 2 September 2026, before any production row existed.
// "A degraded row is not a life to protect" had been written for the demo
// and generalised to every env: a degraded PROD row re-asked was ended
// (deadline = now) and a twin stamped beside it, while the reap recipe
// refused the end (exit 4) and the governor offered the same reap at every
// beat, five seconds apart, forever. Two living rows for one (account,
// class), and a reap storm on a row no robot may end. Rule 27 bounds every
// corrective loop: exponential backoff, bounded attempts, a resting
// DEGRADED. These tests hold that bound on the governor's own offers.

const ASK = { account: 'A', klass: 'univ-demo-crm', matrix: 'crm', digest: 'sha256:aa', machine: 'gbs-test' };

function world(options = {}) {
  const clock = { t: 1_000_000 };
  const g = createGovernor({ now: () => clock.t, ...options });
  const { token } = g.enrolMaker({ host: 'gbs-test' });
  const offers = () => g.poll({ token, host: 'gbs-test', inventory: ['sha256:aa'] })
    .work.map((w) => `${w.kind}:${w.rowId}`);
  const report = (rowId, event, data = {}) => g.report({ token, rowId, event, data });
  return { g, token, clock, offers, report };
}

describe('a degraded production row is a life a robot may not end', () => {
  it('a degraded prod row is never re-asked into a twin', () => {
    const { g, offers, report, clock } = world();
    const { row } = g.desire({ ...ASK, env: 'prod' });
    report(row.id, 'STAMPING');
    report(row.id, 'STAMPED', { state: 'RUNNING', checks: true });
    report(row.id, 'VALIDATING');
    report(row.id, 'VALIDATION_FAILED', { passed: false });
    assert.equal(g.getRow(row.id).state, 'DEGRADED');

    // The account presses the remote again.
    const again = g.desire({ ...ASK, env: 'prod' });
    assert.equal(again.refused, true, 'a re-ask on a degraded prod row must be refused, as a typed fact');
    assert.equal(again.created, false);
    assert.equal(again.row.id, row.id, 'the refusal names the row a human must end');
    assert.match(again.reason, /production/);
    assert.equal(g.listRows().length, 1, 'a twin was born beside the degraded prod row');
    assert.equal(g.getRow(row.id).deadlineAt, null, 'the prod row was scheduled for a reap no robot may perform');
    clock.t += 1;
    assert.deepEqual(offers(), [], 'nothing is owed on a resting prod row');
  });

  it('a prod row past its deadline is offered once, then rests', () => {
    const { g, offers, report, clock } = world();
    const { row } = g.desire({
      ...ASK, env: 'prod', deadlineAt: new Date(clock.t + 1000).toISOString(),
    });
    report(row.id, 'STAMPING');
    report(row.id, 'STAMPED', { state: 'RUNNING', checks: false });
    clock.t += 1001;
    assert.deepEqual(offers(), [`reap:${row.id}`], 'the deadline is desired state: the end is offered');

    // The maker's recipe looks at env and refuses (exit 4).
    report(row.id, 'REAPING');
    assert.deepEqual(offers(), [], 'a claimed reap is not offered twice');
    report(row.id, 'REAP_REFUSED', { error: 'a robot does not end a production universe', exitCode: 4 });
    assert.equal(g.getRow(row.id).state, 'DEGRADED', 'a refusal rests the row');

    for (const step of [5_000, 60_000, 24 * 3600 * 1000]) {
      clock.t += step;
      assert.deepEqual(offers(), [], `a refused reap was offered again after ${step}ms — the storm is back`);
    }
    assert.equal(g.desire({ ...ASK, env: 'prod' }).refused, true,
      'the slot stays held until a human ends the production universe');
  });
});

describe('a failing reap is bounded (Rule 27)', () => {
  it('a failing reap backs off and stops', () => {
    const { g, offers, report, clock } = world({ maxHealingAttempts: 3, reapBackoffMs: 30_000 });
    const { row } = g.desire({ ...ASK, env: 'demo', deadlineAt: new Date(clock.t + 1000).toISOString() });
    report(row.id, 'STAMPING');
    report(row.id, 'STAMPED', { state: 'RUNNING', checks: false });
    clock.t += 1001;

    // Attempt 1 fails (lxc delete broke). Not again within 30s; again after.
    assert.deepEqual(offers(), [`reap:${row.id}`]);
    report(row.id, 'REAPING');
    report(row.id, 'REAP_FAILED', { error: 'delete failed', exitCode: 1 });
    clock.t += 5_000;
    assert.deepEqual(offers(), [], 'offered again 5s after a failure: no backoff');
    clock.t += 25_000;
    assert.deepEqual(offers(), [`reap:${row.id}`], 'thirty seconds of pause is the first backoff');

    // Attempt 2 fails. The pause doubles.
    report(row.id, 'REAPING');
    report(row.id, 'REAP_FAILED', { error: 'delete failed', exitCode: 1 });
    clock.t += 30_000;
    assert.deepEqual(offers(), [], 'thirty seconds after the second failure is too early: the backoff must double');
    clock.t += 30_000;
    assert.deepEqual(offers(), [`reap:${row.id}`]);

    // Attempt 3 fails: the bound is reached. The row rests, forever.
    report(row.id, 'REAPING');
    report(row.id, 'REAP_FAILED', { error: 'delete failed', exitCode: 1 });
    for (const step of [120_000, 240_000, 7 * 24 * 3600 * 1000]) {
      clock.t += step;
      assert.deepEqual(offers(), [], `a reap was offered past maxHealingAttempts (+${step}ms) — the governor is the storm`);
    }
    assert.equal(g.getRow(row.id).state, 'DEGRADED');
    assert.equal(g.getRow(row.id).events.filter((e) => e.event === 'REAP_FAILED').length, 3);
  });
});

describe('a deadline is desired state, from birth', () => {
  it('a row past its deadline is never stamped', () => {
    const { g, offers, clock } = world();
    const { row } = g.desire({ ...ASK, deadlineAt: new Date(clock.t + 1000).toISOString() });
    clock.t += 2000;
    const offered = offers();
    assert.ok(!offered.includes(`stamp:${row.id}`),
      'a row already past its deadline was stamped — born to be reaped on the next beat');
    // What was never born is offered its end: the recipe proves the absence
    // ("already gone", exit 0) and the slot frees — the governor assumes nothing.
    assert.deepEqual(offered, [`reap:${row.id}`]);
  });
});

describe('a claim is not a tombstone', () => {
  it('a STAMPING claim gone silent is re-offered', () => {
    const { g, offers, report, clock } = world({ claimBudgetMs: 10 * 60 * 1000 });
    const { row } = g.desire(ASK);
    report(row.id, 'STAMPING');
    assert.equal(g.getRow(row.id).state, 'RECONCILING');
    clock.t += 9 * 60 * 1000;
    assert.deepEqual(offers(), [], 'nine minutes is patience');
    clock.t += 2 * 60 * 1000;
    assert.deepEqual(offers(), [`stamp:${row.id}`],
      'a maker that died mid-stamp used to hold the row RECONCILING forever');
    // And the same for a reap claim.
    report(row.id, 'STAMPED', { state: 'RUNNING', checks: false });
    g.getRow(row.id).deadlineAt = new Date(clock.t).toISOString();
    assert.deepEqual(offers(), [`reap:${row.id}`]);
    report(row.id, 'REAPING');
    clock.t += 11 * 60 * 1000;
    assert.deepEqual(offers(), [`reap:${row.id}`], 'a silent REAPING claim is offered again too');
  });

  it('a re-ask pressed twice while the broken row is still being reaped births one row, not two', () => {
    const { g, report } = world();
    const { row } = g.desire(ASK);
    report(row.id, 'STAMPING');
    report(row.id, 'STAMP_FAILED', { error: 'import refused' });
    const fresh = g.desire(ASK);
    assert.equal(fresh.created, true);
    const twice = g.desire(ASK);
    assert.equal(twice.created, false,
      'the second press met the broken row again (ledger order) and birthed a second fresh row');
    assert.equal(twice.row.id, fresh.row.id);
    assert.equal(g.listRows().length, 2, 'one broken row ending, one fresh row — never a third');
  });
});
