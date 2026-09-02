import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/packages/pkg-opencode-server/INTENT.md#fresh-home
//
// Non-regression (Rule 29): the bridge creates its own token on first start
// and writes it under ~/.config/opencode-bridge/token — without ever creating
// that directory. On a HOME the bridge had never seen, the write threw ENOENT
// out of token()'s catch block and the process died with a stack trace before
// listening: a clean-sheet start failed on the one path a clean sheet takes.
// Two reviewers read it; the suite could not see it because every other test
// names TOKEN_FILE inside a directory it created first.

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server.mjs');

const homes = [];
after(() => {
  for (const home of homes) {
    fs.chmodSync(home, 0o700);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/**
 * Start the real server.mjs on a HOME that holds nothing, with no file named.
 * `prepare` may alter the empty HOME before the bridge sees it.
 */
function start(prepare = () => {}) {
  return new Promise((resolve) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-opencode-fresh-home-'));
    homes.push(home);
    prepare(home);
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      OPENCODE_BRIDGE_PORT: '0',
      BRIDGE_OPENCODE_STUB: '1',
    };
    const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 4000);
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.on('data', (c) => {
      stdout += c;
      if (/\[opencode-bridge\] http:\/\//.test(stdout) && !killed) { killed = true; child.kill('SIGTERM'); }
    });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stderr, stdout, home }); });
  });
}

describe('opencode-server starts on a HOME it has never seen', () => {
  it('creates its config directory and its token, and listens', async () => {
    const run = await start();
    assert.doesNotMatch(run.stderr, /ENOENT/, `the bridge died on its own missing directory:\n${run.stderr}`);
    assert.match(run.stdout, /\[opencode-bridge\] http:\/\//, `the bridge did not listen:\n${run.stdout}${run.stderr}`);
    const token = path.join(run.home, '.config/opencode-bridge/token');
    assert.ok(fs.existsSync(token), 'the token file is created under the config directory the bridge made');
    assert.match(fs.readFileSync(token, 'utf8'), /^[0-9a-f]{48}\n$/, 'the token is the generated secret');
    assert.equal(fs.statSync(token).mode & 0o777, 0o600, 'the token is owner-only');
  });

  // The mirror case (Rule 0J): the directory cannot be made. Before this
  // guard, mkdirSync threw EACCES outside any try — an untyped stack trace
  // before the first log line, the very shape the fresh-HOME fix removed
  // for ENOENT. A HOME the process may not write into halts with exit code 2
  // and names the path and the variable to relocate it. Root ignores
  // directory modes, so under uid 0 this case cannot be produced and is
  // reported as skipped, never as green.
  it('halts with exit 2, naming the directory and the variable, when the config directory cannot be created', {
    skip: typeof process.getuid === 'function' && process.getuid() === 0 && 'root ignores directory modes',
  }, async () => {
    const run = await start((home) => fs.chmodSync(home, 0o500));
    assert.equal(run.code, 2, `the bridge did not halt with exit code 2 (code=${run.code}, signal=${run.signal}):\n${run.stderr}`);
    assert.match(run.stderr, /\[opencode-bridge\] HALT: cannot create .*\.config\/opencode-bridge for TOKEN_FILE=/, `the halt does not name the directory and the variable:\n${run.stderr}`);
    assert.doesNotMatch(run.stderr, /^\s+at /m, `the halt is a stack trace, not a typed message:\n${run.stderr}`);
    assert.doesNotMatch(run.stdout, /\[opencode-bridge\] http:\/\//, 'the bridge did not listen on a HOME it cannot write');
  });
});
