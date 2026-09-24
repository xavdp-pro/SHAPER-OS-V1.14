import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createVaultServer, keyCheckDigest, normalizeMasterKey, storeErrorStatus } from '../index.js';
import { VAULT_SCHEMA_VERSION } from '../mariadb-store.js';

// Intent: software/packages/pkg-vault/INTENT.md#private-mariadb
// Non-regression (Rule 29): the Vault kept its secrets in an encrypted JSON file
// that no functional-unit gate could qualify (Rule 26). These tests hold the
// MariaDB path's contract where no database is needed; the live contract —
// identity, key continuity, restore — is proven by the universe's proof.sh.

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, '../sql/schema.sql'), 'utf8');

describe('the key-check digest proves the key without revealing it', () => {
  it('is stable for one key and different for another', () => {
    const a = keyCheckDigest('a'.repeat(64));
    assert.equal(a, keyCheckDigest('a'.repeat(64)));
    assert.notEqual(a, keyCheckDigest('b'.repeat(64)));
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('is neither the key nor its plain hash', () => {
    const key = 'c'.repeat(64);
    const digest = keyCheckDigest(key);
    assert.notEqual(digest, key);
    assert.notEqual(digest, normalizeMasterKey(key).toString('hex'));
  });
});

describe('the schema belongs to the administrative path', () => {
  it('creates every table idempotently', () => {
    const creates = [...schema.matchAll(/CREATE TABLE\s+(IF NOT EXISTS\s+)?(\w+)/g)];
    assert.ok(creates.length >= 3);
    for (const m of creates) assert.ok(m[1], `${m[2]} is not created IF NOT EXISTS`);
  });

  it('grants nothing and creates no account: that is provisioning, not schema', () => {
    assert.doesNotMatch(schema, /\b(GRANT|CREATE USER|IDENTIFIED)\b/i);
  });

  it('records the version the store requires', () => {
    const m = schema.match(/INSERT INTO schema_meta \(unit, version\) VALUES \('vault', (\d+)\)/);
    assert.ok(m, 'schema_meta row for vault');
    assert.equal(Number(m[1]), VAULT_SCHEMA_VERSION);
  });

  it('never stores the master key: only ciphertext and a key-check digest', () => {
    assert.doesNotMatch(schema, /master_key|plaintext/i);
    assert.match(schema, /key_check\s+CHAR\(64\)/);
  });
});

describe('a storage failure is an unavailable Vault, not a bad request', () => {
  it('maps database errors to 503', () => {
    assert.equal(storeErrorStatus(Object.assign(new Error('x'), { name: 'UnitDbError', code: 'DB_UNAVAILABLE' })), 503);
    for (const code of ['ER_ACCESS_DENIED_ERROR', 'ECONNREFUSED', 'ENOENT', 'PROTOCOL_CONNECTION_LOST']) {
      assert.equal(storeErrorStatus(Object.assign(new Error('x'), { code })), 503, code);
    }
    assert.equal(storeErrorStatus(new Error('plain')), 500);
  });

  it('answers 503 on health and on write when its database is gone', async () => {
    const dbError = Object.assign(new Error('socket gone'), { name: 'UnitDbError', code: 'DB_UNAVAILABLE' });
    const store = {
      storageKind: 'mariadb',
      probe: async () => ({ ok: false, latencyMs: 1, error: 'ECONNREFUSED' }),
      listKeys: async () => { throw dbError; },
      setSecret: async () => { throw dbError; },
      getSecret: async () => { throw dbError; },
      vitals: async () => ({}),
    };
    const server = createVaultServer({ port: 0, host: '127.0.0.1', vaultStore: store });
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const health = await fetch(`${base}/api/health`);
      assert.equal(health.status, 503);
      const write = await fetch(`${base}/api/secret/x`, { method: 'POST', body: JSON.stringify({ data: 'v' }) });
      assert.equal(write.status, 503);
      assert.equal((await write.json()).code, 'DB_UNAVAILABLE');
      const read = await fetch(`${base}/api/secret/x`);
      assert.equal(read.status, 503);
    } finally {
      server.close();
    }
  });
});

describe('the entrypoint never falls back to a file', () => {
  const run = (env) => spawnSync(process.execPath, [path.join(here, '../server.js')], {
    env: { PATH: process.env.PATH, VAULT_MASTER_KEY: 'd'.repeat(64), VAULT_PORT: '0', ...env },
    encoding: 'utf8',
    timeout: 10000,
  });

  it('refuses to start on MariaDB without its passwd file, and says why', () => {
    const r = run({ SHAPER_UNIT_SLUG: 'vault' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: PASSWD_MISSING/);
  });

  it('uses the file store only when asked, with an explicit file', () => {
    const r = run({ VAULT_STORE: 'file' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /VAULT_STORE=file needs an explicit VAULT_STORAGE_FILE/);
  });

  it('refuses an unknown store', () => {
    const r = run({ VAULT_STORE: 'sqlite' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /must be "mariadb" or "file"/);
  });
});
