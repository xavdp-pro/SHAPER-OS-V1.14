import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkMailbox, readCheckpoint, writeCheckpoint } from '../index.js';

test('mail-agent - checkpoint read/write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-cp-'));
  const cp = path.join(dir, 'checkpoint.json');
  writeCheckpoint(cp, { last_unseen: 5 });
  assert.equal(readCheckpoint(cp).last_unseen, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mail-agent - stub check logs and returns new messages on first run', async () => {
  const vaultClient = {
    getSecret: async () => ({
      imap: { host: 'ssl0.ovh.net', port: 993, user: 'test@example.com', pass: 'x', tls: true },
    }),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-stub-'));
  const cp = path.join(dir, 'checkpoint.json');

  const r1 = await checkMailbox({
    vaultClient,
    vaultKey: 'secret/mail/test',
    slug: 'mail-test',
    checkpointPath: cp,
    stubMode: true,
    loggerUrl: null,
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.newMessages, 2);

  const r2 = await checkMailbox({
    vaultClient,
    vaultKey: 'secret/mail/test',
    slug: 'mail-test',
    checkpointPath: cp,
    stubMode: true,
    loggerUrl: null,
  });
  assert.equal(r2.newMessages, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
