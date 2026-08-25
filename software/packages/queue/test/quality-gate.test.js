import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue, validateQualityGate } from '../index.js';

test('Quality Gate - Code contract passes when tests succeed', () => {
  const queue = new JobQueue();
  const job = queue.createJob({
    type: 'refactor',
    contractType: 'code',
    payload: { task: 'Fix math utility' }
  });

  const testRunnerMock = () => ({ passed: true });
  queue.updateJobProgress(job.id, {
    status: 'COMPLETED',
    testRunner: testRunnerMock,
    result: { filesChanged: ['math.js'] }
  });

  const updated = queue.getJob(job.id);
  assert.equal(updated.status, 'COMPLETED');
  assert.equal(updated.qualityGateStatus, 'VERIFIED_CODE');
});

test('Quality Gate - Code contract fails when tests fail (rejects COMPLETED)', () => {
  const queue = new JobQueue();
  const job = queue.createJob({
    type: 'refactor',
    contractType: 'code',
    payload: { task: 'Broken patch' }
  });

  const failingTestRunner = () => ({ passed: false, error: '1 test failed in math.test.js' });
  queue.updateJobProgress(job.id, {
    status: 'COMPLETED',
    testRunner: failingTestRunner,
    result: { filesChanged: ['broken.js'] }
  });

  const updated = queue.getJob(job.id);
  assert.equal(updated.status, 'FAILED');
  assert.match(updated.error, /1 test failed/);
});

test('Quality Gate - Document contract validates arithmetic totals', () => {
  const queue = new JobQueue();
  const job = queue.createJob({
    type: 'generate-invoice',
    contractType: 'document',
    payload: { client: 'Dupont' }
  });

  // Valid totals: 100 HT + 20 VAT = 120 TTC
  queue.updateJobProgress(job.id, {
    status: 'COMPLETED',
    result: {
      filePath: 'invoices/2026-001.pdf',
      totals: { ht: 100, vat: 20, ttc: 120 }
    }
  });

  const validJob = queue.getJob(job.id);
  assert.equal(validJob.status, 'COMPLETED');
  assert.equal(validJob.qualityGateStatus, 'VERIFIED_DOCUMENT');

  // Invalid totals: 100 HT + 20 VAT != 150 TTC
  const job2 = queue.createJob({
    type: 'generate-invoice',
    contractType: 'document',
    payload: { client: 'Martin' }
  });

  queue.updateJobProgress(job2.id, {
    status: 'COMPLETED',
    result: {
      filePath: 'invoices/2026-002.pdf',
      totals: { ht: 100, vat: 20, ttc: 150 }
    }
  });

  const invalidJob = queue.getJob(job2.id);
  assert.equal(invalidJob.status, 'FAILED');
  assert.match(invalidJob.error, /Arithmetic mismatch/);
});

// Build-out stage behaviour (Rule 20, staged activation): with the gate not
// enforced, an undeclared contract is RECORDED as NEEDS_CONTRACT and the job
// proceeds. This asserts the current stage, not the target: once a universe
// sets QUALITY_GATE_ENFORCE=1, this case must be held and escalated instead.
test('Quality Gate - records NEEDS_CONTRACT and proceeds while the gate is not enforced', () => {
  const queue = new JobQueue();
  const job = queue.createJob({
    type: 'untyped-task',
    payload: { message: 'hello' }
  });

  queue.updateJobProgress(job.id, {
    status: 'COMPLETED',
    result: { text: 'ok' }
  });

  const updated = queue.getJob(job.id);
  assert.equal(updated.status, 'COMPLETED');
  assert.equal(updated.qualityGateStatus, 'NEEDS_CONTRACT');
});
