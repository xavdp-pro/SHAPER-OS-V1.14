import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventLogger } from '../index.js';

test('event-logger - structured JSONL log creation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbs-logger-test-'));
  const logger = new EventLogger({ pod: 'mail-v1-test', logDir: tmpDir });

  const record = logger.log({
    event: 'TASK_REGISTERED',
    data: { sender: 'test@example.com', subject: 'Demande devis' },
    durationMs: 45.67,
  });

  assert.equal(record.pod, 'mail-v1-test');
  assert.equal(record.event, 'TASK_REGISTERED');
  assert.equal(record.level, 'INFO');
  assert.equal(record.duration_ms, 45.7);
  assert.ok(record.execution_id.startsWith('run-'));

  const last = logger.readLastEvents(10);
  assert.equal(last.length, 1);
  assert.equal(last[0].data.sender, 'test@example.com');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('event-logger - mandatory parameters validation', () => {
  assert.throws(() => new EventLogger({ logDir: '/tmp' }), /pod identifier/);
  assert.throws(() => new EventLogger({ pod: 'test' }), /log directory/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbs-logger-test2-'));
  const logger = new EventLogger({ pod: 'test-pod', logDir: tmpDir });
  assert.throws(() => logger.log({}), /event name is required/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
