import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgyBridgeServer, ModelUnsetError, resolveAgyModel } from '../index.js';

// Intent: software/RULES.md#rule-7
// Intent: software/packages/pkg-bridge-agy/INTENT.md#no-default-model

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server.js');

// A fictional id, shaped like what a measurement would return. It is what a
// test supplies explicitly, so that no default has to exist for the suite to run.
const MEASURED = 'engine/measured-at-deploy';

/**
 * Start the real server.js with no model and watch what it does. The old
 * start-up ran on a hardcoded name and listened forever, so a process that is
 * still alive after the grace period is the failure this test exists to catch.
 */
function startWithoutModel(extraEnv = {}) {
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH, HOME: os.tmpdir(), PORT: '0', ...extraEnv };
    const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.on('data', (c) => { stdout += c; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 4000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr, stdout });
    });
  });
}

// Non-regression (Rule 29): the constructor used to fall back to a pinned
// model when AGY_MODEL was unset, and the vitals suite asserted that name —
// green while the deploy template pinned a different version of the same thing.
test('bridge-agy - names no model and takes it from AGY_MODEL or ANTIGRAVITY_MODEL', () => {
  assert.equal(resolveAgyModel({}), '');
  assert.equal(resolveAgyModel({ AGY_MODEL: MEASURED }), MEASURED);
  assert.equal(resolveAgyModel({ ANTIGRAVITY_MODEL: MEASURED }), MEASURED);
  const bridge = new AgyBridgeServer({ stubMode: true, defaultModel: MEASURED, workspaceBase: os.tmpdir() });
  assert.equal(bridge.defaultModel, MEASURED);
});

test('bridge-agy - a real bridge refuses to exist without a model, with a typed error', () => {
  assert.throws(
    () => new AgyBridgeServer({ stubMode: false, defaultModel: '', workspaceBase: os.tmpdir() }),
    (err) => err instanceof ModelUnsetError && err.code === 'BRIDGE_MODEL_UNSET' && /AGY_MODEL/.test(err.message),
  );
});

test('bridge-agy - the simulated bridge runs without a model and says it has none', () => {
  const bridge = new AgyBridgeServer({ stubMode: true, defaultModel: '', workspaceBase: os.tmpdir() });
  assert.equal(bridge.defaultModel, null);
});

test('bridge-agy - server.js halts without a model and names the variable to provide', async () => {
  const run = await startWithoutModel({ BRIDGE_AGY_STUB: '0', AGY_WS_BASE: os.tmpdir() });
  assert.equal(run.signal, null, `server.js was still running after the grace period: it started on a default.\n${run.stdout}`);
  assert.equal(run.code, 2);
  assert.match(run.stderr, /AGY_MODEL/);
  assert.match(run.stderr, /Rule 7/);
});

test('bridge-agy - health and metrics contract', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'));
  const bridge = new AgyBridgeServer({ workspaceBase: tmp, port: 0, stubMode: true, defaultModel: MEASURED });
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

  const bridge = new AgyBridgeServer({ workspaceBase: tmp, port: 0, stubMode: true, defaultModel: MEASURED });
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
  const bridge = new AgyBridgeServer({ workspaceBase: tmp, stubMode: true, defaultModel: MEASURED });

  const prompt = bridge.buildContextualPrompt('Inspect the assigned files.', {
    perimeter: tmp,
  });

  assert.match(prompt, /\[PERIMETER\]/);
  assert.match(prompt, new RegExp(tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /\[USER REQUEST\]\nInspect the assigned files\./);
});
