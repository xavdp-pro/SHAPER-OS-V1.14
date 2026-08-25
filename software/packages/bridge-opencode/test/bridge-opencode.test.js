import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FREE_MODEL, normalizeConversationName, buildOpencodeSpawnEnv, OpencodeBridgeServer } from '../index.js';

describe('bridge-opencode', () => {
  it('uses free default model', () => {
    assert.equal(FREE_MODEL, 'opencode/nemotron-3.5-lightning-free');
  });

  it('normalizes conversation names', () => {
    assert.equal(normalizeConversationName('Mail Contact!'), 'mail-contact');
  });

  it('strips Gemini/Antigravity keys from spawn env', () => {
    const env = buildOpencodeSpawnEnv({
      PATH: '/bin',
      GEMINI_API_KEY: 'AIzaX',
      ANTIGRAVITY_API_KEY: 'AQ.x',
      OPENCODE_MODEL: 'opencode/nemotron-3.5-lightning-free',
    });
    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.ANTIGRAVITY_API_KEY, undefined);
    assert.equal(env.OPENCODE_MODEL, 'opencode/nemotron-3.5-lightning-free');
  });

  it('health reports freeTier in stub mode', async () => {
    const bridge = new OpencodeBridgeServer({ port: 0, stubMode: true });
    const server = bridge.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.stubMode, true);
    assert.equal(body.freeTier, true);
    assert.equal(body.model, FREE_MODEL);
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
