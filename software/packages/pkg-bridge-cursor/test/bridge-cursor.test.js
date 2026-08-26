import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CursorBridgeServer, COMPOSER_MODEL, COMPOSER_DEFAULT_MODE } from '../index.js';

test('bridge-cursor - model composer-2.5 with fast mode disabled by default', () => {
  const bridge = new CursorBridgeServer({ stubMode: true });
  assert.equal(bridge.model, 'composer-2.5');
  assert.equal(bridge.mode, 'normal'); // Fast is OFF by default
});

test('bridge-cursor - health endpoint reports composer-2.5 normal mode by default', async () => {
  const bridge = new CursorBridgeServer({ stubMode: true });
  const server = bridge.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'brick-bridge-cursor');
  assert.equal(data.model, 'composer-2.5');
  assert.equal(data.defaultMode, 'normal');
  assert.equal(data.fastEnabled, false);

  server.close();
});

test('bridge-cursor - inject supports explicit fast mode on-demand', async () => {
  const bridge = new CursorBridgeServer({ stubMode: true });
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
    port: 0, cursorBin: '/bin/echo', stubMode: false, workspaceBase: '/tmp/cursor-test-ws',
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
