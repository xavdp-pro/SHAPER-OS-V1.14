import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../index.js';
import { startQueueAgentWorker } from '../worker.js';

// Intent: software/packages/pkg-queue/INTENT.md
//
// Born from the v1.13.11 sealing run (report-seal3-muse, incident 2): a model
// hung without a terminal event, the SSE follow never settled, the only lane
// was held forever — the job sat RUNNING, every later job sat PENDING, and
// only a manual PATCH plus a container restart freed the queue. A cold agent
// without that reflex is simply blocked. The worker now gives up watching
// after runMaxSeconds: the job is FAILED with the reason stated (the outcome
// is unknowable, as with orphans), and the lane is free again.

/** Bridge that accepts every injection. */
const bridgeThatAccepts = () => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, runId: 'run-hang-1' }),
});

describe('queue-worker gives up on a run with no terminal event', () => {
  it('fails the hung job after runMaxSeconds and frees the lane for the next one', async () => {
    const queue = new JobQueue();
    let call = 0;
    const worker = startQueueAgentWorker({
      queue,
      pollMs: 40,
      runMaxSeconds: 0.15,
      fetchImpl: bridgeThatAccepts(),
      // First run hangs forever (a promise that never settles); later runs end.
      followImpl: () => (call++ === 0
        ? { done: new Promise(() => {}), cancel() {} }
        : { done: Promise.resolve({ observable: true, exitCode: 0 }), cancel() {} }),
    });

    const hung = queue.createJob({
      type: 'agent.inject',
      payload: { message: 'never answers', conversation: 'seal3' },
      totalSteps: 2,
    });
    const next = queue.createJob({
      type: 'agent.inject',
      payload: { message: 'answers fine', conversation: 'seal3' },
      totalSteps: 2,
    });

    // Bounded wait: poll, never sleep blind. On the unpatched worker the hung
    // job holds the lane forever and this loop times out with both jobs stuck.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const a = queue.getJob(hung.id);
      const b = queue.getJob(next.id);
      if (a.status === 'FAILED' && b.status === 'COMPLETED') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    worker.stop();

    const failed = queue.getJob(hung.id);
    assert.equal(failed.status, 'FAILED',
      'the hung job still holds its lane — a silent stream freezes the queue (v1.13.11 incident 2)');
    assert.match(failed.error, /gave up|unknowable/i);
    assert.equal(queue.getJob(next.id).status, 'COMPLETED',
      'the lane was never freed — the job behind the hung one never dispatched');
  });
});
