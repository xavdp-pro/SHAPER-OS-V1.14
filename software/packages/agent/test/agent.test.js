import test from 'node:test';
import assert from 'node:assert/strict';
import { mailboxToSlug, vaultKeyForMailbox, probeBridgeHealth, buildInjectBody } from '../index.js';

test('agent - mailbox slug and vault key conventions', () => {
  assert.equal(mailboxToSlug('contact@zoutik.example.com'), 'mail-contact-zoutik-example-com');
  assert.equal(mailboxToSlug('xavier@xavdp.pro'), 'mail-xavier-xavdp-pro');
  assert.equal(vaultKeyForMailbox('contact@zoutik.example.com'), 'secret/mail/contact-zoutik-example-com');
});

test('agent - buildInjectBody uses entry params', () => {
  const body = buildInjectBody({
    slug: 'mail-contact-zoutik-example-com',
    mailbox: 'contact@zoutik.example.com',
    contextPath: '/ctx/AGENT-CONTEXT.md',
    beatMessage: 'Check inbox',
  });
  assert.equal(body.conversation, 'mail-contact-zoutik-example-com-beat');
  assert.equal(body.context_file, '/ctx/AGENT-CONTEXT.md');
  assert.equal(body.message, 'Check inbox');
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
