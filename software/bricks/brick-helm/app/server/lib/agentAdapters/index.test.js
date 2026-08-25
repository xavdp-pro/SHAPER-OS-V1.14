import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAgentAdapter } from './index.js';

describe('agentAdapters', () => {
  it('resolves cursor adapter', () => {
    const a = getAgentAdapter('cursor');
    assert.equal(a.kind, 'cursor');
    assert.equal(a.capabilities.stopRun, true);
    assert.equal(a.capabilities.modelField, 'composer');
  });

  it('resolves claude adapter by kind prefix', () => {
    const a = getAgentAdapter('claude');
    assert.equal(a.capabilities.stopRun, false);
    assert.equal(a.capabilities.modelField, 'litellm');
  });

  it('claude reset uses delete endpoint', async () => {
    const calls = [];
    const apiFetch = async (_target, path, opts) => {
      calls.push({ path, body: JSON.parse(opts.body) });
      return { ok: true };
    };
    await getAgentAdapter('claude').resetSession({
      target: { url: 'http://x' },
      conversationName: 'Interface',
      apiFetch,
    });
    assert.equal(calls[0].path, '/api/conversations/delete');
    assert.equal(calls[0].body.conversation, 'Interface');
  });

  it('cursor reset uses reset endpoint', async () => {
    const calls = [];
    const apiFetch = async (_target, path) => {
      calls.push(path);
      return { ok: true };
    };
    await getAgentAdapter('cursor').resetSession({
      target: { url: 'http://x' },
      conversationName: 'NOW3',
      apiFetch,
    });
    assert.deepEqual(calls, ['/api/conversations/reset']);
  });

  it('generic reset falls back to delete on 404', async () => {
    const calls = [];
    const apiFetch = async (_target, path) => {
      calls.push(path);
      if (path.includes('reset')) {
        const err = new Error('not found');
        err.status = 404;
        throw err;
      }
      return { ok: true };
    };
    await getAgentAdapter('generic').resetSession({
      target: { url: 'http://x' },
      conversationName: 'X',
      apiFetch,
    });
    assert.deepEqual(calls, ['/api/conversations/reset', '/api/conversations/delete']);
  });
});
