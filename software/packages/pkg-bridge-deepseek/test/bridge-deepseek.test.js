import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeepseekBridgeServer, ModelUnsetError, resolveDeepseekModel } from '../index.js';

// Intent: software/RULES.md#rule-7
// Intent: software/packages/pkg-bridge-deepseek/INTENT.md#no-default-model

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

// Non-regression (Rule 29): this suite used to assert a pinned Ollama model and
// kept passing while that model aged — and server.js fell back to a different
// name than the package did. A green suite guarding two caches.
test('bridge-deepseek - names no model and takes it from OLLAMA_MODEL or DEEPSEEK_MODEL', () => {
  assert.equal(resolveDeepseekModel({}), '');
  assert.equal(resolveDeepseekModel({ OLLAMA_MODEL: MEASURED }), MEASURED);
  assert.equal(resolveDeepseekModel({ DEEPSEEK_MODEL: MEASURED }), MEASURED);
  const bridge = new DeepseekBridgeServer({ stubMode: true, model: MEASURED });
  assert.equal(bridge.model, MEASURED);
});

test('bridge-deepseek - a real bridge refuses to exist without a model, with a typed error', () => {
  assert.throws(
    () => new DeepseekBridgeServer({ stubMode: false, model: '', apiKey: 'test-key' }),
    (err) => err instanceof ModelUnsetError && err.code === 'BRIDGE_MODEL_UNSET' && /OLLAMA_MODEL/.test(err.message),
  );
});

test('bridge-deepseek - the simulated bridge runs without a model and says it has none', () => {
  const bridge = new DeepseekBridgeServer({ stubMode: true, model: '' });
  assert.equal(bridge.model, null);
});

test('bridge-deepseek - server.js halts without a model and names the variable to provide', async () => {
  const run = await startWithoutModel({ BRIDGE_DEEPSEEK_STUB: '0', DEEPSEEK_WS_BASE: os.tmpdir() });
  assert.equal(run.signal, null, `server.js was still running after the grace period: it started on a default.\n${run.stdout}`);
  assert.equal(run.code, 2);
  assert.match(run.stderr, /OLLAMA_MODEL/);
  assert.match(run.stderr, /Rule 7/);
});

test('bridge-deepseek - health endpoint reports the supplied model', async () => {
  const bridge = new DeepseekBridgeServer({ stubMode: true, model: MEASURED, apiKey: 'test-key' });
  const server = bridge.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'brick-bridge-deepseek');
  assert.equal(data.model, MEASURED);
  assert.equal(data.hasApiKey, true);

  server.close();
});

test('bridge-deepseek - inject stub execution completes with the supplied model and perimeter', async () => {
  const bridge = new DeepseekBridgeServer({ stubMode: true, model: MEASURED });
  const server = bridge.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation: 'dsh-check',
      message: 'Write bash script to backup logs',
      perimeter: '/tmp/test-perimeter',
    })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.conversation, 'dsh-check');
  assert.equal(data.model, MEASURED);
  assert.equal(data.perimeter, '/tmp/test-perimeter');

  server.close();
});
