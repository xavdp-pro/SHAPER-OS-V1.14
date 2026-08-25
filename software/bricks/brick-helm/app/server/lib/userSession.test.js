import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeConversationName,
  sanitizeDemoSlug,
  suggestConversationBase,
  suggestDemoSlug,
} from './userSession.js';

describe('userSession (demo naming)', () => {
  it('sanitizes conversation names', () => {
    assert.equal(sanitizeConversationName('ivonne'), 'Ivonne');
    assert.equal(sanitizeConversationName('  Demo  '), 'Demo');
    assert.equal(sanitizeConversationName('bad/name'), 'bad-name');
  });

  it('sanitizes demo slugs for ?user= links', () => {
    assert.equal(sanitizeDemoSlug('Ivonne'), 'ivonne');
    assert.equal(sanitizeDemoSlug('  Eve Rauhut '), 'eve-rauhut');
    assert.equal(sanitizeDemoSlug(''), '');
  });

  it('suggests conversation from first name', () => {
    assert.equal(suggestConversationBase({ firstName: 'Ivonne' }), 'Ivonne');
    assert.equal(suggestConversationBase({ slug: 'ivonne' }), 'Ivonne');
  });

  it('suggests demo slug from guest profile', () => {
    assert.equal(suggestDemoSlug({ slug: 'ivonne' }), 'ivonne');
    assert.equal(suggestDemoSlug({ firstName: 'Ivonne' }), 'ivonne');
    assert.equal(suggestDemoSlug({ email: 'ivonne.martin@example.com' }), 'ivonne-martin');
  });
});
