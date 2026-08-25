import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../index.js';
import { startQueueAgentWorker } from '../worker.js';

/** Test bridge: accepts the injection and records what it was sent. */
function bridgeThatAccepts(calls) {
  return async (url, opts) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, runId: 'run-test-1', conversation: 'c1', model: 'test-model' }),
    };
  };
}

/** Test follower: decides the run's outcome without a real SSE stream. */
const followerReturning = (outcome) => () => ({ done: Promise.resolve(outcome), cancel() {} });

describe('queue-worker agent.inject', () => {
  it("passes the prompt through and reports success when the agent exits 0", async () => {
    const queue = new JobQueue();
    const calls = [];
    const worker = startQueueAgentWorker({
      queue,
      bridgeUrl: 'http://127.0.0.1:4340',
      pollMs: 50,
      fetchImpl: bridgeThatAccepts(calls),
      followImpl: followerReturning({ observable: true, exitCode: 0, runId: 'run-test-1' }),
    });
    const job = queue.createJob({
      type: 'agent.inject',
      payload: { message: 'Reply PONG', conversation: 'vol-1' },
      totalSteps: 2,
    });
    await new Promise((r) => setTimeout(r, 120));
    const done = queue.getJob(job.id);
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.result.run_id, 'run-test-1');
    assert.equal(done.result.exit_code, 0);
    assert.equal(calls.at(-1).body.message, 'Reply PONG');
    worker.stop();
  });

  it("fails when the agent exits non-zero, even though the injection was accepted", async () => {
    const queue = new JobQueue();
    const worker = startQueueAgentWorker({
      queue,
      pollMs: 40,
      fetchImpl: bridgeThatAccepts([]),
      followImpl: followerReturning({ observable: true, exitCode: 1 }),
    });
    const job = queue.createJob({ type: 'agent.inject', payload: { message: 'do the work' } });
    await new Promise((r) => setTimeout(r, 110));
    const done = queue.getJob(job.id);
    assert.equal(done.status, 'FAILED');
    assert.match(done.error, /exit 1/);
    worker.stop();
  });

  it("stays RUNNING rather than inventing a success when the end is unobservable", async () => {
    const queue = new JobQueue();
    const worker = startQueueAgentWorker({
      queue,
      pollMs: 40,
      fetchImpl: bridgeThatAccepts([]),
      followImpl: followerReturning({ observable: false }),
    });
    const job = queue.createJob({ type: 'agent.inject', payload: { message: 'do the work' } });
    await new Promise((r) => setTimeout(r, 110));
    const done = queue.getJob(job.id);
    assert.equal(done.status, 'RUNNING');
    assert.ok(done.result.unobserved, 'the reason for non-observation must be recorded');
    worker.stop();
  });

  it('fails when the prompt is missing', async () => {
    const queue = new JobQueue();
    const worker = startQueueAgentWorker({
      queue,
      pollMs: 40,
      fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    });
    const job = queue.createJob({ type: 'agent.inject', payload: {} });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(queue.getJob(job.id).status, 'FAILED');
    worker.stop();
  });
});
