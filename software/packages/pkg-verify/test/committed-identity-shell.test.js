import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as committedIdentity from '../checks/committed-identity.mjs';

// Intent: docs/agent/BOOT-CONTRACT.md#10b-never-commit-what-is-yours-alone

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PUSH_SCRIPT = path.join(REPO, 'software/scripts/push-images-to-registry.sh');

/**
 * The check that guards 10b stayed green over a committed password.
 *
 * Until V1.13 `push-images-to-registry.sh` opened with three shell fallbacks:
 * a registry IP on the mesh, an account, and the account's real password —
 * `REGISTRY_PASS="${REGISTRY_PASS:-<the password>}"`. The committed-identity
 * check knew one spelling of a fallback, `process.env.X || 'y'`, and one
 * family of secret names that stopped at PASSWORD, so a shell script with a
 * `_PASS` variable went through it untouched. The fixture below is that
 * script's opening, with a value of the same shape in place of the password.
 */

let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-identity-shell-'));
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function repo(name, files) {
  const base = path.join(root, name);
  for (const [file, content] of Object.entries(files)) {
    const abs = path.join(base, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return base;
}

describe('committed-identity — a shell fallback is a committed value too', () => {
  it('catches the registry script exactly as it was shipped: an IP, an account, a password', () => {
    const r = repo('registry-as-shipped', {
      'scripts/push-images-to-registry.sh': [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '',
        'REGISTRY="${REGISTRY_HOST:-10.0.0.3:5000}"',
        'REGISTRY_USER="${REGISTRY_USER:-registry}"',
        'REGISTRY_PASS="${REGISTRY_PASS:-Fruitsalad456!}"',
        '',
        'podman login -u "${REGISTRY_USER}" -p "${REGISTRY_PASS}" --tls-verify=false "${REGISTRY}"',
        '',
      ].join('\n'),
    });
    const findings = committedIdentity.run(r);
    assert.equal(findings.length, 3, findings.join('\n'));
    assert.match(findings[0], /REGISTRY_HOST:-10\.0\.0\.3:5000/);
    assert.match(findings[1], /REGISTRY_USER:-registry/);
    assert.match(findings[2], /REGISTRY_PASS:-Fruitsalad456!/);
  });

  it('catches the colon-less spelling, and a password assigned under a _PASS or _PWD name', () => {
    const r = repo('shell-spellings', {
      'deploy.sh': [
        'ADMIN_EMAIL="${ADMIN_EMAIL-someone@acme-client.invalid}"',
        'DB_PWD="s3cretPr0dPass"',
        'REGISTRY_PASS=\'Fruitsalad456!\'',
      ].join('\n'),
    });
    const findings = committedIdentity.run(r);
    assert.equal(findings.length, 3, findings.join('\n'));
  });

  it('leaves alone a fallback to another variable, a halt, a safe default, and a non-identity default', () => {
    const r = repo('shell-quiet', {
      'run.sh': [
        'TOKEN_FILE="${TOKEN_FILE:-$HOME/.config/bridge/token}"',
        'REGISTRY="${REGISTRY_HOST:-${SHAPER_REGISTRY:-}}"',
        ': "${REGISTRY_PASS:?set REGISTRY_PASS — this repository ships none}"',
        'MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"',
        'LOGGER_PORT="${LOGGER_PORT:-8620}"',
        'BYPASS_CACHE="${BYPASS_CACHE:-never}"',
      ].join('\n'),
    });
    assert.deepEqual(committedIdentity.run(r), []);
  });
});

describe('push-images-to-registry.sh — the registry is the operator\'s, never the author\'s', () => {
  const lines = () => fs.readFileSync(PUSH_SCRIPT, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));

  it('carries no fallback for the registry, the account or the password, and halts on each', () => {
    const code = lines().join('\n');
    assert.doesNotMatch(code, /\$\{REGISTRY_HOST:-[^$}]/, 'the registry address used to default to a mesh IP');
    assert.doesNotMatch(code, /\$\{REGISTRY_USER:-/, 'the registry account used to default to a real one');
    assert.doesNotMatch(code, /\$\{REGISTRY_PASS:-/, 'the registry password used to be committed as a fallback');
    assert.match(code, /\$\{REGISTRY:\?/, 'a missing registry must halt and say what to set');
    assert.match(code, /\$\{REGISTRY_USER:\?/, 'a missing account must halt and say what to set');
    assert.match(code, /\$\{REGISTRY_PASS:\?/, 'a missing password must halt and say what to set');
  });

  it('hands the password to podman on stdin, not on the command line', () => {
    const code = lines().join('\n');
    assert.match(code, /podman login[^\n]*--password-stdin/);
    assert.doesNotMatch(code, /podman login[^\n]*\s-p\s/, '`-p <password>` is visible to every process through ps');
  });

  it('derives the brick list from bricks/*/Containerfile instead of naming bricks that left', () => {
    const code = lines().join('\n');
    assert.match(code, /bricks\/\*\/Containerfile/);
    for (const m of code.matchAll(/bricks\/(brick-[a-z0-9-]+)\/Containerfile/g)) {
      assert.ok(fs.existsSync(path.join(REPO, 'software/bricks', m[1], 'Containerfile')),
        `${m[1]} is named by the script but is not in this repository`);
    }
  });
});
