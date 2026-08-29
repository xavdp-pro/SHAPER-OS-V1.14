import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../index.js';

// Intent: software/universes/univ-base/INTENT.md#proof
// Non-regression (Rule 29): until V1.13.4 only maestro logged, so a job POSTed
// straight to the queue — exactly what RUNBOOK step 6 prescribes for the
// functional proof — completed with a persisted answer and left ZERO audit
// trace. proof.sh then failed honestly ("the work happened off the record")
// and the repository could not satisfy its own proof #4 on its own documented
// path. A V1.13.2 cold tester reached that wall with everything else green.
// The queue is the ledger of work, so the queue is what must testify.

function captureLogger() {
  const events = [];
  return {
    events,
    fetchImpl: async (url, opts) => {
      events.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 202, json: async () => ({}) };
    },
  };
}

describe('the queue testifies for every job, however it was enqueued', () => {
  it('emits JOB_CREATED and JOB_COMPLETED correlated to the job id', async () => {
    const { events, fetchImpl } = captureLogger();
    const q = new JobQueue({ loggerUrl: 'http://127.0.0.1:8620', fetchImpl });

    const job = q.createJob({ type: 'agent.inject', payload: { message: 'hi' } });
    q.updateJobProgress(job.id, { status: 'COMPLETED', result: { answer: 'done' } });
    await new Promise((r) => setTimeout(r, 30));

    const names = events.map((e) => e.body.event);
    assert.ok(names.includes('JOB_CREATED'), `JOB_CREATED must be logged, got ${names}`);
    assert.ok(names.includes('JOB_COMPLETED'), `JOB_COMPLETED must be logged, got ${names}`);
    for (const e of events) {
      assert.equal(e.body.correlation_id ?? e.body.correlationId, job.id,
        'every queue audit event carries the job id — that is what proof #4 joins on');
    }
  });

  it('stays silent when no logger is configured, and never throws', () => {
    const q = new JobQueue({});
    const job = q.createJob({ type: 'agent.inject', payload: {} });
    assert.doesNotThrow(() => q.updateJobProgress(job.id, { status: 'COMPLETED' }));
  });
});
