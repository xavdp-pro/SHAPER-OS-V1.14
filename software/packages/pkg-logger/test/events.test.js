import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatEventRecord,
  validateEventRecord,
  generateExecutionId,
  KNOWN_EVENTS,
  EventLogger,
  LogCollector,
  createLoggerServer,
  ingestLog,
} from '../index.js';

describe('Shared Event Vocabulary (Task 2)', () => {
  it('formats canonical event record with all standard fields', () => {
    const rec = formatEventRecord({
      pod: 'maestro',
      event: 'BEAT_ENQUEUED',
      level: 'info',
      correlationId: 'job-999',
      data: { slug: 'pod-1', queue: 'http://127.0.0.1:8840' },
      durationMs: 15.67,
    });

    assert.equal(rec.pod, 'maestro');
    assert.equal(rec.event, 'BEAT_ENQUEUED');
    assert.equal(rec.level, 'INFO');
    assert.equal(rec.correlationId, 'job-999');
    assert.equal(rec.correlation_id, 'job-999');
    assert.equal(typeof rec.execution_id, 'string');
    assert.equal(rec.at, rec.timestamp);
    assert.equal(rec.duration_ms, 15.7);
    assert.equal(rec.data.slug, 'pod-1');

    const validation = validateEventRecord(rec);
    assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join(', ')}`);
  });

  it('validates known levels and handles fallback', () => {
    const rec = formatEventRecord({
      pod: 'test',
      event: 'CUSTOM_ACTION',
      level: 'INVALID_LEVEL',
    });
    assert.equal(rec.level, 'INFO');
  });

  it('validates event schema and detects malformed records', () => {
    assert.equal(validateEventRecord(null).valid, false);
    assert.equal(validateEventRecord({}).valid, false);
    assert.equal(validateEventRecord({ at: 'invalid-date', pod: 'x', event: 'EV', level: 'INFO' }).valid, false);
    assert.equal(validateEventRecord({ at: new Date().toISOString(), pod: '', event: 'EV', level: 'INFO' }).valid, false);
    assert.equal(validateEventRecord({ at: new Date().toISOString(), pod: 'x', event: 'lowercase_not_allowed', level: 'INFO' }).valid, false);
  });

  it('EventLogger records canonical format to disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-events-'));
    const logger = new EventLogger({ pod: 'test-pod', logDir: tmpDir });

    const entry = logger.log({
      event: 'BEAT_EXECUTED',
      correlationId: 'trace-42',
      data: { slug: 'task-base-proof', kind: 'generic', processed: 1 },
      durationMs: 42.12,
    });

    assert.equal(entry.pod, 'test-pod');
    assert.equal(entry.event, 'BEAT_EXECUTED');
    assert.equal(entry.correlationId, 'trace-42');
    assert.equal(entry.duration_ms, 42.1);

    const events = logger.readLastEvents(10);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'BEAT_EXECUTED');
    assert.equal(events[0].correlation_id, 'trace-42');
    assert.equal(events[0].at, events[0].timestamp);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('LogCollector and ingestLog client pass correlationId end-to-end over HTTP', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-events-'));
    const collector = new LogCollector({ logDir: tmpDir });
    const server = createLoggerServer({ port: 0, collector, logDir: tmpDir });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const loggerUrl = `http://127.0.0.1:${port}`;

    const record = await ingestLog({
      loggerUrl,
      pod: 'brick-maestro',
      event: 'BEAT_STARTED',
      correlationId: 'beat-cycle-7',
      level: 'INFO',
      data: { slug: 'task-base-proof', kind: 'generic' },
      durationMs: 5.2,
    });

    assert.ok(record);
    assert.equal(record.pod, 'brick-maestro');
    assert.equal(record.event, 'BEAT_STARTED');
    assert.equal(record.correlationId, 'beat-cycle-7');
    assert.equal(record.correlation_id, 'beat-cycle-7');
    assert.equal(record.data.slug, 'task-base-proof');

    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('documents all known system events in KNOWN_EVENTS dictionary', () => {
    const events = Object.keys(KNOWN_EVENTS);
    assert.ok(events.includes('MAESTRO_STARTED'));
    assert.ok(events.includes('BEAT_ENQUEUED'));
    assert.ok(events.includes('BEAT_SKIPPED'));
    assert.ok(events.includes('TASK_REGISTERED'));
    assert.ok(events.includes('BEAT_EXECUTED'));
    assert.ok(events.includes('JOB_ENQUEUED'));
    assert.ok(events.includes('JOB_COMPLETED'));

    // The base declares its own vocabulary and no one else's. A catalogue
    // brick — mail intake, document pipeline — registers its events itself.
    for (const [name, meta] of Object.entries(KNOWN_EVENTS)) {
      assert.match(
        meta.brick,
        /^brick-(maestro|queue|logger|vault|agent-runtime|bridge-[a-z0-9-]+)$/,
        `Event ${name} is declared by ${meta.brick}, which the base does not ship`,
      );
    }

    for (const [name, meta] of Object.entries(KNOWN_EVENTS)) {
      assert.ok(meta.brick, `Event ${name} must declare an emitting brick`);
      assert.ok(meta.description, `Event ${name} must declare a description`);
      assert.ok(Array.isArray(meta.fields), `Event ${name} must declare expected fields`);
    }
  });
});
