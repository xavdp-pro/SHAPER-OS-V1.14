import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREE_MODEL, ModelUnsetError, normalizeConversationName, buildOpencodeSpawnEnv, OpencodeBridgeServer } from '../index.js';

// Intent: software/RULES.md#rule-7
// Intent: software/packages/pkg-bridge-opencode/INTENT.md#no-default-model

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server.js');

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

describe('bridge-opencode', () => {
  // Non-regression (Rule 29): this test used to assert a model name, and kept
  // passing after that model was withdrawn from the catalogue — a green suite
  // guarding a default that no longer existed.
  it('pins no model name, and takes it from the environment', () => {
    assert.doesNotMatch(
      String(FREE_MODEL),
      /nemotron|deepseek|mimo|claude|gpt|gemini|qwen|llama/i,
      'no model may be named in the source: it expires with its vendor',
    );
  });

  // Non-regression (Rule 29): removing the pinned name left a bridge that still
  // started on an empty model and would have spawned the CLI with `-m ''`. A
  // missing model is a halt that names the variable, not a warning (Rule 0J).
  it('a real bridge refuses to exist without a model, with a typed error', () => {
    assert.throws(
      () => new OpencodeBridgeServer({ port: 0, stubMode: false, defaultModel: '', workspaceBase: os.tmpdir() }),
      (err) => err instanceof ModelUnsetError && err.code === 'BRIDGE_MODEL_UNSET' && /OPENCODE_MODEL/.test(err.message),
    );
  });

  it('server.js halts without a model and names the variable to provide', async () => {
    const run = await startWithoutModel({ BRIDGE_OPENCODE_STUB: '0', OPENCODE_WS_BASE: os.tmpdir() });
    assert.equal(run.signal, null, `server.js was still running after the grace period: it started on a default.\n${run.stdout}`);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /OPENCODE_MODEL/);
    assert.match(run.stderr, /Rule 7/);
  });

  it('normalizes conversation names', () => {
    assert.equal(normalizeConversationName('Mail Contact!'), 'mail-contact');
  });

  it('strips Gemini/Antigravity keys from spawn env', () => {
    const env = buildOpencodeSpawnEnv({
      PATH: '/bin',
      GEMINI_API_KEY: 'AIzaX',
      ANTIGRAVITY_API_KEY: 'AQ.x',
      OPENCODE_MODEL: 'engine/measured-at-deploy',
    });
    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.ANTIGRAVITY_API_KEY, undefined);
    assert.equal(env.OPENCODE_MODEL, 'engine/measured-at-deploy');
  });

  // The simulated bridge says it has no model the same way the three other
  // bridges do: null, never ''. The model is passed explicitly so that the
  // assertion does not depend on whatever OPENCODE_MODEL the shell exported.
  it('the simulated bridge runs without a model and says it has none', () => {
    const bridge = new OpencodeBridgeServer({ port: 0, stubMode: true, defaultModel: '', workspaceBase: os.tmpdir() });
    assert.equal(bridge.defaultModel, null);
  });

  it('health reports freeTier in stub mode', async () => {
    const bridge = new OpencodeBridgeServer({ port: 0, stubMode: true, defaultModel: '', workspaceBase: os.tmpdir() });
    const server = bridge.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.stubMode, true);
    assert.equal(body.freeTier, true);
    assert.equal(body.model, null);
    await new Promise((r) => server.close(r));
  });

  it('inject stub completes', async () => {
    const bridge = new OpencodeBridgeServer({ port: 0, stubMode: true });
    const server = bridge.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: 't1', message: 'hi' }),
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.stub, true);
    await new Promise((r) => setTimeout(r, 30));
    const metrics = await (await fetch(`http://127.0.0.1:${port}/api/metrics`)).json();
    assert.equal(metrics.metrics.completions, 1);
    await new Promise((r) => server.close(r));
  });
});
