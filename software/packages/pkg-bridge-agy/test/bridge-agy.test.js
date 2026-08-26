import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgyBridgeServer } from '../index.js';

test('bridge-agy - health and metrics contract', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'));
  const bridge = new AgyBridgeServer({ workspaceBase: tmp, port: 0, stubMode: true });
  const server = bridge.createServer();
  t.after(async () => {
    if (server.listening) await new Promise((r) => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.service, 'brick-bridge-agy');

  const metrics = await (await fetch(`http://127.0.0.1:${port}/api/metrics`)).json();
  assert.equal(metrics.ok, true);
});

test('bridge-agy - inject stub mode', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-inj-'));
  const ctx = path.join(tmp, 'ctx-universe.md');
  fs.writeFileSync(ctx, '# Univ7\nRole: overnight ops watchdog', 'utf8');

  const bridge = new AgyBridgeServer({ workspaceBase: tmp, port: 0, stubMode: true });
  const server = bridge.createServer();
  t.after(async () => {
    if (server.listening) await new Promise((r) => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation: 'univ7-ops',
      context_file: ctx,
      message: 'Summarize overnight ops status.',
    }),
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.conversation, 'univ7-ops');
  assert.equal(data.stub, true);
});

test('bridge-agy - contextual prompt carries an enforceable perimeter', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-perimeter-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bridge = new AgyBridgeServer({ workspaceBase: tmp, stubMode: true });

  const prompt = bridge.buildContextualPrompt('Inspect the assigned files.', {
    perimeter: tmp,
  });

  assert.match(prompt, /\[PERIMETER\]/);
  assert.match(prompt, new RegExp(tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /\[USER REQUEST\]\nInspect the assigned files\./);
});
