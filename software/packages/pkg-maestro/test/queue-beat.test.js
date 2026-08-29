import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueueBeatHandler } from '../queue-beat.js';

/**
 * A queue that accepts what it is handed and reports what it holds.
 * `held` is the list of jobs a GET /api/jobs will return.
 */
function fakeQueue({ held = [], posts = [] } = {}) {
  return async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => ({ status: 'ok', jobs: held }) };
    }
    posts.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 201, json: async () => ({ status: 'ok', job: { id: 'job-1' } }) };
  };
}

const openJob = (conversation, status) => ({
  id: 'job-earlier', status, createdAt: '2026-08-23T09:00:00.000Z', payload: { conversation },
});

describe('maestro queue beat handler', () => {
  it('enqueues an agent.inject job carrying the pod identity', async () => {
    const posts = [];
    const beat = createQueueBeatHandler({ queueUrl: 'http://127.0.0.1:8540/', fetchImpl: fakeQueue({ posts }) });

    const result = await beat({ slug: 'task-contact', beatMessage: 'Report the current state', bridgeUrl: 'http://127.0.0.1:4330' });

    assert.equal(result.ok, true);
    assert.equal(result.enqueued, true);
    assert.equal(result.jobId, 'job-1');
    assert.equal(posts[0].url, 'http://127.0.0.1:8540/api/jobs');
    assert.equal(posts[0].body.type, 'agent.inject');
    assert.equal(posts[0].body.payload.message, 'Report the current state');
    assert.equal(posts[0].body.payload.conversation, 'task-contact');
    assert.equal(posts[0].body.payload.bridgeUrl, 'http://127.0.0.1:4330');
  });

  it('claims only that the job is queued, never that the work succeeded', async () => {
    const beat = createQueueBeatHandler({ queueUrl: 'http://127.0.0.1:8540', fetchImpl: fakeQueue() });
    const result = await beat({ slug: 'pod-a' });

    // The outcome of the run belongs to the job and arrives later. A beat that
    // reported success here would be inventing what it cannot observe.
    assert.equal(result.enqueued, true);
    assert.equal('exitCode' in result, false);
    assert.equal('completed' in result, false);
  });

  // ── The cadence invariant: at most one outstanding job per pod ────────────

  it('skips the beat when the pod still has a RUNNING job', async () => {
    const posts = [];
    const beat = createQueueBeatHandler({
      queueUrl: 'http://127.0.0.1:8540',
      fetchImpl: fakeQueue({ held: [openJob('pod-a', 'RUNNING')], posts }),
    });

    const result = await beat({ slug: 'pod-a' });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'previous_run_still_open');
    assert.equal(result.jobId, 'job-earlier');
    assert.equal(posts.length, 0, 'nothing may be enqueued while the pod is busy');
  });

  it('skips just as firmly on a PENDING job — a backlog is already lateness', async () => {
    const posts = [];
    const beat = createQueueBeatHandler({
      queueUrl: 'http://127.0.0.1:8540',
      fetchImpl: fakeQueue({ held: [openJob('pod-a', 'PENDING')], posts }),
    });

    assert.equal((await beat({ slug: 'pod-a' })).reason, 'previous_run_still_open');
    assert.equal(posts.length, 0);
  });

  it('is not blocked by another pod being busy', async () => {
    const posts = [];
    const beat = createQueueBeatHandler({
      queueUrl: 'http://127.0.0.1:8540',
      fetchImpl: fakeQueue({ held: [openJob('pod-b', 'RUNNING')], posts }),
    });

    assert.equal((await beat({ slug: 'pod-a' })).enqueued, true);
    assert.equal(posts.length, 1);
  });

  it('is not blocked by its own finished jobs', async () => {
    const posts = [];
    const beat = createQueueBeatHandler({
      queueUrl: 'http://127.0.0.1:8540',
      fetchImpl: fakeQueue({ held: [openJob('pod-a', 'COMPLETED'), openJob('pod-a', 'FAILED')], posts }),
    });

    assert.equal((await beat({ slug: 'pod-a' })).enqueued, true);
    assert.equal(posts.length, 1);
  });

  it('beats anyway when the queue cannot be questioned', async () => {
    // One duplicate beat is a smaller harm than a pod silenced because its
    // bookkeeping was briefly unreachable.
    const posts = [];
    const beat = createQueueBeatHandler({
      queueUrl: 'http://127.0.0.1:8540',
      fetchImpl: async (url, opts = {}) => {
        if ((opts.method || 'GET') === 'GET') throw new Error('ECONNREFUSED');
        posts.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 201, json: async () => ({ status: 'ok', job: { id: 'job-1' } }) };
      },
    });

    assert.equal((await beat({ slug: 'pod-a' })).enqueued, true);
    assert.equal(posts.length, 1);
  });

  // ── Failures of the beat itself ───────────────────────────────────────────

  it('reports a missed beat when the queue is unreachable', async () => {
    const beat = createQueueBeatHandler({
      queueUrl: 'http://127.0.0.1:8540',
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    const result = await beat({ slug: 'pod-a' });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'queue_unreachable');
  });

  it('reports a missed beat when the queue rejects the job', async () => {
    const beat = createQueueBeatHandler({
      queueUrl: 'http://127.0.0.1:8540',
      fetchImpl: async (url, opts = {}) => ((opts.method || 'GET') === 'GET'
        ? { ok: true, status: 200, json: async () => ({ jobs: [] }) }
        : { ok: false, status: 400, json: async () => ({ error: 'bad payload' }) }),
    });
    const result = await beat({ slug: 'pod-a' });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'enqueue_rejected');
  });

  it('supplies a default instruction when the pod declares none', async () => {
    const posts = [];
    const beat = createQueueBeatHandler({ queueUrl: 'http://127.0.0.1:8540', fetchImpl: fakeQueue({ posts }) });
    await beat({ slug: 'pod-a' });

    assert.match(posts[0].body.payload.message, /pod-a/);
  });

  it('refuses to be built without a queue', () => {
    assert.throws(() => createQueueBeatHandler({}), /queueUrl is required/);
  });
});

// Intent: software/universes/univ-base/INTENT.md#proof
// Non-regression (Rule 29): until V1.13.1 BEAT_ENQUEUED was logged BEFORE the
// job existed, correlated to the slug — so no audit event could ever join a
// queue job id, and the runbook's proof #4 was unsatisfiable by construction.
// All five V1.13 beta testers hit this. This test fails on the unpatched code.
describe('the audit event joins the job id (proof #4)', () => {
  it('logs BEAT_ENQUEUED after creation, correlated to the created job id', async () => {
    const logged = [];
    const fetchImpl = async (url, opts = {}) => {
      if (url.includes('/api/ingest')) {
        logged.push(JSON.parse(opts.body));
        return { ok: true, status: 202, json: async () => ({}) };
      }
      if ((opts.method || 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => ({ status: 'ok', jobs: [] }) };
      }
      return { ok: true, status: 201, json: async () => ({ status: 'ok', job: { id: 'job-77' } }) };
    };
    const beat = createQueueBeatHandler({
      queueUrl: 'http://127.0.0.1:8540/',
      loggerUrl: 'http://127.0.0.1:8520',
      fetchImpl,
    });

    const result = await beat({ slug: 'task-contact' });

    assert.equal(result.jobId, 'job-77');
    const enqueued = logged.find((e) => e.event === 'BEAT_ENQUEUED');
    assert.ok(enqueued, 'BEAT_ENQUEUED must be logged');
    assert.equal(enqueued.correlationId, 'job-77', 'the audit event carries the JOB ID, never just the slug');
    assert.equal(enqueued.data.jobId, 'job-77');
  });
});
