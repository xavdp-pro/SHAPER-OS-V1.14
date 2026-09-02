import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CursorBridgeServer, ModelUnsetError, resolveCursorModel, COMPOSER_DEFAULT_MODE } from '../index.js';

// Intent: software/RULES.md#rule-7
// Intent: software/packages/pkg-bridge-cursor/INTENT.md#no-default-model

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

// Non-regression (Rule 29): this suite used to assert a pinned Composer version
// and kept passing while that version aged — a green suite guarding a cache.
test('bridge-cursor - names no model and takes it from CURSOR_MODEL', () => {
  assert.equal(resolveCursorModel({}), '');
  assert.equal(resolveCursorModel({ CURSOR_MODEL: ` ${MEASURED} ` }), MEASURED);
  const bridge = new CursorBridgeServer({ stubMode: true, model: MEASURED });
  assert.equal(bridge.model, MEASURED);
  assert.equal(bridge.mode, COMPOSER_DEFAULT_MODE); // Fast is OFF by default
});

test('bridge-cursor - a real bridge refuses to exist without a model, with a typed error', () => {
  assert.throws(
    () => new CursorBridgeServer({ stubMode: false, model: '', workspaceBase: '/tmp/cursor-test-ws' }),
    (err) => err instanceof ModelUnsetError && err.code === 'BRIDGE_MODEL_UNSET' && /CURSOR_MODEL/.test(err.message),
  );
});

test('bridge-cursor - the simulated bridge runs without a model and says it has none', () => {
  const bridge = new CursorBridgeServer({ stubMode: true, model: '' });
  assert.equal(bridge.model, null);
});

test('bridge-cursor - server.js halts without a model and names the variable to provide', async () => {
  const run = await startWithoutModel({ BRIDGE_CURSOR_STUB: '0', CURSOR_WS_BASE: os.tmpdir() });
  assert.equal(run.signal, null, `server.js was still running after the grace period: it started on a default.\n${run.stdout}`);
  assert.equal(run.code, 2);
  assert.match(run.stderr, /CURSOR_MODEL/);
  assert.match(run.stderr, /Rule 7/);
});

test('bridge-cursor - health endpoint reports the supplied model and normal mode by default', async () => {
  const bridge = new CursorBridgeServer({ stubMode: true, model: MEASURED });
  const server = bridge.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'brick-bridge-cursor');
  assert.equal(data.model, MEASURED);
  assert.equal(data.defaultMode, 'normal');
  assert.equal(data.fastEnabled, false);

  server.close();
});

test('bridge-cursor - inject supports explicit fast mode on-demand', async () => {
  const bridge = new CursorBridgeServer({ stubMode: true, model: MEASURED });
  const server = bridge.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // Default call -> normal mode
  const res1 = await fetch(`http://127.0.0.1:${port}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation: 'standard-task',
      message: 'Refactor navbar',
    })
  });
  const data1 = await res1.json();
  assert.equal(data1.mode, 'normal');

  // Explicit fast mode call -> fast mode
  const res2 = await fetch(`http://127.0.0.1:${port}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation: 'urgent-task',
      message: 'Quick bugfix',
      mode: 'fast'
    })
  });
  const data2 = await res2.json();
  assert.equal(data2.mode, 'fast');

  server.close();
});

test('bridge-cursor - a missing CLI reports exit 127 instead of killing the bridge', async () => {
  // Rule 34: a CLI that cannot start is a state, not a crash. Without the guard
  // Node raises an unhandled 'error' event and the whole bridge dies — taking
  // every other conversation with it, and leaving the queue watching a stream
  // that will never speak again. Observed for real on gbs-test, from one wrong
  // mount path.
  const bridge = new CursorBridgeServer({
    port: 0,
    cursorBin: '/nonexistent-b7f2/cursor-agent',
    stubMode: false,
    model: MEASURED,
    workspaceBase: '/tmp/cursor-test-ws',
  });

  const seen = [];
  bridge.clients.set({ write: (line) => seen.push(line) }, null);

  bridge.runAgent('missing-cli', 'do something');
  await new Promise((r) => setTimeout(r, 200));

  const done = seen.map((l) => JSON.parse(l.replace(/^data: /, ''))).find((e) => e.type === 'done');
  assert.ok(done, 'the run must end on the same channel as any other outcome');
  assert.equal(done.exit_code, 127);
  assert.equal(bridge.metrics.errors, 1);
});

test('bridge-cursor - refuses a perimeter it cannot see, and says why', async () => {
  // A perimeter is only enforceable where the agent runs. A path that exists on
  // the host but not inside this container bounds nothing, and spawning into it
  // fails with an ENOENT that names the *binary* — sending the reader hunting
  // the wrong thing for an hour. Ask this question before spawning, not after.
  const bridge = new CursorBridgeServer({
    port: 0, cursorBin: '/bin/echo', stubMode: false, model: MEASURED, workspaceBase: '/tmp/cursor-test-ws',
  });

  const seen = [];
  bridge.clients.set({ write: (l) => seen.push(l) }, null);

  const r = bridge.runAgent('unreachable', 'do something', { perimeter: '/nonexistent-b7f2/work' });
  assert.equal(r.refused, 'perimeter_unreachable');

  const events = seen.map((l) => JSON.parse(l.replace(/^data: /, '')));
  assert.ok(events.some((e) => e.type === 'log' && /must be mounted into the container/.test(e.text)),
    'the reason must reach the caller, not only the container log');
  assert.equal(events.find((e) => e.type === 'done').exit_code, 126);
});
