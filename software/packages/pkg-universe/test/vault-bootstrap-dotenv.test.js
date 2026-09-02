import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: README.md#quick-start
// Intent: software/packages/pkg-vault/INTENT.md
// Non-regression (Rule 29): the Quick start said `cp .env.example software/.env`
// then `npm run vault:bootstrap`, and the second command halted on
// "VAULT_MASTER_KEY is required" with the key sitting in the file the first
// command had just created. Nothing loaded software/.env — the script read
// process.env only, and the repository ships no dotenv (Rule 5). Found by the
// 2 September cold audit. The bootstrap now reads the file as DEFAULTS, with a
// grammar narrow enough to refuse prose, and the operator's export wins over
// it (V1.13.5 precedence). Three of the four bootstrap cases fail on the
// unpatched script; the shell-wins case is the invariant and passes on both.
// The fifth case reads the suite itself: it fails while any test lets the
// bootstrap write software/.env.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOFTWARE = path.resolve(HERE, '../../..');
const SCRIPT = path.join(SOFTWARE, 'scripts/bootstrap-vault-from-resources.mjs');
const { VaultStore } = await import(path.join(SOFTWARE, 'packages/pkg-vault/index.js'));

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dotenv-')); });
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** Runs the bootstrap against a fixture .env; no ambient vault variable may decide the outcome. */
function bootstrap(caseName, { envLines, env = {}, secrets = {} }) {
  const dir = fs.mkdtempSync(path.join(tmp, `${caseName}-`));
  const envFile = path.join(dir, '.env');
  const storageFile = path.join(dir, 'vault', 'vault.enc');
  const resourcesFile = path.join(dir, 'resources.json');
  fs.writeFileSync(envFile, envLines.join('\n') + '\n');
  fs.writeFileSync(resourcesFile, JSON.stringify({ vault: {}, secrets }));

  const clean = { ...process.env };
  for (const key of ['VAULT_MASTER_KEY', 'VAULT_TOKEN', 'VAULT_STORAGE_FILE', 'VAULT_RESOURCES_FILE', 'VAULT_ENV_FILE']) {
    delete clean[key];
  }
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: SOFTWARE,
    env: { ...clean, VAULT_ENV_FILE: envFile, VAULT_RESOURCES_FILE: resourcesFile, VAULT_STORAGE_FILE: storageFile, ...env },
    encoding: 'utf8',
  });
  return { ...result, envFile, storageFile };
}

describe('the vault bootstrap reads software/.env, and the shell wins over it', () => {
  it('takes VAULT_MASTER_KEY from the .env the Quick start just created', () => {
    // The literal gesture: the example copied, the keys injected, nothing exported.
    const run = bootstrap('from-file', {
      envLines: ['# SHAPER OS — never commit the real file', '', `VAULT_MASTER_KEY=${'c4'.repeat(32)}`, `VAULT_TOKEN=${'9e'.repeat(24)}`, 'VAULT_PORT=8610'],
      secrets: { HELLO: 'world' },
    });
    assert.equal(run.status, 0, `the bootstrap must read the file the docs told the operator to create:\n${run.stderr}`);
    assert.ok(fs.existsSync(run.storageFile), 'the vault must be materialised from the file key');
  });

  it('lets an exported VAULT_MASTER_KEY beat the one in the file', () => {
    const run = bootstrap('shell-wins', {
      envLines: [`VAULT_MASTER_KEY=${'aa'.repeat(32)}`, `VAULT_TOKEN=${'9e'.repeat(24)}`],
      env: { VAULT_MASTER_KEY: 'bb'.repeat(32) },
      secrets: { HELLO: 'world' },
    });
    assert.equal(run.status, 0, run.stderr);
    // Only the key that actually encrypted the vault can read it back.
    const store = new VaultStore({ masterKey: 'bb'.repeat(32), storageFile: run.storageFile });
    assert.equal(store.getSecret('HELLO'), 'world', 'the exported key must be the one that encrypted the vault');
  });

  it('halts on a line that is not KEY=value, naming the line, and writes nothing', () => {
    const run = bootstrap('prose', {
      envLines: [`VAULT_MASTER_KEY=${'c4'.repeat(32)}`, 'please paste the token below', 'VAULT_TOKEN='],
    });
    assert.notEqual(run.status, 0, `a line the parser cannot read must halt, it exited 0:\n${run.stdout}`);
    assert.match(run.stderr, /HALT/, 'the halt must be legible, not a silent non-zero exit');
    assert.match(run.stderr, /\.env:2\b/, 'the halt must name the line number');
    assert.match(run.stderr, /please paste the token below/, 'the halt must quote the line');
    assert.equal(fs.existsSync(run.storageFile), false, 'nothing may be written from a file that was not fully read');
  });

  it('is never spawned by a test without VAULT_ENV_FILE — npm test must not write software/.env', () => {
    // The bootstrap creates software/.env when it is absent (vault pointers).
    // A test that spawns it without pointing VAULT_ENV_FILE elsewhere leaves a
    // .env in the source tree carrying that test's dummy master key — which
    // deploy/podman-up.sh then sources as the operator's defaults. Found on
    // 2 September as "residue after npm test"; the residue was the suite's own.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.name.endsWith('.test.js') && absolute !== fileURLToPath(import.meta.url)) {
          const text = fs.readFileSync(absolute, 'utf8');
          if (text.includes('bootstrap-vault-from-resources') && !text.includes('VAULT_ENV_FILE')) offenders.push(path.relative(SOFTWARE, absolute));
        }
      }
    };
    walk(path.join(SOFTWARE, 'packages'));
    assert.deepEqual(offenders, [], `tests that let the bootstrap write software/.env:\n  ${offenders.join('\n  ')}`);
  });

  it('says where a refused placeholder came from when it came from the file', () => {
    const run = bootstrap('origin', {
      envLines: ['VAULT_MASTER_KEY=<GENERATE_PASSPHRASE_OR_64_HEX>'],
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, new RegExp(`VAULT_MASTER_KEY in ${run.envFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      'a halt that blames "the environment" for a key read from .env sends the operator to the wrong place');
  });
});
