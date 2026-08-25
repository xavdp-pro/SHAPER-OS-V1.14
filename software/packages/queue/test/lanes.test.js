import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextLaneCount, throughputPerMinute } from '../lanes.js';

const base = { lanes: 2, min: 1, max: 8, waiting: 5, busyLanes: 2, throughput: 10 };

describe('throughputPerMinute', () => {
  it('turns a count and a duration into a rate', () => {
    assert.equal(throughputPerMinute({ completed: 30, seconds: 60 }), 30);
    assert.equal(throughputPerMinute({ completed: 30, seconds: 30 }), 60);
  });

  it('answers zero rather than dividing by zero', () => {
    assert.equal(throughputPerMinute({ completed: 5, seconds: 0 }), 0);
  });
});

describe('widening', () => {
  it('widens when every lane is busy and work is waiting', () => {
    const d = nextLaneCount(base);
    assert.equal(d.lanes, 3);
    assert.equal(d.action, 'widen');
  });

  it('holds when a lane is already free — width is not the limit', () => {
    const d = nextLaneCount({ ...base, busyLanes: 1 });
    assert.equal(d.action, 'hold');
    assert.match(d.why, /already free/);
  });

  it('holds at the operator ceiling, whatever the pressure', () => {
    // An operator's maximum is a fact about the machine and the budget.
    // No measurement may override it.
    const d = nextLaneCount({ ...base, lanes: 8, busyLanes: 8, waiting: 100 });
    assert.equal(d.lanes, 8);
    assert.match(d.why, /operator ceiling/);
  });
});

describe('the experiment that makes this honest', () => {
  it('keeps a widening that raised throughput', () => {
    const d = nextLaneCount({ ...base, lanes: 3, busyLanes: 3, lastAction: 'widen', lastThroughput: 10, throughput: 14 });
    assert.equal(d.action, 'widen');
    assert.equal(d.lanes, 4);
  });

  it('reverts a widening that did not, and records the ceiling', () => {
    // The bottleneck was upstream: more lanes spread the same work thinner.
    const d = nextLaneCount({ ...base, lanes: 3, busyLanes: 3, lastAction: 'widen', lastThroughput: 10, throughput: 10.2 });
    assert.equal(d.action, 'narrow');
    assert.equal(d.lanes, 2);
    assert.equal(d.ceiling, 3);
    assert.match(d.why, /bottleneck is not here/);
  });

  it('treats a throughput drop as a failed experiment too', () => {
    const d = nextLaneCount({ ...base, lanes: 3, busyLanes: 3, lastAction: 'widen', lastThroughput: 10, throughput: 6 });
    assert.equal(d.lanes, 2);
    assert.equal(d.ceiling, 3);
  });

  it('does not retry a width already measured as no better', () => {
    // Without memory this would oscillate for ever, widening every cycle.
    const d = nextLaneCount({ ...base, lanes: 2, busyLanes: 2, waiting: 20, ceiling: 3 });
    assert.equal(d.action, 'hold');
    assert.match(d.why, /already measured as no better/);
  });
});

describe('narrowing', () => {
  it('waits for sustained quiet before giving a lane back', () => {
    assert.equal(nextLaneCount({ ...base, waiting: 0, quietCycles: 0 }).action, 'hold');
    assert.equal(nextLaneCount({ ...base, waiting: 0, quietCycles: 1 }).action, 'hold');
    assert.equal(nextLaneCount({ ...base, waiting: 0, quietCycles: 2 }).action, 'narrow');
  });

  it('never narrows below the operator floor', () => {
    const d = nextLaneCount({ ...base, lanes: 1, min: 1, waiting: 0, quietCycles: 99 });
    assert.equal(d.lanes, 1);
    assert.equal(d.action, 'hold');
  });

  it('a lull does not undo a discovery: quiet narrows, pressure widens again', () => {
    const quiet = nextLaneCount({ ...base, lanes: 4, waiting: 0, quietCycles: 5 });
    assert.equal(quiet.lanes, 3);
    const busy = nextLaneCount({ ...base, lanes: 3, busyLanes: 3, waiting: 7 });
    assert.equal(busy.lanes, 4);
  });
});

describe('bounds hold in every direction', () => {
  it('never returns a width outside [min, max]', () => {
    const cases = [
      { ...base, lanes: 1, min: 1, max: 1, busyLanes: 1, waiting: 50 },
      { ...base, lanes: 8, min: 2, max: 8, waiting: 0, quietCycles: 99 },
      { ...base, lanes: 2, min: 2, max: 4, waiting: 0, quietCycles: 99 },
    ];
    for (const c of cases) {
      const d = nextLaneCount(c);
      assert.ok(d.lanes >= c.min && d.lanes <= c.max, `${d.lanes} outside [${c.min}, ${c.max}]`);
    }
  });
});

describe('who is allowed to decide', () => {
  it('is a pure function: same evidence, same answer, nothing mutated', () => {
    // The parent calls this; the child never calls it on itself. Purity is what
    // makes that enforceable — there is no loop here to accidentally wire in.
    const evidence = Object.freeze({ ...base, lanes: 3, busyLanes: 3 });
    const first = nextLaneCount(evidence);
    const second = nextLaneCount(evidence);
    assert.deepEqual(first, second);
    assert.equal(evidence.lanes, 3, 'the evidence handed in must come back untouched');
  });

  it('answers with a decision, never applies it', () => {
    const d = nextLaneCount({ ...base, busyLanes: 2 });
    assert.equal(typeof d.lanes, 'number');
    assert.equal(typeof d.why, 'string', 'a decision must carry its reason, so the parent can be audited');
  });
});
