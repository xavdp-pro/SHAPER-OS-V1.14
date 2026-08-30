import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/packages/pkg-vault/INTENT.md
// Non-regression (Rule 29): until V1.13.11 the bootstrap accepted the shipped
// example's own template strings as vault keys. A literal `cp` of
// resources/vault-resources.dev.example.json that was never filled in
// encrypted the vault with `<same as .env VAULT_MASTER_KEY>` — the
// documentation itself — published the example's token as the vault's bearer
// token, and exited 0 reporting OK (Muse Code beta, v1.13.7 incident 1).
// Rule 0J: a value the operator never chose must halt, not flow.
// These tests fail on the unpatched script, which exits 0 and materializes the
// vault.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOFTWARE_ROOT = path.resolve(HERE, '../../..');
const SCRIPT = path.join(SOFTWARE_ROOT, 'scripts/bootstrap-vault-from-resources.mjs');
const DEV_EXAMPLE = path.join(SOFTWARE_ROOT, 'resources/vault-resources.dev.example.json');

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-placeholder-')); });
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** Run the bootstrap in isolation: no ambient vault variable may decide the outcome. */
function bootstrap(caseName, { resources, env = {} }) {
  const dir = fs.mkdtempSync(path.join(tmp, `${caseName}-`));
  const resourcesFile = path.join(dir, 'vault-resources.local.json');
  const storageFile = path.join(dir, 'vault', 'vault.enc');
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(resourcesFile, JSON.stringify(resources, null, 2));

  const clean = { ...process.env };
  for (const key of ['VAULT_MASTER_KEY', 'VAULT_TOKEN', 'VAULT_STORAGE_FILE', 'VAULT_RESOURCES_FILE', 'VAULT_ENV_FILE']) {
    delete clean[key];
  }
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: SOFTWARE_ROOT,
    env: {
      ...clean,
      VAULT_RESOURCES_FILE: resourcesFile,
      VAULT_STORAGE_FILE: storageFile,
      VAULT_ENV_FILE: envFile,
      ...env,
    },
    encoding: 'utf8',
  });
  return { ...result, storageFile, envFile };
}

/** Nothing half-done: a halt that already wrote a vault teaches the next run to trust it. */
function assertHalted(run, field) {
  assert.notEqual(run.status, 0, `the bootstrap must refuse this key, it exited 0:\n${run.stdout}`);
  assert.match(run.stderr, /HALT/, 'the halt must be legible, not a silent non-zero exit');
  assert.match(run.stderr, new RegExp(field.replace('.', '\\.')), `the halt must name ${field}`);
  assert.equal(fs.existsSync(run.storageFile), false, 'no vault may be encrypted with a key nobody chose');
  assert.equal(fs.existsSync(run.envFile), false, 'no .env may be written from a key nobody chose');
}

describe('vault bootstrap refuses documentation as a key', () => {
  it('halts on the shipped dev example copied verbatim', () => {
    // The tester's exact gesture: `cp` the example, run the bootstrap, fill nothing.
    const example = JSON.parse(fs.readFileSync(DEV_EXAMPLE, 'utf8'));
    assert.match(example.vault.masterKey, /^<.+>$/, 'the shipped example must still be a template');
    assertHalted(bootstrap('dev-example', { resources: example }), 'vault.masterKey');
  });

  it('halts on a placeholder master key from the resources file', () => {
    assertHalted(bootstrap('resources-master', {
      resources: { vault: { masterKey: 'CHANGEME' }, secrets: { HELLO: 'world' } },
    }), 'vault.masterKey');
  });

  it('halts on a placeholder master key coming from the environment', () => {
    assertHalted(bootstrap('env-master', {
      resources: { vault: {}, secrets: {} },
      env: { VAULT_MASTER_KEY: '<GENERATE_PASSPHRASE_OR_64_HEX>' },
    }), 'vault.masterKey');
  });

  it('halts on a placeholder token, even with a real master key', () => {
    // The example publishes its token: a vault bearing it is a vault with a
    // public password, and the .env would carry it to every brick.
    assertHalted(bootstrap('resources-token', {
      resources: {
        vault: { masterKey: 'a'.repeat(64), token: '<same as .env VAULT_TOKEN>' },
        secrets: {},
      },
    }), 'vault.token');
  });

  it('still bootstraps keys an operator actually chose', () => {
    // The guard refuses templates, not passphrases: a halt on a real key would
    // be the same defect facing the other way.
    const run = bootstrap('real-keys', {
      resources: {
        vault: { masterKey: 'f3a9'.repeat(16), token: 'b7c1'.repeat(6) },
        secrets: { 'secret/demo': { user: 'demo' } },
      },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(run.storageFile), true, 'a chosen key must still materialize the vault');
  });
});
