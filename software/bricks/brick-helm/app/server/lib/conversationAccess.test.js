import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveScopedConversationName,
  conversationMatchesScope,
  filterConversationsByScope,
  ensureScopedConversationListed,
} from './conversationAccess.js';

describe('conversationAccess (demo scoping)', () => {
  it('admins are not scoped', () => {
    assert.equal(resolveScopedConversationName({ role: 'admin' }), null);
  });

  it('demo guest resolves preferred conversation first', () => {
    assert.equal(
      resolveScopedConversationName({
        role: 'operator',
        preferredConversation: 'Ivonne',
        demoSlug: 'ivonne',
      }),
      'Ivonne',
    );
  });

  it('demo guest falls back to capitalized slug', () => {
    assert.equal(
      resolveScopedConversationName({ role: 'operator', demoSlug: 'ivonne' }),
      'Ivonne',
    );
  });

  it('matches full path or bare name', () => {
    assert.equal(conversationMatchesScope('gbs-cas0/zaza/Ivonne', 'Ivonne'), true);
    assert.equal(conversationMatchesScope('Ivonne', 'Ivonne'), true);
    assert.equal(conversationMatchesScope('gbs-cas0/zaza/Demo', 'Ivonne'), false);
  });

  it('filters conversations for scoped demo users', () => {
    const all = [
      { path: 'node/zaza/Demo', name: 'Demo' },
      { path: 'node/zaza/Ivonne', name: 'Ivonne' },
    ];
    const scoped = filterConversationsByScope(all, 'Ivonne');
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].name, 'Ivonne');
  });

  it('injects placeholder when bridge has not registered scoped conversation', () => {
    const list = ensureScopedConversationListed([], 'Demo', [{ name: 'cursor', user: 'zaza' }]);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Demo');
    assert.match(list[0].path, /Demo$/);
    assert.equal(list[0].scoped, true);
  });
});
