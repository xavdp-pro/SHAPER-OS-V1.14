import test from 'node:test';
import assert from 'node:assert/strict';
import { probeBridgeHealth, buildInjectBody } from '../index.js';

test('agent runtime - buildInjectBody uses generic task params', () => {
  const body = buildInjectBody({
    slug: 'task-mail-triage',
    contextText: 'Use the declared classification rules.',
    instruction: 'Classify the received message.',
  });
  assert.equal(body.conversation, 'task-mail-triage-beat');
  assert.equal(body.context_file, null);
  assert.equal(body.context, 'Use the declared classification rules.');
  assert.equal(body.message, 'Classify the received message.');
});

test('agent - probeBridgeHealth against mock', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true }),
  });
  const health = await probeBridgeHealth('http://127.0.0.1:1/api/health');
  assert.equal(health.ok, true);
  globalThis.fetch = original;
});
