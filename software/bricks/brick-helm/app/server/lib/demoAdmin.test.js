import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { DEMO_ADMIN, canManageDemoVoices, canAccessDemoBriefingAdmin } from './demoAdmin.js';

describe('demoAdmin', () => {
  it('is operator, not admin', () => {
    assert.equal(DEMO_ADMIN.role, 'operator');
    assert.notEqual(DEMO_ADMIN.role, 'admin');
  });

  it('allows demo operator to manage voices on demo host', () => {
    const user = {
      email: DEMO_ADMIN.email,
      role: 'operator',
      status: 'active',
    };
    assert.equal(canManageDemoVoices(user), config.isDemo);
  });

  it('blocks demo guests from voice admin', () => {
    assert.equal(
      canManageDemoVoices({
        email: 'ivonne@demo.local',
        role: 'operator',
        status: 'active',
      }),
      false,
    );
  });

  it('allows demo guests to edit own briefing on demo host', () => {
    assert.equal(
      canAccessDemoBriefingAdmin({
        email: 'ivonne@demo.local',
        role: 'operator',
        status: 'active',
        demoSlug: 'ivonne',
      }),
      config.isDemo,
    );
    assert.equal(
      canAccessDemoBriefingAdmin({
        email: 'ivonne@demo.local',
        role: 'operator',
        status: 'active',
      }),
      false,
    );
  });

  it('allows demo operator briefing admin', () => {
    assert.equal(
      canAccessDemoBriefingAdmin({
        email: DEMO_ADMIN.email,
        role: 'operator',
        status: 'active',
      }),
      config.isDemo,
    );
  });

  it('allows full admin everywhere', () => {
    assert.equal(
      canManageDemoVoices({ email: 'xavier@xavdp.pro', role: 'admin', status: 'active' }),
      true,
    );
  });

  it('uses dedicated bridge conversation', () => {
    assert.equal(DEMO_ADMIN.conversation, 'Demo');
  });

  it('briefing mentions KovZu and Zephir', () => {
    assert.match(DEMO_ADMIN.briefing, /KovZu/i);
    assert.match(DEMO_ADMIN.briefing, /Zephir/i);
  });
});
