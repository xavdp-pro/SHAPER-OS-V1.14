import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FREE_MODEL, normalizeConversationName, buildOpencodeSpawnEnv, OpencodeBridgeServer } from '../index.js';

// Intent: software/RULES.md#rule-7

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
