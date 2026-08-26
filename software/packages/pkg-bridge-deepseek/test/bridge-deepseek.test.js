import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepseekBridgeServer, OLLAMA_DEFAULT_MODEL } from '../index.js';

test('bridge-deepseek - default configuration uses gpt-oss:120b', () => {
  const bridge = new DeepseekBridgeServer({ stubMode: true });
  assert.equal(bridge.model, OLLAMA_DEFAULT_MODEL);
  assert.equal(bridge.model, 'gpt-oss:120b');
});

test('bridge-deepseek - health endpoint reports gpt-oss:120b model', async () => {
  const bridge = new DeepseekBridgeServer({ stubMode: true, apiKey: 'test-key' });
  const server = bridge.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'brick-bridge-deepseek');
  assert.equal(data.model, 'gpt-oss:120b');
  assert.equal(data.hasApiKey, true);

  server.close();
});

test('bridge-deepseek - inject stub execution completes with gpt-oss:120b and perimeter', async () => {
  const bridge = new DeepseekBridgeServer({ stubMode: true });
  const server = bridge.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation: 'dsh-check',
      message: 'Write bash script to backup logs',
      perimeter: '/tmp/test-perimeter',
    })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.conversation, 'dsh-check');
  assert.equal(data.model, 'gpt-oss:120b');
  assert.equal(data.perimeter, '/tmp/test-perimeter');

  server.close();
});
