import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapGlobalEvent, withDirectory } from '../api-path.mjs';

test('OpenCode session paths carry the real execution directory', () => {
  const directory = '/srv/universe/work/proof job';
  assert.equal(
    withDirectory('/session', directory),
    '/session?directory=%2Fsrv%2Funiverse%2Fwork%2Fproof%20job',
  );
  assert.equal(
    withDirectory('/session/ses_1/prompt_async', directory),
    '/session/ses_1/prompt_async?directory=%2Fsrv%2Funiverse%2Fwork%2Fproof%20job',
  );
});

test('OpenCode session paths remain unchanged without a directory', () => {
  assert.equal(withDirectory('/session/ses_1', null), '/session/ses_1');
});

test('global OpenCode events expose their nested payload to the translator', () => {
  const payload = { type: 'session.idle', properties: { sessionID: 'ses_1' } };
  assert.equal(unwrapGlobalEvent({ directory: '/work/a', payload }), payload);
  assert.equal(unwrapGlobalEvent(payload), payload);
});
