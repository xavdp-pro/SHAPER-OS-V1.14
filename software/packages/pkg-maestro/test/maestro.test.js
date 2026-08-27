import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MaestroScheduler, createMaestroServer } from '../index.js';

// Intent: docs/architecture/NAMING.md#generic-boundary
// Intent: software/universes/univ-base/INTENT.md#what-a-task-must-carry

test('maestro - 1. a declared task enters the registry', () => {
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-test-1-'));
  const maestro = new MaestroScheduler({ logDir: tmpLogDir });

  const entry = maestro.registerTask({
    slug: 'task-base-proof',
    kind: 'bridge',
    bridgeType: 'opencode',
    instruction: 'Run the declared base proof task and report evidence.',
    cadenceSeconds: 30,
    vaultKey: 'vault-base-proof',
  });

  assert.equal(entry.slug, 'task-base-proof');
  assert.equal(entry.kind, 'bridge');
  assert.equal(entry.bridgeType, 'opencode');
  assert.equal(entry.cadenceSeconds, 30);
  assert.equal(entry.status, 'active');

  const registered = maestro.listRegisteredTasks();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].slug, 'task-base-proof');

  fs.rmSync(tmpLogDir, { recursive: true, force: true });
});

// Non-regression: until v1.11 `registerTask` demanded a `label` and a `port`,
// which were a monitored mailbox and its container port wearing generic names.
// A universe whose work is neither an address nor a socket could not declare a
// task at all — `univ-base`'s own task file was rejected by its own scheduler.
test('maestro - 2. a task needs a slug, and nothing else', () => {
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-test-2-'));
  const maestro = new MaestroScheduler({ logDir: tmpLogDir });

  const entry = maestro.registerTask({ slug: 'task-minimal' });
  assert.equal(entry.slug, 'task-minimal');
  assert.equal(entry.kind, 'generic');
  assert.equal(entry.label, null, 'no label is invented for a task that has none');
  assert.equal(entry.port, null, 'no port is invented for a task that targets none');

  assert.throws(() => maestro.registerTask({ kind: 'generic' }), /slug is required/);
  assert.throws(() => maestro.registerTask({ slug: 'task-x', kind: 'mail' }), /unknown task kind/);

  fs.rmSync(tmpLogDir, { recursive: true, force: true });
});

test('maestro - 3. a beat is paced, counted and evidenced', async () => {
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-test-3-'));
  const maestro = new MaestroScheduler({ logDir: tmpLogDir });

  maestro.registerTask({ slug: 'task-base-proof', kind: 'bridge', bridgeType: 'opencode' });

  const report = await maestro.triggerBeat('task-base-proof', async () => ({ ok: true, processed: 3 }));

  assert.equal(report.slug, 'task-base-proof');
  assert.equal(report.processed, 3);
  assert.ok(report.duration_ms >= 0);

  const logs = maestro.logger.readLastEvents(10);
  assert.equal(logs.length, 2); // 1 TASK_REGISTERED + 1 BEAT_EXECUTED
  const lastLog = logs[logs.length - 1];
  assert.equal(lastLog.event, 'BEAT_EXECUTED');
  assert.equal(lastLog.data.processed, 3);

  fs.rmSync(tmpLogDir, { recursive: true, force: true });
});

test('maestro - 4. HTTP task surface and scheduler lifecycle', async () => {
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-test-4-'));
  const scheduler = new MaestroScheduler({ logDir: tmpLogDir });
  const server = createMaestroServer({ port: 0, scheduler });

  await new Promise((resolve) => server.on('listening', resolve));
  const PORT = server.address().port;

  const healthRes = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  assert.equal(healthRes.status, 200);
  const healthJson = await healthRes.json();
  assert.equal(healthJson.service, 'brick-maestro');

  const regRes = await fetch(`http://127.0.0.1:${PORT}/api/tasks/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'task-demo', kind: 'generic', cadenceSeconds: 60 }),
  });
  assert.equal(regRes.status, 200);

  const listRes = await fetch(`http://127.0.0.1:${PORT}/api/tasks`);
  const listJson = await listRes.json();
  assert.equal(listJson.tasks.length, 1);
  assert.equal(listJson.tasks[0].slug, 'task-demo');

  const badRes = await fetch(`http://127.0.0.1:${PORT}/api/tasks/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cadenceSeconds: 60 }),
  });
  assert.equal(badRes.status, 400);

  const startRes = await fetch(`http://127.0.0.1:${PORT}/api/scheduler/start`, { method: 'POST' });
  assert.equal(startRes.status, 200);
  assert.equal(scheduler.isRunning, true);

  const stopRes = await fetch(`http://127.0.0.1:${PORT}/api/scheduler/stop`, { method: 'POST' });
  assert.equal(stopRes.status, 200);
  assert.equal(scheduler.isRunning, false);

  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpLogDir, { recursive: true, force: true });
});
