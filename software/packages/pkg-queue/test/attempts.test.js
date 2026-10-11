import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue, createQueueServer } from '../index.js';
import { decideAttemptUpdate, normalizeAttemptPatch } from '../job-contract.js';

// Intent: software/packages/pkg-queue/INTENT.md#attempts
// DECISIONS-20261011 §G: a claim is a durable attempt bound to the consumer
// and its incarnation; progress and terminal updates present it and must match
// the job while it is RUNNING; a terminal state is never rewritten, its
// identical repeat answers the same receipt, and a late update is
// STALE_ATTEMPT. Store-level semantics on the DEV store; the durable proof
// against MariaDB is test/evidence-and-recovery.live.mjs.

const worker = { unit: 'worker-a', incarnation: 'worker-a-1' };
const codeOf = (fn) => { try { fn(); } catch (err) { return err.code; } return null; };

describe('a claim is an attempt bound to its consumer and incarnation', () => {
  it('moves PENDING to RUNNING once; the same consumer gets its attempt back; anyone else is refused', () => {
    const q = new JobQueue();
    const { job } = q.enqueue({ type: 'report.render' });
    const first = q.claimJob(job.id, worker, { progress: 5 });
    assert.equal(first.duplicate, false);
    assert.equal(first.job.status, 'RUNNING');
    assert.equal(first.job.attemptId, first.attempt.id);
    assert.deepEqual([first.attempt.consumer, first.attempt.incarnation, first.attempt.state], ['worker-a', 'worker-a-1', 'ACTIVE']);
    const again = q.claimJob(job.id, worker);
    assert.equal(again.duplicate, true);
    assert.equal(again.attempt.id, first.attempt.id);
    assert.equal(codeOf(() => q.claimJob(job.id, { unit: 'worker-b', incarnation: 'b-1' })), 'JOB_STATE_CHANGED');
    assert.equal(codeOf(() => q.claimJob(job.id, { ...worker, incarnation: 'worker-a-2' })), 'JOB_STATE_CHANGED', 'a later incarnation does not inherit the claim');
    assert.equal(codeOf(() => q.claimJob(job.id, { unit: 'Bad', incarnation: 'x' })), 'ATTEMPT_FORBIDDEN');
    assert.equal(codeOf(() => q.claimJob(job.id, worker, { status: 'COMPLETED' })), 'INVALID_JOB_UPDATE', 'a claim sets RUNNING itself');
  });
});

describe('an update presents the attempt and matches the running job', () => {
  it('refuses an update without an attempt, from another consumer, or from a later incarnation', () => {
    const q = new JobQueue();
    const { job } = q.enqueue({ type: 'x' });
    const { attempt } = q.claimJob(job.id, worker);
    assert.equal(codeOf(() => q.updateAttempt(job.id, { progress: 50 }, { consumer: worker })), 'ATTEMPT_REQUIRED');
    assert.equal(codeOf(() => q.updateAttempt(job.id, { attempt: 'nope', progress: 50 }, { consumer: worker })), 'INVALID_JOB_UPDATE');
    assert.equal(codeOf(() => q.updateAttempt(job.id, { attempt: attempt.id, progress: 50 }, { consumer: { unit: 'worker-b', incarnation: 'b-1' } })), 'ATTEMPT_FORBIDDEN');
    assert.equal(codeOf(() => q.updateAttempt(job.id, { attempt: attempt.id, progress: 50 }, { consumer: { ...worker, incarnation: 'worker-a-2' } })), 'STALE_ATTEMPT');
    assert.equal(codeOf(() => q.updateAttempt(job.id, { attempt: attempt.id, status: 'PENDING' }, { consumer: worker })), 'INVALID_JOB_UPDATE');
    assert.equal(q.updateAttempt(job.id, { attempt: attempt.id, progress: 50 }, { consumer: worker }).job.progress, 50);
  });

  it('accepts one terminal update; its identical repeat answers the same receipt; anything else is stale and changes nothing', () => {
    const q = new JobQueue();
    const { job } = q.enqueue({ type: 'x' });
    const { attempt } = q.claimJob(job.id, worker);
    const done = { attempt: attempt.id, status: 'COMPLETED', progress: 100, result: { answer: 42 } };
    const accepted = q.updateAttempt(job.id, done, { consumer: worker });
    assert.equal(accepted.job.status, 'COMPLETED');
    assert.deepEqual(Object.keys(accepted.receipt).sort(), ['acceptedAt', 'attemptId', 'jobId', 'requestDigest', 'status']);
    const repeat = q.updateAttempt(job.id, { ...done, result: { answer: 42 } }, { consumer: worker });
    assert.equal(repeat.duplicate, true);
    assert.deepEqual(repeat.receipt, accepted.receipt, 'the same receipt');
    for (const late of [{ ...done, status: 'FAILED', error: 'late' }, { ...done, result: { answer: 43 } }, { attempt: attempt.id, progress: 99 }]) {
      assert.equal(codeOf(() => q.updateAttempt(job.id, late, { consumer: worker })), 'STALE_ATTEMPT');
    }
    assert.deepEqual(q.getJob(job.id).result, { answer: 42 });
    assert.equal(q.getJob(job.id).status, 'COMPLETED');
  });

  it('after restart recovery the attempt is invalidated: the late completion is STALE_ATTEMPT and the job stays orphaned', () => {
    const q = new JobQueue();
    const { job } = q.enqueue({ type: 'x' });
    const { attempt } = q.claimJob(job.id, worker);
    assert.deepEqual(q.recoverInterrupted().map((j) => j.id), [job.id]);
    assert.equal(q.attempts.get(attempt.id).state, 'INVALIDATED');
    assert.equal(codeOf(() => q.updateAttempt(job.id, { attempt: attempt.id, status: 'COMPLETED' }, { consumer: worker })), 'STALE_ATTEMPT');
    const settled = q.getJob(job.id);
    assert.equal(settled.status, 'FAILED');
    assert.deepEqual([settled.result.orphaned, settled.result.outcome], [true, 'unknown']);
    assert.equal(codeOf(() => q.claimJob(job.id, worker)), 'JOB_STATE_CHANGED', 'no automatic new run: reconcile, then a new job');
  });

  it('the decision is pure: a superseded attempt on a running job is stale', () => {
    const job = { id: 'j', status: 'RUNNING', attemptId: 'b' };
    const { digest } = normalizeAttemptPatch({ attempt: '00000000-0000-4000-8000-000000000000', progress: 1 });
    assert.throws(() => decideAttemptUpdate({ job, attempt: { id: 'a', jobId: 'j', consumer: 'w', incarnation: 'i', state: 'ACTIVE' }, consumer: { unit: 'w', incarnation: 'i' }, digest }), { code: 'STALE_ATTEMPT' });
    assert.equal(decideAttemptUpdate({ job, attempt: { id: 'b', jobId: 'j', consumer: 'w', incarnation: 'i', state: 'ACTIVE' }, consumer: { unit: 'w', incarnation: 'i' }, digest }), 'apply');
  });
});

describe('over HTTP (DEV open surface)', () => {
  it('claim, update, terminal receipt, identical repeat, late update', async () => {
    const server = createQueueServer({ port: 0, host: '127.0.0.1', queue: new JobQueue() });
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, path, body) => {
      const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    try {
      const { body: { job } } = await call('POST', '/api/jobs', { type: 'http.attempt' });
      assert.equal((await call('PATCH', `/api/jobs/${job.id}`, { status: 'COMPLETED' })).body.code, 'ATTEMPT_REQUIRED');
      const claimed = await call('POST', `/api/jobs/${job.id}/claim`, {});
      assert.equal(claimed.status, 200);
      assert.equal((await call('POST', `/api/jobs/${job.id}/claim`, {})).body.duplicate, true);
      const done = { attempt: claimed.body.attempt.id, status: 'COMPLETED', progress: 100 };
      const first = await call('PATCH', `/api/jobs/${job.id}`, done);
      assert.equal(first.status, 200);
      const repeat = await call('PATCH', `/api/jobs/${job.id}`, done);
      assert.deepEqual([repeat.status, repeat.body.duplicate, repeat.body.receipt], [200, true, first.body.receipt]);
      const late = await call('PATCH', `/api/jobs/${job.id}`, { ...done, status: 'FAILED' });
      assert.deepEqual([late.status, late.body.code], [409, 'STALE_ATTEMPT']);
    } finally {
      server.close();
    }
  });
});
