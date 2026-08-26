import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JobQueue } from '../index.js';

test('JobQueue - Disk Persistence re-hydrates jobs after restart', () => {
  const tmpFile = path.join(os.tmpdir(), `test-queue-${Date.now()}.jsonl`);

  try {
    // Instance 1: Create and complete jobs
    const queue1 = new JobQueue({ storageFile: tmpFile });
    const job1 = queue1.createJob({ type: 'task-a', payload: { step: 1 } });
    const job2 = queue1.createJob({ type: 'task-b', payload: { step: 2 } });
    queue1.updateJobProgress(job1.id, { status: 'COMPLETED', progress: 100 });

    assert.equal(queue1.jobs.size, 2);

    // Instance 2 (Simulates container restart): Re-hydrate from same file
    const queue2 = new JobQueue({ storageFile: tmpFile });
    assert.equal(queue2.jobs.size, 2);

    const rehydratedJob1 = queue2.getJob(job1.id);
    assert.equal(rehydratedJob1.type, 'task-a');
    assert.equal(rehydratedJob1.status, 'COMPLETED');

    const rehydratedJob2 = queue2.getJob(job2.id);
    assert.equal(rehydratedJob2.type, 'task-b');
    assert.equal(rehydratedJob2.status, 'PENDING');
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
