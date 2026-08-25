import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../index.js';

describe('JobQueue — Delegation & Recovery Protocol', () => {
  it('enqueues a job with payload and initial pending state', () => {
    const queue = new JobQueue();
    const job = queue.createJob({
      type: 'batch_ocr',
      payload: { count: 100, target: '/data/ged' },
      totalSteps: 3,
    });

    assert.ok(job.id.startsWith('job-'));
    assert.equal(job.type, 'batch_ocr');
    assert.equal(job.status, 'PENDING');
    assert.equal(job.progress, 0);
    assert.equal(job.payload.count, 100);
  });

  it('updates progress through worker execution steps', () => {
    const queue = new JobQueue();
    const job = queue.createJob({
      type: 'excel_report',
      payload: { year: 2026 },
      totalSteps: 2,
    });

    // Step 1: running
    const running = queue.updateJobProgress(job.id, {
      status: 'RUNNING',
      progress: 50,
      step: 1,
    });
    assert.equal(running.status, 'RUNNING');
    assert.equal(running.progress, 50);

    // Step 2: completed with result
    const completed = queue.updateJobProgress(job.id, {
      status: 'COMPLETED',
      progress: 100,
      step: 2,
      result: { file: '/data/ged/Bilan_2026.xlsx', totalRows: 450 },
    });
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.progress, 100);
    assert.equal(completed.result.file, '/data/ged/Bilan_2026.xlsx');
  });

  it('filters jobs by status for master agent recovery', () => {
    const queue = new JobQueue();
    const j1 = queue.createJob({ type: 'task_1', payload: {} });
    const j2 = queue.createJob({ type: 'task_2', payload: {} });
    queue.updateJobProgress(j1.id, { status: 'COMPLETED', progress: 100, result: { ok: true } });

    const pending = queue.listJobs({ status: 'PENDING' });
    const completed = queue.listJobs({ status: 'COMPLETED' });

    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, j2.id);
    assert.equal(completed.length, 1);
    assert.equal(completed[0].id, j1.id);
  });
});
