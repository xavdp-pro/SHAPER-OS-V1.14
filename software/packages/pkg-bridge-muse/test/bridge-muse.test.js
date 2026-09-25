import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MuseBridgeServer,
  ModelUnsetError,
  resolveMuseModel,
  buildMuseExecArgs,
} from '../index.js';
import { museHeadlessSafetyFlags } from '../muse-env.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server.js');
const MEASURED = 'muse-spark-1.3-high';

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

test('bridge-muse - model from MUSE_MODEL or META_MUSE_MODEL', () => {
  assert.equal(resolveMuseModel({}), '');
  assert.equal(resolveMuseModel({ MUSE_MODEL: ` ${MEASURED} ` }), MEASURED);
  assert.equal(resolveMuseModel({ META_MUSE_MODEL: MEASURED }), MEASURED);
});

test('bridge-muse - headless args include yolo and auto-resolve', () => {
  assert.deepEqual(museHeadlessSafetyFlags(), ['--yolo', '--user-input-auto-resolve']);
  const args = buildMuseExecArgs({ prompt: 'ping', model: MEASURED, workspace: '/tmp/ws' });
  assert.ok(args.includes('--yolo'));
  assert.ok(args.includes('--user-input-auto-resolve'));
  assert.ok(args.includes('--json'));
  assert.equal(args.at(-1), 'ping');
});

test('bridge-muse - real bridge refuses without model', () => {
  assert.throws(
    () => new MuseBridgeServer({ stubMode: false, defaultModel: '', workspaceBase: '/tmp/muse-test-ws' }),
    (err) => err instanceof ModelUnsetError && err.code === 'BRIDGE_MODEL_UNSET',
  );
});

test('bridge-muse - server.js halts without model', async () => {
  const run = await startWithoutModel({ BRIDGE_MUSE_STUB: '0', MUSE_WS_BASE: os.tmpdir() });
  assert.equal(run.signal, null);
  assert.equal(run.code, 2);
  assert.match(run.stderr, /MUSE_MODEL/);
});

test('bridge-muse - health and inject stub', async () => {
  const bridge = new MuseBridgeServer({ stubMode: true, defaultModel: MEASURED });
  const server = bridge.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  const h = await health.json();
  assert.equal(h.service, 'brick-bridge-muse');
  assert.equal(h.model, MEASURED);

  const inj = await fetch(`http://127.0.0.1:${port}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation: 't1', message: 'hello' }),
  });
  const body = await inj.json();
  assert.equal(body.ok, true);
  assert.equal(body.stub, true);

  server.close();
});
