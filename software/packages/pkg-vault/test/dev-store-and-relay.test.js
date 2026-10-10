import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { evidenceRelaySettings } from '../evidence-runtime.js';
import { secretEvidence, secretRef } from '../mariadb-store.js';

// Intent: software/packages/pkg-vault/INTENT.md#evidence-relay
// Database-free: the entrypoint's refusals and the evidence shape. The
// transaction, rollback and drain are proven live (evidence-outbox.live.mjs).

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '../server.js');

describe('the encrypted file store is refused under a promotion or qualification flag', () => {
  for (const flag of [{ SHAPER_QUALIFICATION: '1' }, { SHAPER_RUNTIME_MODE: 'production' }]) {
    it(`VAULT_STORE=file with ${Object.keys(flag)[0]}`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dev-'));
      try {
        const r = spawnSync(process.execPath, [SERVER], {
          env: { PATH: process.env.PATH, VAULT_PORT: '0', VAULT_STORE: 'file', VAULT_STORAGE_FILE: path.join(dir, 'v.json'),
            VAULT_MASTER_KEY: 'd'.repeat(64), ...flag },
          encoding: 'utf8', timeout: 10000,
        });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /refusing to start: DEV_STORE_REFUSED/);
        assert.equal(fs.existsSync(path.join(dir, 'v.json')), false, 'nothing was created');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe('Vault evidence names a secret, never its value', () => {
  it('uses the key as a public reference, or its digest when the key itself looks like a credential', () => {
    assert.equal(secretRef('mailbox/ops'), 'mailbox/ops');
    assert.match(secretRef('password=hunter2'), /^sha256:[0-9a-f]{64}$/);
    const { eventId, entry } = secretEvidence('SECRET_STORED', 'mailbox/ops', { created: true });
    assert.equal(entry.executionId, eventId, 'a stable execution id the strict relay requires');
    assert.deepEqual(entry, { pod: 'vault', event: 'SECRET_STORED', level: 'INFO', executionId: eventId, data: { secretRef: 'mailbox/ops', created: true } });
  });
});

describe('the relay refuses to start without what delivery needs', () => {
  it('requires a plain Logger URL and the Vault unit', () => {
    assert.throws(() => evidenceRelaySettings({}), { code: 'VAULT_LOGGER_ENDPOINT_REQUIRED' });
    for (const url of ['file:///tmp/logger', 'http://user:secret@127.0.0.1:8620', 'http://127.0.0.1:8620/?token=x', 'http://127.0.0.1:8620/other']) {
      assert.throws(() => evidenceRelaySettings({ LOGGER_URL: url }), { code: 'VAULT_LOGGER_ENDPOINT_INVALID' }, url);
    }
    assert.throws(() => evidenceRelaySettings({ LOGGER_URL: 'http://127.0.0.1:8620', SHAPER_UNIT_SLUG: 'queue' }), { code: 'VAULT_RELAY_IDENTITY_REQUIRED' });
    assert.equal(evidenceRelaySettings({ LOGGER_URL: 'http://127.0.0.1:8620' }).loggerUrl, 'http://127.0.0.1:8620/');
  });
});
