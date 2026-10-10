import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { JobQueue } from '../index.js';
import { INTERRUPTED_REASON, interruptedJob } from '../job-contract.js';

// Intent: software/packages/pkg-queue/INTENT.md#lifecycle
// Non-regression: a job left RUNNING by a dead process was settled only by the
// optional agent.inject worker (QUEUE_AUTO_DISPATCH=1); with the worker off,
// or for any other job type, it stayed RUNNING forever. Restart recovery now
// belongs to the service lifecycle. The MariaDB path is proven live
// (evidence-and-recovery.live.mjs); here the entrypoint's wiring is driven
// end to end on the DEV file store, worker off.

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '../server.js');

function waitForLine(child, pattern) {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`no line matching ${pattern}: ${out}`)), 10000);
    const onData = (chunk) => {
      out += chunk;
      const m = out.match(pattern);
      if (m) { clearTimeout(timer); resolve({ match: m, out }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

describe('a job RUNNING at start is settled as interrupted', () => {
  it('builds the FAILED record with the reason and keeps what was recorded', () => {
    const now = new Date('2026-10-10T10:00:00Z');
    const job = interruptedJob({ id: 'j', status: 'RUNNING', result: { startedAt: 'x' } }, now);
    assert.equal(job.status, 'FAILED');
    assert.equal(job.error, INTERRUPTED_REASON);
    assert.deepEqual(job.result, { startedAt: 'x', orphaned: true, outcome: 'unknown' });
    assert.equal(job.updatedAt, now.toISOString());
    assert.deepEqual(interruptedJob({ id: 'k', status: 'RUNNING', result: ['opaque'] }, now).result, ['opaque'], 'a non-object result is left as it was');
  });

  it('the service settles it at start with the worker off, whatever its type, and leaves PENDING alone', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-lifecycle-'));
    const file = path.join(dir, 'jobs.jsonl');
    const at = new Date().toISOString();
    const job = (id, status, type) => ({ id, type, payload: {}, status, progress: 50, step: 1, totalSteps: 2, createdAt: at, updatedAt: at,
      result: null, error: null, qualityGateStatus: null, idempotencyKey: null, requestDigest: 'a'.repeat(64) });
    fs.writeFileSync(file, `${JSON.stringify(job('job-running', 'RUNNING', 'report.render'))}\n${JSON.stringify(job('job-pending', 'PENDING', 'report.render'))}\n`);
    const child = spawn(process.execPath, [SERVER], {
      env: { PATH: process.env.PATH, QUEUE_STORE: 'file', QUEUE_STORAGE_FILE: file, QUEUE_PORT: '0', HOST: '127.0.0.1' },
    });
    try {
      const { out } = await waitForLine(child, /QUEUE_AUTO_DISPATCH off/);
      assert.match(out, /1 job\(s\) found RUNNING at start settled FAILED as interrupted/);
      const base = `http://127.0.0.1:${out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)[1]}`;
      const running = (await (await fetch(`${base}/api/jobs/job-running`)).json()).job;
      assert.equal(running.status, 'FAILED');
      assert.equal(running.error, INTERRUPTED_REASON);
      assert.equal(running.result.orphaned, true);
      assert.equal((await (await fetch(`${base}/api/jobs/job-pending`)).json()).job.status, 'PENDING');
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the file store settles once and persists it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-recover-'));
    try {
      const file = path.join(dir, 'jobs.jsonl');
      const q = new JobQueue({ storageFile: file });
      const { job } = q.enqueue({ type: 'any.type' });
      q.updateJobProgress(job.id, { status: 'RUNNING' });
      const again = new JobQueue({ storageFile: file });
      assert.deepEqual(again.recoverInterrupted().map((j) => j.id), [job.id]);
      assert.deepEqual(again.recoverInterrupted(), []);
      assert.equal(new JobQueue({ storageFile: file }).getJob(job.id).status, 'FAILED');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the DEV stores are refused under a promotion or qualification flag', () => {
  const run = (env) => spawnSync(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, QUEUE_PORT: '0', HOST: '127.0.0.1', ...env }, encoding: 'utf8', timeout: 10000,
  });

  for (const store of ['file', 'memory']) {
    for (const flag of [{ SHAPER_QUALIFICATION: '1' }, { SHAPER_RUNTIME_MODE: 'production' }]) {
      it(`QUEUE_STORE=${store} with ${Object.keys(flag)[0]}`, () => {
        const r = run({ QUEUE_STORE: store, QUEUE_STORAGE_FILE: '/nonexistent/jobs.jsonl', ...flag });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /refusing to start: DEV_STORE_REFUSED/);
      });
    }
  }

  it('MariaDB stays the default and is never replaced by a DEV store', () => {
    const r = run({ SHAPER_QUALIFICATION: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: PASSWD_MISSING/);
    assert.doesNotMatch(r.stderr + r.stdout, /DEV scaffolding/);
  });
});
