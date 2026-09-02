import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-7
// Intent: software/packages/pkg-opencode-server/INTENT.md#no-default-model
//
// Non-regression (Rule 29): the opencode brick's image runs THIS package, and
// it used to start without a model — logging `model=` and handing every run
// to `opencode serve` with nothing to run it on. A missing configuration is a
// halt that names the variable to provide (Rule 0J), not a warning; the twin
// package pkg-bridge-opencode already halts this way, and the review of the
// Rule 7 sweep found this server still starting. Only the simulated bridge,
// which never spawns the CLI, runs without a model.

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server.mjs');

/** Every scratch HOME this file creates; removed once the suite is done. */
const homes = [];
after(() => {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
});

/**
 * Start the real server.mjs and watch what it does. A process still alive
 * after the grace period is one that started on nothing, which is the
 * failure this test exists to catch; a process that printed its listen line
 * is one that started on purpose.
 */
function start(extraEnv = {}) {
  return new Promise((resolve) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-opencode-server-'));
    homes.push(home);
    // The token and registry files are named explicitly, in a directory that
    // exists: the brick image mounts ~/.config/opencode-bridge, and this test
    // is about the model, not about a fresh HOME.
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      OPENCODE_BRIDGE_PORT: '0',
      OPENCODE_WS_BASE: path.join(home, 'ws'),
      TOKEN_FILE: path.join(home, 'token'),
      SESSIONS_FILE: path.join(home, 'sessions.json'),
      ...extraEnv,
    };
    const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    let killed = false;
    const finish = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr, stdout, home, killed });
    };
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 4000);
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.on('data', (c) => {
      stdout += c;
      // The listen line is the proof that the server chose to start; nothing
      // after it is under test here, so the child is released at once.
      if (/\[opencode-bridge\] http:\/\//.test(stdout) && !killed) { killed = true; child.kill('SIGTERM'); }
    });
    child.on('close', finish);
  });
}

describe('opencode-server names no default model', () => {
  it('halts without OPENCODE_MODEL, names the variable, and writes nothing first', async () => {
    const run = await start({ BRIDGE_OPENCODE_STUB: '0' });
    assert.equal(run.signal, null, `server.mjs was still running after the grace period: it started on a default.\n${run.stdout}`);
    assert.equal(run.code, 2, `expected the Rule 0J halt code:\n${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /OPENCODE_MODEL/, 'the halt must name the variable to provide');
    assert.match(run.stderr, /Rule 7/, 'the halt must say why');
    assert.doesNotMatch(run.stdout, /\[opencode-bridge\] http:\/\//, 'the server must not listen before halting');
    // The halt fires before the token file is created: a refused start leaves
    // no state behind that a later start would read as its own.
    assert.equal(fs.existsSync(path.join(run.home, 'token')), false,
      'the halt must fire before any file is written');
  });

  it('the simulated bridge still starts without a model', async () => {
    const run = await start({ BRIDGE_OPENCODE_STUB: '1' });
    assert.match(run.stdout, /\[opencode-bridge\] http:\/\//, `the stub did not start:\n${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /STUB mode enabled/);
    assert.doesNotMatch(run.stderr, /HALT/);
  });
});
