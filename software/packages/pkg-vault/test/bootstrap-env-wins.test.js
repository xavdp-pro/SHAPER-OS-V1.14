import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/packages/pkg-vault/INTENT.md
// Non-regression (Rule 29): until V1.13.1 the resources file silently overrode
// VAULT_STORAGE_FILE, so every universe on a host wrote into ONE shared
// vault.enc (beta finding F9). An explicit env choice must always win over the
// packaged default. This test fails on the unpatched script.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../../../scripts/bootstrap-vault-from-resources.mjs');

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-precedence-')); });
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('vault bootstrap precedence', () => {
  it('an explicit VAULT_STORAGE_FILE beats the resources file', () => {
    const resources = path.join(tmp, 'resources.json');
    const decoyStore = path.join(tmp, 'decoy', 'vault.enc');
    const chosenStore = path.join(tmp, 'mine', 'vault.enc');
    fs.writeFileSync(resources, JSON.stringify({
      vault: { storageFile: decoyStore },
      secrets: { HELLO: 'world' },
    }));

    execFileSync('node', [SCRIPT], {
      env: {
        ...process.env,
        VAULT_MASTER_KEY: 'a'.repeat(64),
        VAULT_RESOURCES_FILE: resources,
        VAULT_STORAGE_FILE: chosenStore,
      },
      stdio: 'pipe',
    });

    assert.ok(fs.existsSync(chosenStore), 'the vault must land where the env said');
    assert.ok(!fs.existsSync(decoyStore), 'the resources path must NOT be written when env chose another');
  });
});
