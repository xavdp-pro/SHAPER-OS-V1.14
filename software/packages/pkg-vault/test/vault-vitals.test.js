import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultStore, createVaultServer, VaultClient } from '../index.js';

describe('vault vitals', () => {
  it('publishes evidence and no verdict in envelope', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-vitals-'));
    const storageFile = path.join(tmpDir, 'vault.enc');
    const store = new VaultStore({ masterKey: 'test-master-key-12345678901234567890', storageFile });

    store.setSecret('test-key', { foo: 'bar' });
    const val = store.getSecret('test-key');
    assert.deepEqual(val, { foo: 'bar' });

    const vitals = await store.vitals();
    assert.equal(vitals.service, 'brick-vault');
    assert.equal(typeof vitals.uptimeSeconds, 'number');
    assert.equal(vitals.signals.secretsHeld, 1);
    assert.equal(typeof vitals.signals.lastSuccessfulDecryptAgeSeconds, 'number');
    assert.equal(typeof vitals.signals.lastWriteAgeSeconds, 'number');
    assert.equal(vitals.checks.storage.writable, true);

    for (const forbidden of ['status', 'ok', 'healthy', 'verdict']) {
      assert.equal(forbidden in vitals, false, `the envelope must not expose "${forbidden}"`);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('answers GET /api/vitals on HTTP server', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-vitals-srv-'));
    const storageFile = path.join(tmpDir, 'vault.enc');
    const server = createVaultServer({
      port: 0,
      masterKey: 'test-master-key-12345678901234567890',
      storageFile,
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const client = new VaultClient({ vaultUrl: `http://127.0.0.1:${port}` });

    const vitals = await client.vitals();
    assert.equal(vitals.service, 'brick-vault');
    assert.equal(vitals.signals.secretsHeld, 0);
    assert.equal(vitals.checks.storage.writable, true);

    for (const forbidden of ['status', 'ok', 'healthy', 'verdict']) {
      assert.equal(forbidden in vitals, false);
    }

    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
