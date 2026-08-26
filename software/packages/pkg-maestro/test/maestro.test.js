import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MaestroScheduler, createMaestroServer } from '../index.js';

test('maestro-engine - 1. Mandatory task registration in registry', () => {
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-test-1-'));
  const maestro = new MaestroScheduler({ logDir: tmpLogDir });

  const entry = maestro.registerTask({
    slug: 'mail-v1-contact-zoutik-example-com',
    label: 'contact@zoutik.example.com',
    port: 8432,
    cadenceSeconds: 30,
    vaultKey: 'label-contact-zoutik',
  });

  assert.equal(entry.slug, 'mail-v1-contact-zoutik-example-com');
  assert.equal(entry.label, 'contact@zoutik.example.com');
  assert.equal(entry.port, 8432);
  assert.equal(entry.cadenceSeconds, 30);
  assert.equal(entry.status, 'active');

  const registered = maestro.listRegisteredPods();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].slug, 'mail-v1-contact-zoutik-example-com');

  fs.rmSync(tmpLogDir, { recursive: true, force: true });
});

test('maestro-engine - 2. Strict validation of required registration parameters', () => {
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-test-2-'));
  const maestro = new MaestroScheduler({ logDir: tmpLogDir });

  assert.throws(() => {
    maestro.registerTask({ slug: 'sans-label', port: 8430 });
  }, /slug, label and port are required/);

  fs.rmSync(tmpLogDir, { recursive: true, force: true });
});

test('maestro-engine - 3. Beat pacing and metrics incrementation', async () => {
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-test-3-'));
  const maestro = new MaestroScheduler({ logDir: tmpLogDir });

  maestro.registerTask({
    slug: 'mail-v1-contact-zoutik-example-com',
    label: 'contact@zoutik.example.com',
    port: 8432,
  });

  const report = await maestro.triggerBeat('mail-v1-contact-zoutik-example-com', async (pod) => {
    return { ok: true, newMessages: 3 };
  });

  assert.equal(report.slug, 'mail-v1-contact-zoutik-example-com');
  assert.equal(report.new_messages, 3);
  assert.ok(report.duration_ms >= 0);

  const logs = maestro.logger.readLastEvents(10);
  assert.equal(logs.length, 2); // 1 REGISTERED + 1 BEAT_EXECUTED
  const lastLog = logs[logs.length - 1];
  assert.equal(lastLog.event, 'BEAT_EXECUTED');
  assert.equal(lastLog.data.new_messages, 3);

  fs.rmSync(tmpLogDir, { recursive: true, force: true });
});

test('maestro-engine - 4. HTTP REST server & scheduler lifecycle', async () => {
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-test-4-'));
  const PORT = 8539;
  const scheduler = new MaestroScheduler({ logDir: tmpLogDir });
  const server = createMaestroServer({ port: PORT, scheduler });

  await new Promise((resolve) => server.on('listening', resolve));

  // Health
  const healthRes = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  assert.equal(healthRes.status, 200);
  const healthJson = await healthRes.json();
  assert.equal(healthJson.service, 'maestro-v1');

  // Register pod via HTTP
  const regRes = await fetch(`http://127.0.0.1:${PORT}/api/pods/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: 'mail-v1-demo',
      label: 'demo@example.com',
      port: 8102,
      cadenceSeconds: 60
    })
  });
  assert.equal(regRes.status, 200);

  // List pods
  const listRes = await fetch(`http://127.0.0.1:${PORT}/api/pods`);
  const listJson = await listRes.json();
  assert.equal(listJson.pods.length, 1);
  assert.equal(listJson.pods[0].slug, 'mail-v1-demo');

  // Start & Stop Scheduler
  const startRes = await fetch(`http://127.0.0.1:${PORT}/api/scheduler/start`, { method: 'POST' });
  assert.equal(startRes.status, 200);
  assert.equal(scheduler.isRunning, true);

  const stopRes = await fetch(`http://127.0.0.1:${PORT}/api/scheduler/stop`, { method: 'POST' });
  assert.equal(stopRes.status, 200);
  assert.equal(scheduler.isRunning, false);

  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpLogDir, { recursive: true, force: true });
});
