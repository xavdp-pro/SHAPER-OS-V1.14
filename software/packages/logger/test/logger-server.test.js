import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LogCollector, createLoggerServer } from '../index.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-server-test-'));
const PORT = 8529;

let server;

before(async () => {
  server = createLoggerServer({ port: PORT, host: '127.0.0.1', logDir: tmpDir });
  await new Promise((resolve) => server.on('listening', resolve));
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger-server - health and ingest over HTTP', async () => {
  const healthRes = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  const health = await healthRes.json();
  assert.equal(healthRes.status, 200);
  assert.equal(health.service, 'logger-v1');

  const ingestRes = await fetch(`http://127.0.0.1:${PORT}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pod: 'mail-v1-test',
      event: 'MAIL_RECEIVED',
      data: { sender: 'ops@example.com' },
    }),
  });
  const ingested = await ingestRes.json();
  assert.equal(ingestRes.status, 200);
  assert.equal(ingested.record.event, 'MAIL_RECEIVED');

  const lastRes = await fetch(`http://127.0.0.1:${PORT}/api/events/last?pod=mail-v1-test&limit=10`);
  const last = await lastRes.json();
  assert.equal(last.events.length, 1);
  assert.equal(last.events[0].data.sender, 'ops@example.com');
});

test('LogCollector - per-pod directory layout', () => {
  const collector = new LogCollector({ logDir: path.join(tmpDir, 'layout-test') });
  collector.ingest({ pod: 'worker-a', event: 'BEAT_EXECUTED', data: {} });

  const podDir = path.join(tmpDir, 'layout-test', 'worker-a');
  assert.ok(fs.existsSync(podDir));
  assert.ok(fs.existsSync(path.join(podDir, 'activity.jsonl')));
  assert.deepEqual(collector.listPods(), ['worker-a']);
});
