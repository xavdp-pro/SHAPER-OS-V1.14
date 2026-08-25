import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const softwareRoot = path.resolve(here, '../../..');
const bootstrap = path.join(softwareRoot, 'scripts/bootstrap-vault-from-resources.mjs');

test('zero-secret bootstrap materializes an empty vault file', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-empty-vault-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const storageFile = path.join(temp, 'vault.enc');
  const resourcesFile = path.join(temp, 'resources.json');
  fs.writeFileSync(resourcesFile, JSON.stringify({
    vault: {
      masterKey: 'test-only-master-key',
      token: 'test-only-token',
      storageFile,
    },
    secrets: {},
  }));

  const result = spawnSync(process.execPath, [bootstrap], {
    cwd: softwareRoot,
    env: {
      ...process.env,
      VAULT_RESOURCES_FILE: resourcesFile,
      VAULT_ENV_FILE: path.join(temp, '.env'),
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(storageFile), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(storageFile, 'utf8')), {});
  assert.equal(fs.statSync(storageFile).mode & 0o777, 0o600);
});
