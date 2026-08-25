import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  demoNotifyEnabled,
  demoNotifyTo,
  buildDemoNotifySubject,
} from './demoNotifyMail.js';

describe('demoNotifyMail', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.DEMO_NOTIFY = '1';
  });

  afterEach(() => {
    process.env = envBackup;
  });

  it('is disabled without SMTP credentials', () => {
    assert.equal(demoNotifyEnabled(), false);
  });

  it('is disabled when DEMO_NOTIFY=0', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    process.env.DEMO_NOTIFY = '0';
    assert.equal(demoNotifyEnabled(), false);
  });

  it('defaults notify recipient', () => {
    assert.equal(demoNotifyTo(), 'admin@example.com');
  });

  it('builds agent-demo subject line', () => {
    const subject = buildDemoNotifySubject({
      kind: 'request',
      lang: 'fr',
      conversation: 'Ivonne',
      host: '${SHAPER_PUBLIC_HOST}',
    });
    assert.equal(subject, '[demo ${SHAPER_PUBLIC_HOST}] request · fr · Ivonne');
  });
});
