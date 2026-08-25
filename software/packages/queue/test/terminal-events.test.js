import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startQueueAgentWorker } from '../worker.js';
import { JobQueue } from '../index.js';

/**
 * A bridge that accepts an injection, then emits one SSE event of our choosing.
 * Exercises the real `followViaSse`, not a stub — the point of these tests is
 * that the queue understands what each bridge actually says.
 */
function bridgeEmitting(event) {
  return async (url, opts = {}) => {
    if (url.includes('/api/events')) {
      const frame = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
      let sent = false;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => (sent ? { done: true } : ((sent = true), { value: frame, done: false })),
            cancel: async () => {},
          }),
        },
      };
    }
    if ((opts.method || 'GET') === 'POST') {
      return { ok: true, status: 200, json: async () => ({ ok: true, runId: 'r1' }) };
    }
    return { ok: true, status: 200, json: async () => ({ jobs: [] }) };
  };
}

async function outcomeFor(event) {
  const queue = new JobQueue();
  const worker = startQueueAgentWorker({ queue, pollMs: 20, fetchImpl: bridgeEmitting(event) });
  const job = queue.createJob({ type: 'agent.inject', payload: { message: 'go', conversation: 'c' } });
  await new Promise((r) => setTimeout(r, 200));
  worker.stop();
  return queue.getJob(job.id);
}

describe('terminal events across bridges', () => {
  it("understands bridge-agy's `done` with exit_code 0", async () => {
    const j = await outcomeFor({ type: 'done', exit_code: 0 });
    assert.equal(j.status, 'COMPLETED');
    assert.equal(j.result.exit_code, 0);
  });

  it("understands bridge-agy's `done` with a non-zero exit_code", async () => {
    const j = await outcomeFor({ type: 'done', exit_code: 2 });
    assert.equal(j.status, 'FAILED');
    assert.match(j.error, /exit 2/);
  });

  it("understands bridge-opencode's `response_complete` and preserves its answer", async () => {
    const j = await outcomeFor({ type: 'response_complete', exit: 0, text: 'REAL AGENT ANSWER' });
    assert.equal(j.status, 'COMPLETED');
    assert.equal(j.result.exit_code, 0);
    assert.equal(j.result.answer, 'REAL AGENT ANSWER');
  });

  it('treats an aborted run as a failure, not as silence', async () => {
    const j = await outcomeFor({ type: 'run_aborted', reason: 'cancelled' });
    assert.equal(j.status, 'FAILED');
  });

  it('stays RUNNING on `run_complete`, which carries no outcome', async () => {
    // It follows response_complete and says nothing about success. Concluding
    // from it would mean inventing a result for a run that reported none.
    const j = await outcomeFor({ type: 'run_complete' });
    assert.equal(j.status, 'RUNNING');
  });

  it('stays RUNNING when the terminal event omits its code', async () => {
    const j = await outcomeFor({ type: 'done' });
    assert.equal(j.status, 'RUNNING');
    assert.ok(j.result.unobserved || j.progress === 50);
  });
});

describe("cursor-agent's dialect", () => {
  it("reads `result` with is_error false as a success", async () => {
    const j = await outcomeFor({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1234 });
    assert.equal(j.status, 'COMPLETED');
    assert.equal(j.result.exit_code, 0);
  });

  it('reads `result` with is_error true as a failure', async () => {
    const j = await outcomeFor({ type: 'result', subtype: 'error', is_error: true, result: 'model refused' });
    assert.equal(j.status, 'FAILED');
  });
});

describe('an unreachable bridge must not kill the queue', () => {
  it('keeps the job RUNNING with a reason instead of crashing the worker', async () => {
    // Subscribing before injecting is what stops a short run finishing before
    // anyone listens. Its cost: a failed subscription rejects before anything
    // awaits it, and an unhandled rejection ends the process. Observed on
    // gbs-test — one dead address, and the whole control plane's queue was gone.
    const queue = new JobQueue();
    const worker = startQueueAgentWorker({
      queue,
      pollMs: 20,
      fetchImpl: async (url) => {
        if (url.includes('/api/events')) {
          const e = new Error('fetch failed');
          e.cause = { code: 'ECONNREFUSED' };
          throw e;
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, runId: 'r1' }) };
      },
    });
    const job = queue.createJob({ type: 'agent.inject', payload: { message: 'go', conversation: 'c' } });
    await new Promise((r) => setTimeout(r, 250));
    worker.stop();

    const done = queue.getJob(job.id);
    assert.equal(done.status, 'RUNNING', 'an unobservable run stays RUNNING');
    assert.match(done.result.unobserved, /ECONNREFUSED/, 'and says why');
  });
});
