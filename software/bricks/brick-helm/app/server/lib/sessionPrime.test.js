import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSessionPrimeMessage } from './sessionPrime.js';

describe('buildSessionPrimeMessage slim bootstrap', () => {
  it('omits inline briefing and skills when contextPath is set', () => {
    const out = buildSessionPrimeMessage({
      briefing: 'SECRET BRIEFING LINE',
      firstName: 'Xavier',
      locale: 'fr',
      contextPath: '/apps/ws/Demo/_kovzu/CONTEXT.md',
    });
    assert.match(out, /CONTEXT\.md/);
    assert.doesNotMatch(out, /SECRET BRIEFING LINE/);
    assert.doesNotMatch(out, /PLAYBOOK MULTIMÉDIA/i);
    assert.match(out, /salutation|Xavier/i);
  });

  it('keeps inline briefing when no contextPath', () => {
    const out = buildSessionPrimeMessage({
      briefing: 'SECRET BRIEFING LINE',
      locale: 'fr',
      contextPath: '',
    });
    assert.match(out, /SECRET BRIEFING LINE/);
    assert.match(out, /Skills/i);
  });
});
