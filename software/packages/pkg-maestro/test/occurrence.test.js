import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_ANCHOR_AT,
  MAX_MISSED_ROWS_PER_EVALUATION,
  OCCURRENCE_QUERY_DEFAULT_LIMIT,
  ScheduleError,
  classifyQueueAnswer,
  firstInstantAtOrAfter,
  normalizeDeclaration,
  occurrenceId,
  parseOccurrenceQuery,
  planEvaluation,
  retryDelayMs,
  scheduleRevision,
} from '../occurrence.js';
import { occurrenceRequestText } from '../queue-beat.js';
import { buildOccurrenceRequest } from '../durable-scheduler.js';

// Intent: software/packages/pkg-maestro/INTENT.md#private-mariadb
// Non-regression (Rule 29): Maestro kept its registry, timer phase and counters
// in memory, so a restart forgot which instants it had already handed to Queue
// and paced itself from whenever the process happened to start. These tests
// hold the pure half of the durable model — identity, planned instants,
// policies, the Queue answer table — where no database is needed. Persistence
// itself is proven only against the real private MariaDB, by the universe.

const UNIVERSE = 'univ-proof-dev';
const REV = 'a'.repeat(64);
const T0 = Date.parse('2026-09-24T10:00:00.000Z');

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

describe('an occurrence is named by what it is, never by when it was noticed', () => {
  const base = { universeId: UNIVERSE, scheduleId: 'task-proof', revision: REV, plannedAt: '2026-09-24T10:05:00.000Z' };

  it('is occ- + SHA-256 of universe|schedule|revision|planned instant in ISO UTC', () => {
    const id = occurrenceId(base);
    assert.match(id, /^occ-[0-9a-f]{64}$/);
    assert.equal(id, `occ-${sha(`${UNIVERSE}|task-proof|${REV}|2026-09-24T10:05:00.000Z`)}`);
    assert.equal(id, occurrenceId({ ...base }), 'the same inputs give the same id, every time');
  });

  it('does not depend on how the instant is spelled', () => {
    const id = occurrenceId(base);
    for (const plannedAt of [
      '2026-09-24T10:05:00Z',
      '2026-09-24T12:05:00+02:00',
      Date.parse('2026-09-24T10:05:00.000Z'),
      new Date('2026-09-24T10:05:00.000Z'),
    ]) {
      assert.equal(occurrenceId({ ...base, plannedAt }), id, String(plannedAt));
    }
  });

  it('changes with the universe, the schedule, the revision and the instant', () => {
    const id = occurrenceId(base);
    assert.notEqual(occurrenceId({ ...base, universeId: 'univ-proof-test' }), id);
    assert.notEqual(occurrenceId({ ...base, scheduleId: 'task-proof-2' }), id);
    assert.notEqual(occurrenceId({ ...base, revision: 'b'.repeat(64) }), id);
    assert.notEqual(occurrenceId({ ...base, plannedAt: '2026-09-24T10:05:00.001Z' }), id, 'one millisecond is another occurrence');
  });

  it('refuses an identity it cannot build unambiguously', () => {
    assert.throws(() => occurrenceId({ ...base, universeId: '' }), (e) => e.code === 'UNIVERSE_ID_MISSING');
    assert.throws(() => occurrenceId({ ...base, universeId: 'univ|x' }), (e) => e.code === 'UNIVERSE_ID_INVALID');
    assert.throws(() => occurrenceId({ ...base, scheduleId: 'a|b' }), ScheduleError);
    assert.throws(() => occurrenceId({ ...base, revision: 'nothex' }), ScheduleError);
    assert.throws(() => occurrenceId({ ...base, plannedAt: 'yesterday' }), ScheduleError);
  });
});

describe('a revision is the declaration, canonically', () => {
  const declared = {
    slug: 'task-base-proof', kind: 'generic', bridgeType: 'opencode',
    instruction: 'Run the declared base proof task and report evidence.', cadenceSeconds: 300,
  };

  it('does not change with key order or with defaults written out', () => {
    const reordered = Object.fromEntries(Object.entries(declared).reverse());
    assert.equal(scheduleRevision(reordered), scheduleRevision(declared));
    assert.equal(
      scheduleRevision({ ...declared, missedPolicy: 'skip', anchorAt: DEFAULT_ANCHOR_AT, enabled: true, jobType: 'agent.inject' }),
      scheduleRevision(declared),
    );
    assert.match(scheduleRevision(declared), /^[0-9a-f]{64}$/);
  });

  it('changes when the declaration changes', () => {
    const rev = scheduleRevision(declared);
    assert.notEqual(scheduleRevision({ ...declared, cadenceSeconds: 60 }), rev);
    assert.notEqual(scheduleRevision({ ...declared, instruction: 'Something else.' }), rev);
    assert.notEqual(scheduleRevision({ ...declared, missedPolicy: 'coalesce_latest' }), rev);
    assert.notEqual(scheduleRevision({ ...declared, enabled: false }), rev);
  });

  it('is computed on a normalized form that normalizes to itself', () => {
    const once = normalizeDeclaration(declared);
    assert.deepEqual(normalizeDeclaration(once), once);
    assert.equal(scheduleRevision(once), scheduleRevision(declared));
  });

  it('stores the missed policy explicitly, skip by default', () => {
    const n = normalizeDeclaration({ slug: 'task-minimal' });
    assert.equal(n.missedPolicy, 'skip');
    assert.equal(n.cadenceSeconds, 300);
    assert.equal(n.lateToleranceSeconds, 30);
    assert.equal(n.anchorAt, DEFAULT_ANCHOR_AT);
    assert.equal(n.jobType, 'agent.inject');
    assert.equal(n.label, null, 'nothing is invented for a task that declares none');
    assert.equal(n.port, null);
  });
});

describe('a declaration Maestro does not fully understand is refused whole', () => {
  const refuses = (task, pattern) => assert.throws(
    () => normalizeDeclaration(task),
    (e) => e instanceof ScheduleError && e.code === 'INVALID_SCHEDULE' && pattern.test(e.message),
  );

  it('needs a slug fit to be a schedule id and a URL segment', () => {
    refuses({ kind: 'generic' }, /slug is required/);
    refuses({ slug: 'a/b' }, /slug must match/);
    refuses({ slug: 'a|b' }, /slug must match/);
  });

  it('refuses unknown kinds, cadences and anchors', () => {
    refuses({ slug: 'task-x', kind: 'mail' }, /unknown task kind/);
    refuses({ slug: 'task-x', cadenceSeconds: 0 }, /cadenceSeconds/);
    refuses({ slug: 'task-x', cadenceSeconds: 1.5 }, /cadenceSeconds/);
    refuses({ slug: 'task-x', cadenceSeconds: '60' }, /cadenceSeconds/);
    refuses({ slug: 'task-x', anchorAt: '2026-09-24 10:00' }, /anchorAt/);
    refuses({ slug: 'task-x', jobType: 'Agent Inject' }, /jobType/);
    refuses({ slug: 'task-x', cadenceSeconds: 60, lateToleranceSeconds: 61 }, /lateToleranceSeconds/);
  });

  it('refuses the policies the target names but this build does not implement', () => {
    refuses({ slug: 'task-x', missedPolicy: 'catch_up_bounded' }, /not implemented/);
    refuses({ slug: 'task-x', missedPolicy: 'halt' }, /not implemented/);
    refuses({ slug: 'task-x', missedPolicy: 'replay_everything' }, /missedPolicy must be one of/);
  });
});

describe('planned instants come from the anchor and the cadence, never from the timer', () => {
  const schedule = {
    anchorMs: Date.parse(DEFAULT_ANCHOR_AT), cadenceSeconds: 60, missedPolicy: 'skip', lateToleranceSeconds: 30,
  };

  it('plans the first instant at or after the moment the revision became active', () => {
    const activeFromMs = T0 + 7_000; // materialized at 10:00:07
    assert.equal(firstInstantAtOrAfter(schedule.anchorMs, 60, activeFromMs), T0 + 60_000);
    const early = planEvaluation({ ...schedule, activeFromMs, nowMs: T0 + 59_000 });
    assert.equal(early.dueMs, null, 'nothing is due before the first instant');
    assert.deepEqual(early.missed, [], 'instants before the schedule existed are neither due nor missed');
    assert.equal(early.nextDueMs, T0 + 60_000);
  });

  it('names the same instant whether the timer fires early or late within tolerance', () => {
    const activeFromMs = T0 + 7_000;
    const prompt = planEvaluation({ ...schedule, activeFromMs, nowMs: T0 + 60_004 });
    const sluggish = planEvaluation({ ...schedule, activeFromMs, nowMs: T0 + 60_000 + 29_000 });
    assert.equal(prompt.dueMs, T0 + 60_000);
    assert.equal(sluggish.dueMs, T0 + 60_000);
    assert.equal(prompt.nextDueMs, T0 + 120_000);
  });

  it('computes the same instants across a restart as without one', () => {
    const activeFromMs = T0;
    // One process, evaluating every cadence for five minutes.
    const continuous = [];
    let last = null;
    for (let t = T0; t <= T0 + 300_000; t += 60_000) {
      const p = planEvaluation({ ...schedule, activeFromMs, lastPlannedMs: last, nowMs: t + 3 });
      if (p.dueMs !== null) continuous.push(p.dueMs);
      last = p.lastPlannedMs;
    }
    // The same five minutes, with a restart that forgets everything in memory:
    // only anchor, cadence, activeFrom and lastPlanned survive — as in MariaDB.
    const restarted = [];
    let stored = null;
    for (let t = T0; t <= T0 + 120_000; t += 60_000) {
      const p = planEvaluation({ ...schedule, activeFromMs, lastPlannedMs: stored, nowMs: t + 3 });
      if (p.dueMs !== null) restarted.push(p.dueMs);
      stored = p.lastPlannedMs;
    }
    // … process gone, then back 9 seconds after 10:02:00 was already planned …
    for (let t = T0 + 180_000; t <= T0 + 300_000; t += 60_000) {
      const p = planEvaluation({ ...schedule, activeFromMs, lastPlannedMs: stored, nowMs: t + 9 });
      if (p.dueMs !== null) restarted.push(p.dueMs);
      stored = p.lastPlannedMs;
    }
    assert.deepEqual(restarted, continuous);
    assert.deepEqual(continuous, [0, 1, 2, 3, 4, 5].map((k) => T0 + k * 60_000));
    const ids = (list) => list.map((ms) => occurrenceId({ universeId: UNIVERSE, scheduleId: 'task-proof', revision: REV, plannedAt: ms }));
    assert.deepEqual(ids(restarted), ids(continuous), 'the same instants, therefore the same Queue keys');
  });

  it('never plans an instant twice, even when the clock goes backwards', () => {
    const p = planEvaluation({ ...schedule, activeFromMs: T0, lastPlannedMs: T0 + 120_000, nowMs: T0 + 30_000 });
    assert.equal(p.dueMs, null);
    assert.deepEqual(p.missed, []);
    assert.equal(p.lastPlannedMs, T0 + 120_000);
    assert.equal(p.nextDueMs, T0 + 180_000);
  });

  it('starts no earlier than a declared anchor', () => {
    const anchorMs = T0 + 3_600_000;
    const p = planEvaluation({ ...schedule, anchorMs, activeFromMs: T0, nowMs: T0 + 600_000 });
    assert.equal(p.dueMs, null);
    assert.equal(p.nextDueMs, anchorMs);
  });
});

describe('missed occurrences follow the stored policy', () => {
  // Down from just after 10:01:00 was planned until 10:06:02: 10:02 … 10:06 passed.
  const gap = {
    anchorMs: Date.parse(DEFAULT_ANCHOR_AT), cadenceSeconds: 60, lateToleranceSeconds: 30,
    activeFromMs: T0, lastPlannedMs: T0 + 60_000,
  };
  const instants = [2, 3, 4, 5, 6].map((k) => T0 + k * 60_000);

  it('skip: the latest instant is due when barely late, the others are MISSED and not replayed', () => {
    const p = planEvaluation({ ...gap, missedPolicy: 'skip', nowMs: T0 + 362_000 });
    assert.equal(p.dueMs, instants[4]);
    assert.deepEqual(p.missed.map((m) => m.plannedMs), instants.slice(0, 4));
    assert.ok(p.missed.every((m) => m.reason === 'late_beyond_tolerance'));
    assert.equal(p.missedCount, 4);
    assert.equal(p.lastPlannedMs, instants[4]);
    assert.equal(p.nextDueMs, T0 + 420_000);
  });

  it('skip: when even the latest instant is beyond tolerance, nothing is emitted', () => {
    const p = planEvaluation({ ...gap, missedPolicy: 'skip', nowMs: T0 + 395_000 });
    assert.equal(p.dueMs, null);
    assert.deepEqual(p.missed.map((m) => m.plannedMs), instants);
    assert.equal(p.missedCount, 5);
  });

  it('coalesce_latest: one occurrence at the latest missed instant stands for all of them', () => {
    const p = planEvaluation({ ...gap, missedPolicy: 'coalesce_latest', nowMs: T0 + 395_000 });
    assert.equal(p.dueMs, instants[4]);
    assert.deepEqual(p.missed.map((m) => m.plannedMs), instants.slice(0, 4));
    assert.ok(p.missed.every((m) => m.reason === 'coalesced_into_latest'));
  });

  it('an unsettled occurrence holds the schedule: new instants are MISSED, the backlog stays one', () => {
    for (const missedPolicy of ['skip', 'coalesce_latest']) {
      const p = planEvaluation({ ...gap, missedPolicy, hasUnsettled: true, nowMs: T0 + 362_000 });
      assert.equal(p.dueMs, null, missedPolicy);
      assert.equal(p.missed.length, 5, missedPolicy);
      assert.ok(p.missed.every((m) => m.reason === 'previous_occurrence_unsettled'), missedPolicy);
    }
  });

  it('a long outage writes a bounded number of rows and counts the rest', () => {
    const p = planEvaluation({ ...gap, missedPolicy: 'skip', nowMs: T0 + 86_400_000 + 5_000 });
    assert.equal(p.missed.length, MAX_MISSED_ROWS_PER_EVALUATION);
    assert.equal(p.missedCount, p.missed.length + p.missedNotRecorded);
    assert.ok(p.missedNotRecorded > 1000);
    assert.equal(p.dueMs, T0 + 86_400_000, 'the current instant is still due');
    assert.equal(p.missed[p.missed.length - 1].plannedMs, T0 + 86_400_000 - 60_000, 'the most recent misses are the ones recorded');
  });
});

describe('what a Queue answer means', () => {
  const job = { id: 'job-1', status: 'PENDING' };
  const table = [
    ['201 created', { status: 201, body: { job, duplicate: false } }, 'enqueued', 'queue_created'],
    ['200 duplicate', { status: 200, body: { job, duplicate: true } }, 'enqueued', 'queue_duplicate_accepted'],
    ['201 without the duplicate flag', { status: 201, body: { job } }, 'enqueued', 'queue_accepted_idempotency_unconfirmed'],
    ['200 without a job id', { status: 200, body: { duplicate: true } }, 'retry', 'queue_answer_without_job'],
    ['409 idempotency conflict', { status: 409, body: { code: 'IDEMPOTENCY_CONFLICT', error: 'different request' } }, 'conflict', 'queue_idempotency_conflict'],
    ['409 other conflict', { status: 409, body: { code: 'SOMETHING_ELSE' } }, 'rejected', 'queue_conflict_409'],
    ['400 validation', { status: 400, body: { error: 'bad payload' } }, 'rejected', 'queue_rejected_400'],
    ['401 unauthorized', { status: 401, body: {} }, 'rejected', 'queue_rejected_401'],
    ['429 busy', { status: 429, body: {} }, 'retry', 'queue_busy_429'],
    ['500 error', { status: 500, body: null }, 'retry', 'queue_error_500'],
    ['503 unavailable', { status: 503, body: { error: 'storage down' } }, 'retry', 'queue_error_503'],
    ['network error', { error: new Error('connect ECONNREFUSED 127.0.0.1:8640') }, 'retry', 'queue_unreachable'],
    ['timeout', { error: Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) }, 'retry', 'queue_unreachable'],
  ];

  for (const [name, answer, outcome, reason] of table) {
    it(`${name} → ${outcome}`, () => {
      const d = classifyQueueAnswer(answer);
      assert.equal(d.outcome, outcome);
      assert.equal(d.reason, reason);
      assert.ok(d.reason.length <= 64, 'a reason fits occurrences.final_reason');
      if (outcome === 'enqueued') assert.equal(d.jobId, 'job-1');
      else assert.equal(d.jobId, undefined, 'no job id is claimed without a durable answer');
    });
  }

  it('reports a duplicate as the same job, a success, not a second one', () => {
    const d = classifyQueueAnswer({ status: 200, body: { job, duplicate: true } });
    assert.equal(d.duplicate, true);
    assert.equal(d.jobId, job.id);
  });

  it('backs off retries, bounded', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 12].map(retryDelayMs), [5e3, 1e4, 2e4, 4e4, 8e4, 16e4, 3e5, 3e5, 3e5]);
  });
});

describe('the request an occurrence sends is frozen and carries its identity', () => {
  const occ = {
    occurrenceId: `occ-${'c'.repeat(64)}`, scheduleId: 'task-proof', revision: REV, plannedAt: '2026-09-24T10:05:00.000Z',
  };

  it('keeps the beat job shape and adds the occurrence fields and the key', () => {
    const task = normalizeDeclaration({ slug: 'task-proof', instruction: 'Do it.', bridgeUrl: 'http://127.0.0.1:4330' });
    const body = JSON.parse(occurrenceRequestText(task, 'ctx text', occ));
    assert.equal(body.type, 'agent.inject');
    assert.equal(body.totalSteps, 2);
    assert.equal(body.payload.message, 'Do it.');
    assert.equal(body.payload.conversation, 'task-proof');
    assert.equal(body.payload.bridgeUrl, 'http://127.0.0.1:4330');
    assert.equal(body.payload.context, 'ctx text');
    assert.equal(body.payload.occurrenceId, occ.occurrenceId);
    assert.equal(body.payload.scheduleId, 'task-proof');
    assert.equal(body.payload.scheduleRevision, REV);
    assert.equal(body.payload.plannedAt, occ.plannedAt);
    assert.equal(body.idempotencyKey, occ.occurrenceId);
  });

  it('uses a declared job type', () => {
    const task = normalizeDeclaration({ slug: 'task-proof', jobType: 'maestro.proof' });
    assert.equal(JSON.parse(occurrenceRequestText(task, null, occ)).type, 'maestro.proof');
  });

  it('snapshots the context once; an unreadable one is a typed miss, not a job', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-occ-ctx-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'ctx.md');
    fs.writeFileSync(file, 'The marker is amber-cedar.');
    const task = normalizeDeclaration({ slug: 'task-proof', contextPath: file });

    const built = buildOccurrenceRequest(task, occ);
    assert.equal(JSON.parse(built.requestText).payload.context, 'The marker is amber-cedar.');
    assert.equal(built.requestDigest, sha(built.requestText));
    assert.equal(buildOccurrenceRequest(task, occ).requestText, built.requestText, 'the same occurrence, the same bytes');

    fs.unlinkSync(file);
    const lost = buildOccurrenceRequest(task, occ);
    assert.equal(lost.reason, 'context_unreadable');
    assert.equal(lost.requestText, undefined);
  });
});

describe('reading occurrences is bounded', () => {
  const q = (s) => parseOccurrenceQuery(new URLSearchParams(s));

  it('defaults and accepts the declared filters', () => {
    assert.deepEqual(q(''), { scheduleId: null, state: null, limit: OCCURRENCE_QUERY_DEFAULT_LIMIT });
    assert.deepEqual(q('schedule=task-proof&state=ENQUEUED&limit=5'), { scheduleId: 'task-proof', state: 'ENQUEUED', limit: 5 });
  });

  it('refuses an unknown state and an unbounded or malformed limit', () => {
    for (const s of ['state=DONE', 'limit=0', 'limit=501', 'limit=abc', 'limit=2.5', 'schedule=a%2Fb']) {
      assert.throws(() => q(s), (e) => e.code === 'INVALID_QUERY' && e.status === 400, s);
    }
  });
});
