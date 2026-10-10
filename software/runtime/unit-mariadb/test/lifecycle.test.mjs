// Intent: software/runtime/unit-mariadb/INTENT.md
// The coordinated stop with real processes: the "application" and the
// "engine" are two node children; the order in which they receive SIGTERM is
// read from what they write, not from the function's own report.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stopInOrder, terminate, track } from '../lifecycle.mjs';

function child(dir, name, { drainMs = 0, ignoreTerm = false } = {}) {
  const journal = path.join(dir, 'journal');
  const code = `
    const fs = require('node:fs');
    const note = (w) => fs.appendFileSync(${JSON.stringify(journal)}, ${JSON.stringify(name)} + ' ' + w + ' ' + process.hrtime.bigint() + '\\n');
    note('up');
    process.on('SIGTERM', () => {
      note('term');
      if (${ignoreTerm}) return;
      setTimeout(() => { note('exit'); process.exit(0); }, ${drainMs});
    });
    setInterval(() => {}, 1000);
  `;
  const proc = track(spawn(process.execPath, ['-e', code], { stdio: 'ignore', detached: true }));
  return proc;
}

async function upBoth(dir) {
  const journal = path.join(dir, 'journal');
  for (let i = 0; i < 100; i += 1) {
    if (fs.existsSync(journal) && (fs.readFileSync(journal, 'utf8').match(/ up /g) || []).length === 2) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('children did not start');
}

const events = (dir) => fs.readFileSync(path.join(dir, 'journal'), 'utf8').trim().split('\n')
  .map((l) => { const [who, what, t] = l.split(' '); return { who, what, t: BigInt(t) }; });

test('the application drains completely before MariaDB is asked to stop', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-lifecycle-'));
  try {
    const app = child(dir, 'app', { drainMs: 300 });
    const engine = child(dir, 'engine', { drainMs: 50 });
    await upBoth(dir);
    const result = await stopInOrder({ app, engine, drainSeconds: 5, engineStopSeconds: 5 });
    assert.equal(result.drained, true);
    assert.equal(result.clean, true);
    const e = events(dir);
    const at = (who, what) => e.find((x) => x.who === who && x.what === what).t;
    assert.ok(at('app', 'term') < at('app', 'exit'));
    assert.ok(at('app', 'exit') < at('engine', 'term'), 'MariaDB received SIGTERM only after the application had exited');
    assert.ok(at('engine', 'term') < at('engine', 'exit'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an application that outlives its drain is killed, and MariaDB is still stopped after it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-lifecycle-'));
  try {
    const app = child(dir, 'app', { ignoreTerm: true });
    const engine = child(dir, 'engine', { drainMs: 10 });
    await upBoth(dir);
    const started = Date.now();
    const result = await stopInOrder({ app, engine, drainSeconds: 1, engineStopSeconds: 5 });
    assert.equal(result.drained, false);
    assert.equal(result.app.signal, 'SIGKILL');
    assert.equal(result.clean, true);
    assert.ok(Date.now() - started >= 1000);
    const e = events(dir);
    assert.ok(e.find((x) => x.who === 'engine' && x.what === 'term'), 'MariaDB was still asked to stop');
    assert.equal(app.alive, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an engine that does not shut down is killed and reported unclean', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-lifecycle-'));
  try {
    const app = child(dir, 'app', { drainMs: 10 });
    const engine = child(dir, 'engine', { ignoreTerm: true });
    await upBoth(dir);
    const result = await stopInOrder({ app, engine, drainSeconds: 5, engineStopSeconds: 1 });
    assert.equal(result.drained, true);
    assert.equal(result.clean, false);
    assert.equal(result.engine.signal, 'SIGKILL');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('terminate is a no-op on a process already gone, and track reports a command that never started', async () => {
  const gone = track(spawn(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' }));
  await gone.exited;
  assert.deepEqual(await terminate(gone, 1), { graceful: true, code: 3, signal: null });
  const missing = track(spawn('/nonexistent/mariadbd', [], { stdio: 'ignore' }));
  missing.on('error', () => {});
  assert.deepEqual(await missing.exited, { code: 127, signal: null });
  assert.equal(missing.alive, false);
});
