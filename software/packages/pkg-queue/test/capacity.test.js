import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { capacityReport } from '../capacity.js';

const NOW = Date.parse('2026-08-23T12:00:00.000Z');

/** A finished job that took `seconds`, having arrived `agoSeconds` ago. */
const done = (agoSeconds, seconds, status = 'COMPLETED') => ({
  status,
  createdAt: new Date(NOW - agoSeconds * 1000).toISOString(),
  updatedAt: new Date(NOW - (agoSeconds - seconds) * 1000).toISOString(),
});

const arrivals = (count, seconds) => Array.from({ length: count }, (_, i) => done(3500 - i * 10, seconds));

describe('capacity report', () => {
  it('refuses to publish a rate before it has enough samples', () => {
    const r = capacityReport([done(100, 10), done(90, 10)], { lanes: 4, now: NOW });
    assert.equal(r.verdict, 'unmeasured');
    assert.equal(r.throughput, undefined);
    assert.match(r.reason, /needed before a rate means anything/);
  });

  it('derives maximum throughput from lanes and measured service time', () => {
    // 10 jobs of 60 s each, 4 lanes → 4/60 per second → 240 per hour.
    const r = capacityReport(arrivals(10, 60), { lanes: 4, now: NOW });
    assert.equal(r.observed.meanSeconds, 60);
    assert.equal(r.throughput.maxPerHour, 240);
  });

  it('scales throughput linearly with lanes — the point of the parameter', () => {
    const one = capacityReport(arrivals(10, 60), { lanes: 1, now: NOW });
    const four = capacityReport(arrivals(10, 60), { lanes: 4, now: NOW });
    assert.equal(four.throughput.maxPerHour, one.throughput.maxPerHour * 4);
  });

  it('reports the queueing factor, not just the utilisation', () => {
    // Waiting grows as 1/(1−ρ), which is the number an operator actually needs.
    const r = capacityReport(arrivals(10, 60), { lanes: 4, now: NOW });
    const expected = Math.round((1 / (1 - r.throughput.utilisation)) * 100) / 100;
    assert.equal(r.throughput.queueingFactor, expected);
  });

  it('warns well before saturation, because waiting explodes before ρ reaches 1', () => {
    const verdicts = [0.3, 0.6, 0.8, 0.95].map((rho) => {
      // Choose an arrival count that produces the target utilisation:
      // λ = ρ · c/W · 3600, over a one-hour window.
      const seconds = 60, lanes = 4;
      const count = Math.round(rho * (lanes / seconds) * 3600);
      return capacityReport(arrivals(count, seconds), { lanes, now: NOW }).verdict;
    });
    assert.deepEqual(verdicts, ['comfortable', 'healthy', 'saturating', 'saturated']);
  });

  it('counts failed jobs as service time — a failure still consumed a lane', () => {
    const jobs = [...arrivals(5, 60), ...Array.from({ length: 5 }, (_, i) => done(3000 - i * 10, 60, 'FAILED'))];
    const r = capacityReport(jobs, { lanes: 2, now: NOW });
    assert.equal(r.observed.samples, 10);
  });

  it('names both levers: more lanes, or shorter work', () => {
    const r = capacityReport(arrivals(220, 60), { lanes: 4, now: NOW }); // ρ ≈ 0.92
    assert.equal(r.verdict, 'saturated');
    assert.ok(r.levers.lanesForHeadroom > 4, 'must say how many lanes would restore headroom');
    assert.ok(r.levers.meanSecondsForHeadroom < 60, 'must say how fast the work would have to get instead');
  });

  it('separates what is running from what is merely waiting', () => {
    const jobs = [...arrivals(6, 30), { status: 'RUNNING', createdAt: new Date(NOW - 5000).toISOString() },
      { status: 'PENDING', createdAt: new Date(NOW - 1000).toISOString() }];
    const r = capacityReport(jobs, { lanes: 2, now: NOW });
    assert.equal(r.inFlight, 1);
    assert.equal(r.waiting, 1);
  });
});

describe('service time excludes queue wait', () => {
  // The bug this guards: measuring from creation folds waiting into service,
  // and the error grows with load — the busier the queue, the smaller its
  // apparent capacity. Observed once at utilisation 102, from arithmetic alone.
  const waited = (waitSeconds, workSeconds) => ({
    status: 'COMPLETED',
    createdAt: new Date(NOW - (waitSeconds + workSeconds) * 1000).toISOString(),
    result: { startedAt: new Date(NOW - workSeconds * 1000).toISOString() },
    updatedAt: new Date(NOW).toISOString(),
  });

  it('measures the work, not the queue in front of it', () => {
    const jobs = Array.from({ length: 6 }, () => waited(300, 10));
    const r = capacityReport(jobs, { lanes: 2, now: NOW });
    assert.equal(r.observed.meanSeconds, 10, 'five minutes of waiting must not count as service');
    assert.equal(r.throughput.maxPerHour, 720);
  });

  it('falls back to creation time for jobs recorded before the stamp existed', () => {
    const legacy = Array.from({ length: 6 }, () => ({
      status: 'COMPLETED',
      createdAt: new Date(NOW - 20000).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    }));
    const r = capacityReport(legacy, { lanes: 1, now: NOW });
    assert.equal(r.observed.meanSeconds, 20);
  });
});

describe('what belongs in the sample', () => {
  const ran = (endedAgo, workSeconds, extra = {}) => ({
    status: 'COMPLETED',
    createdAt: new Date(NOW - (endedAgo + workSeconds) * 1000).toISOString(),
    result: { startedAt: new Date(NOW - (endedAgo + workSeconds) * 1000).toISOString(), ...extra },
    updatedAt: new Date(NOW - endedAgo * 1000).toISOString(),
  });

  it('ignores orphans, which measure abandonment rather than work', () => {
    // An orphan's span covers however long nobody was watching — hours,
    // sometimes. One of them is enough to invert the whole report.
    const real = Array.from({ length: 6 }, () => ran(10, 3));
    const orphan = { ...ran(10, 7200), status: 'FAILED', result: { orphaned: true } };
    const r = capacityReport([...real, orphan], { lanes: 2, now: NOW });
    assert.equal(r.observed.samples, 6);
    assert.equal(r.observed.meanSeconds, 3);
  });

  it('ignores what finished before the window — capacity describes the present', () => {
    const recent = Array.from({ length: 6 }, () => ran(10, 3));
    const ancient = Array.from({ length: 20 }, () => ran(7200, 300));
    const r = capacityReport([...recent, ...ancient], { lanes: 2, now: NOW, windowSeconds: 60 });
    assert.equal(r.observed.samples, 6);
    assert.equal(r.observed.meanSeconds, 3);
  });

  it('says unmeasured when the window holds too little, rather than guessing', () => {
    const r = capacityReport([ran(10, 3), ran(12, 3)], { lanes: 2, now: NOW, windowSeconds: 60 });
    assert.equal(r.verdict, 'unmeasured');
  });
});

describe('backlog is not utilisation', () => {
  it('reports how long the queue needs to clear, at the measured pace', () => {
    const jobs = [...arrivals(6, 10), ...Array.from({ length: 18 }, (_, i) => ({
      status: 'PENDING', createdAt: new Date(NOW - i * 100).toISOString(),
    }))];
    const r = capacityReport(jobs, { lanes: 2, now: NOW });
    // 18 waiting × 10 s of work, spread over 2 lanes.
    assert.equal(r.backlogSeconds, 90);
  });

  it('is zero when nothing waits, whatever the utilisation', () => {
    assert.equal(capacityReport(arrivals(6, 10), { lanes: 2, now: NOW }).backlogSeconds, 0);
  });

  it('stays low on a burst, because a burst is not an arrival rate', () => {
    // Twenty-five jobs land at once and are absorbed inside the window. ρ stays
    // calm, and is right to: nothing is arriving at that pace. The backlog
    // number is what speaks during the burst; ρ speaks about the load.
    const burst = Array.from({ length: 25 }, (_, i) => ({
      status: 'COMPLETED',
      createdAt: new Date(NOW - 100_000 + i * 10).toISOString(),
      result: { startedAt: new Date(NOW - 90_000 + i * 10).toISOString() },
      updatedAt: new Date(NOW - 87_000 + i * 10).toISOString(),
    }));
    const r = capacityReport(burst, { lanes: 2, now: NOW, windowSeconds: 120 });
    assert.equal(r.verdict !== 'unmeasured', true, 'the window must actually hold the burst');
    assert.ok(r.throughput.utilisation < 1, 'a burst must not read as sustained overload');
  });
});
