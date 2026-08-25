import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_GUESTS, capitalizeSlug } from './demoGuests.js';

describe('demoGuests', () => {
  it('capitalizes slug for conversation name', () => {
    assert.equal(capitalizeSlug('ivonne'), 'Ivonne');
    assert.equal(capitalizeSlug('IVONNE'), 'Ivonne');
    assert.equal(capitalizeSlug(''), '');
  });

  it('maintains clean empty guest list in production build', () => {
    assert.ok(Array.isArray(DEMO_GUESTS));
    assert.equal(DEMO_GUESTS.length, 0);
  });
});
