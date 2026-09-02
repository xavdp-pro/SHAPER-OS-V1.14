import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/packages/pkg-opencode-server/INTENT.md#absent-cli
// Intent: software/RULES.md#rule-7
//
// Non-regression (Rule 29): the real bridge spawns `opencode serve` from
// OPENCODE_BIN and listened to the child's stdout, stderr and close — never
// to its 'error' event. When the binary is absent (an image whose fetch
// failed, a wrong OPT_BRIDGE_ROOT, a laptop without the CLI) Node emits
// 'error' with ENOENT; with no listener that is an uncaught exception, and
// the bridge died with a stack trace after it had already answered
// /api/health — an untyped crash where the law asks for a halt that names
// what to supply (Rule 0J).

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server.mjs');

const homes = [];
after(() => {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
});

function start(extraEnv = {}) {
  return new Promise((resolve) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-opencode-absent-cli-'));
    homes.push(home);
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      OPENCODE_BRIDGE_PORT: '0',
      OPENCODE_WS_BASE: path.join(home, 'ws'),
      TOKEN_FILE: path.join(home, 'token'),
      SESSIONS_FILE: path.join(home, 'sessions.json'),
      BRIDGE_OPENCODE_STUB: '0',
      OPENCODE_MODEL: 'measured/at-deploy',
      ...extraEnv,
    };
    const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 6000);
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.on('data', (c) => { stdout += c; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stderr, stdout, killed }); });
  });
}

describe('opencode-server without its CLI', () => {
  it('halts with a typed message naming OPENCODE_BIN and the path it tried, not an uncaught exception', async () => {
    const missing = path.join(os.tmpdir(), 'shaper-no-such-opencode', 'bin', 'opencode');
    const run = await start({ OPENCODE_BIN: missing });
    assert.equal(run.signal, null, `the bridge was still running with no CLI after the grace period:\n${run.stdout}${run.stderr}`);
    assert.doesNotMatch(run.stderr, /Uncaught|at ChildProcess|node:internal/, `an untyped crash:\n${run.stderr}`);
    assert.equal(run.code, 2, `expected the Rule 0J halt code:\n${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /HALT/, 'the halt is announced as one');
    assert.match(run.stderr, /OPENCODE_BIN/, 'the halt must name the variable to set');
    assert.ok(run.stderr.includes(missing), 'the halt must name the path it tried');
    assert.doesNotMatch(run.stderr, /restarting in 3s/, 'a missing binary is not a crash to retry every three seconds');
  });
});
