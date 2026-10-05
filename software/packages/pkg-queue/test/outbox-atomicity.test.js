import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MariaDbJobQueue } from '../mariadb-store.js';

// Regression: a committed job used to lose its evidence during Logger outage.
// Refusal to persist the evidence must roll back the owning job as well.
test('enqueue cannot acknowledge or stream a job whose evidence insert failed', async () => {
  const calls = [];
  let rolledBack = false, committed = false;
  const conn = {
    beginTransaction: async () => {}, commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; }, release() {},
    execute: async (sql) => {
      calls.push(sql);
      if (sql.includes('INSERT INTO event_outbox')) throw Object.assign(new Error('disk failure'), { code: 'ER_RECORD_FILE_FULL' });
      return [{}];
    },
  };
  const queue = new MariaDbJobQueue({ pool: { getConnection: async () => conn } });
  const emitted = [];
  queue.on('jobCreated', (job) => emitted.push(job));
  await assert.rejects(queue.enqueue({ type: 'reference.probe' }), { code: 'ER_RECORD_FILE_FULL' });
  assert.equal(rolledBack, true);
  assert.equal(committed, false);
  assert.deepEqual(emitted, []);
  assert.equal(calls.length, 3);
});

test('Logger is not called in the owning transaction and payloads stay outside evidence', async () => {
  let committed = false, event;
  const conn = {
    beginTransaction: async () => {}, commit: async () => { committed = true; },
    rollback: async () => {}, release() {},
    execute: async (sql, params) => {
      if (sql.includes('INSERT INTO event_outbox')) event = JSON.parse(params[1]);
      return [{}];
    },
  };
  const queue = new MariaDbJobQueue({ pool: { getConnection: async () => conn },
    loggerUrl: 'http://unused', fetchImpl: async () => { assert.fail('network in enqueue'); } });
  const { job } = await queue.enqueue({ type: 'reference.probe', payload: { message: 'private input' } });
  assert.equal(committed, true);
  assert.equal(event.correlationId, job.id);
  assert.equal(event.executionId, job.id);
  assert.doesNotMatch(JSON.stringify(event), /private input/);
});
