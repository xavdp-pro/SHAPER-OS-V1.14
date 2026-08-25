import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectivePriority, selectNext } from '../worker.js';

const T0 = Date.parse('2026-08-23T12:00:00.000Z');
const at = (secondsAgo, priority, conversation = 'pod-a', id = `job-${secondsAgo}-${priority}`) => ({
  id,
  createdAt: new Date(T0 - secondsAgo * 1000).toISOString(),
  payload: { conversation, priority },
});

describe('effective priority', () => {
  it('is the declared priority when the job has just arrived', () => {
    assert.equal(effectivePriority(at(0, 5), T0, 60), 5);
  });

  it('gains one rank per aging period spent waiting', () => {
    assert.equal(effectivePriority(at(59, 5), T0, 60), 5);
    assert.equal(effectivePriority(at(60, 5), T0, 60), 6);
    assert.equal(effectivePriority(at(600, 5), T0, 60), 15);
  });

  it('defaults to the middle of the range when no priority is declared', () => {
    assert.equal(effectivePriority({ createdAt: new Date(T0).toISOString(), payload: {} }, T0, 60), 5);
  });

  it('lets the aging constant choose between fair queue and strict priority', () => {
    const old = at(300, 1);
    // Fast aging: five minutes of patience outranks a fresh priority 5.
    assert.ok(effectivePriority(old, T0, 10) > 5);
    // Slow aging: the same wait barely moves it.
    assert.equal(effectivePriority(old, T0, 3600), 1);
  });
});

describe('scheduling', () => {
  const none = new Set();

  it('prefers the higher declared priority when ages match', () => {
    const low = at(0, 2, 'pod-a', 'low');
    const high = at(0, 8, 'pod-b', 'high');
    assert.equal(selectNext([low, high], none, T0, 60).id, 'high');
  });

  it('breaks ties by arrival order, so the choice is replayable', () => {
    const first = at(30, 5, 'pod-a', 'first');
    const second = at(10, 5, 'pod-b', 'second');
    assert.equal(selectNext([second, first], none, T0, 60).id, 'first');
  });

  it('never starts two jobs for the same pod', () => {
    const busy = at(0, 9, 'pod-a', 'urgent-but-busy');
    const free = at(0, 1, 'pod-b', 'humble-but-free');
    const chosen = selectNext([busy, free], new Set(['pod-a']), T0, 60);
    assert.equal(chosen.id, 'humble-but-free');
  });

  it('returns null when every waiting job belongs to a busy pod', () => {
    assert.equal(selectNext([at(0, 9, 'pod-a')], new Set(['pod-a']), T0, 60), null);
  });

  it('returns null on an empty queue', () => {
    assert.equal(selectNext([], none, T0, 60), null);
  });

  // ── The property that makes this more than a heuristic ────────────────────

  it('cannot starve a low-priority job, however many urgent ones arrive', () => {
    // A priority-0 job waits. Every aging period, a fresh priority-9 job lands.
    // Under strict priority it would never run. Aging guarantees it eventually
    // outranks every newcomer — here, after 10 periods.
    const humble = at(0, 0, 'pod-humble', 'humble');
    let served = false;

    for (let period = 1; period <= 12 && !served; period++) {
      const now = T0 + period * 60_000;
      const newcomer = { id: `urgent-${period}`, createdAt: new Date(now).toISOString(), payload: { conversation: `pod-${period}`, priority: 9 } };
      served = selectNext([humble, newcomer], new Set(), now, 60).id === 'humble';
    }

    assert.ok(served, 'a waiting job must eventually outrank an endless stream of urgent newcomers');
  });

  it('serves the urgent newcomer first, until patience has been earned', () => {
    const humble = at(0, 0, 'pod-humble', 'humble');
    const urgent = { id: 'urgent', createdAt: new Date(T0 + 60_000).toISOString(), payload: { conversation: 'pod-u', priority: 9 } };
    // One period in: humble is at 0+1, urgent at 9. Urgency still wins, as it should.
    assert.equal(selectNext([humble, urgent], new Set(), T0 + 60_000, 60).id, 'urgent');
  });
});
