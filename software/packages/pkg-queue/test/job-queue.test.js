import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../index.js';

test('JobQueue - Create and update job', () => {
  const queue = new JobQueue();
  let statusChangeCount = 0;
  
  queue.on('statusChange', () => {
    statusChangeCount++;
  });

  const job = queue.createJob({ type: 'test', payload: { foo: 'bar' }, totalSteps: 3 });
  
  assert.equal(job.status, 'PENDING');
  assert.equal(job.type, 'test');
  assert.deepEqual(job.payload, { foo: 'bar' });
  assert.equal(job.totalSteps, 3);
  
  queue.updateJobProgress(job.id, { progress: 33, step: 1, status: 'RUNNING' });
  
  const updatedJob = queue.getJob(job.id);
  assert.equal(updatedJob.status, 'RUNNING');
  assert.equal(updatedJob.progress, 33);
  assert.equal(updatedJob.step, 1);
  
  queue.updateJobProgress(job.id, { progress: 100, step: 3, status: 'COMPLETED', result: 'success' });
  
  const completedJob = queue.getJob(job.id);
  assert.equal(completedJob.status, 'COMPLETED');
  assert.equal(completedJob.result, 'success');
  
  assert.equal(statusChangeCount, 3); // created, updated, completed
});

test('JobQueue - List jobs by status', () => {
  const queue = new JobQueue();
  queue.createJob({ type: 'a' });
  const job2 = queue.createJob({ type: 'b' });
  queue.updateJobProgress(job2.id, { status: 'COMPLETED' });

  const pendingJobs = queue.listJobs({ status: 'PENDING' });
  assert.equal(pendingJobs.length, 1);
  assert.equal(pendingJobs[0].type, 'a');

  const completedJobs = queue.listJobs({ status: 'COMPLETED' });
  assert.equal(completedJobs.length, 1);
  assert.equal(completedJobs[0].type, 'b');
});
