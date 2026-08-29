import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as mapLinks from '../checks/map-links.mjs';
import * as versionCoherence from '../checks/version-coherence.mjs';
import * as committedIdentity from '../checks/committed-identity.mjs';
import * as profileBootorder from '../checks/profile-bootorder.mjs';

// Each check was born from an incident. Each test rebuilds that incident in a
// fixture and proves the check catches it — and stays quiet on a clean tree.

let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-verify-'));
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

describe('map-links — documentation is a map', () => {
  it('catches the link that points at nothing', () => {
    const r = repo('links-bad', { 'AGENTS.md': 'See [runtime](docs/pkg-agent-runtime/README.md).' });
    const findings = mapLinks.run(r);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /pkg-agent-runtime/);
  });

  it('accepts resolving links, anchors and absolute URLs', () => {
    const r = repo('links-good', {
      'README.md': '[law](LAW.md) · [site](https://example.org) · [here](#anchor) · [law again](LAW.md#top)',
      'LAW.md': '# law',
    });
    assert.deepEqual(mapLinks.run(r), []);
  });

  it('catches the link that climbs out of the repository', () => {
    const r = repo('links-escape', { 'bricks/b/INTENT.md': '[cognition](../../../docs/COGNITION.md)' });
    fs.writeFileSync(path.join(root, 'docs-COGNITION-decoy.md'), 'outside');
    const findings = mapLinks.run(r);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /leaves the repository/);
  });
});

describe('version-coherence — the release names itself once', () => {
  it('catches a manifest pointing at the previous base version', () => {
    const r = repo('SHAPER-OS-BRICKS-V1.12', {
      'package.json': '{"version": "1.11.0"}',
      'universes/u/manifest.json': '{"intent": "SHAPER-OS-V1.11/software/bricks/brick-vault/INTENT.md"}',
    });
    const findings = versionCoherence.run(r);
    assert.equal(findings.length, 2);
    assert.match(findings.join(' '), /package\.json declares 1\.11\.0/);
    assert.match(findings.join(' '), /points at V1\.11/);
  });

  it('accepts a coherent repository, and ignores unversioned repos', () => {
    const ok = repo('SHAPER-OS-V1.12', {
      'package.json': '{"version": "1.12.0"}',
      'manifest.tier-a.json': '{"intent": "SHAPER-OS-V1.12/software/INTENT.md"}',
    });
    assert.deepEqual(versionCoherence.run(ok), []);
    const univ = repo('univ-client-acme', { 'manifest.json': '{"intent": "SHAPER-OS-V1.11/x"}' });
    assert.deepEqual(versionCoherence.run(univ), []);
  });
});

describe('committed-identity — never commit what is yours alone', () => {
  it('catches a tracked .env, an identity fallback, a committed credential', () => {
    const r = repo('identity-bad', {
      '.env': 'API_KEY=sk-live-1234567890',
      // A .invalid host: fictional for the repo's own domain-agnosticism guard,
      // yet still an identity fallback this check must catch.
      'server.js': "const host = process.env.PUBLIC_HOST || 'shop.acme-client.invalid';",
      'auth.js': "const secret = process.env.JWT_SECRET || 'helm-dev-secret';",
      'deploy.sh': 'MARIADB_PASSWORD="s3cretPr0dPass"',
    });
    const findings = committedIdentity.run(r);
    assert.equal(findings.length, 4, findings.join('\n'));
  });

  it('accepts placeholders, localhost fallbacks, env examples and vault reads', () => {
    const r = repo('identity-good', {
      '.env.example': 'API_KEY=<your-key>',
      'server.js': "const host = process.env.HOST || 'localhost'; const p = process.env.DB_PASSWORD;",
      'config.js': "const token = process.env.TOKEN || '<placeholder>';",
    });
    assert.deepEqual(committedIdentity.run(r), []);
  });

  it('stays quiet on configuration defaults, i18n labels and test helpers', () => {
    const r = repo('identity-config', {
      'server.js': "const port = process.env.LOGGER_PORT || '8520'; const model = process.env.GED_LLM_MODEL || 'nemotron-3-nano:30b';",
      'locale.js': "export default { 'auth.password': 'Mot de passe', 'auth.password.short': 'Contraseña' };",
      'e2e/login.js': "const u = process.env.E2E_USER || 'admin';",
      'guard.js': "const pw = process.env.HELM_E2E_PASSWORD || 'set-HELM_E2E_PASSWORD';",
    });
    assert.deepEqual(committedIdentity.run(r), []);
  });
});

describe('profile-bootorder — a named profile, an explicit start order', () => {
  it('catches the unnamed profile and the brick outside bootOrder', () => {
    const r = repo('profile-bad', {
      'manifest.json': JSON.stringify({
        bricks: { 'brick-vault': {}, 'brick-logger': {} },
        bootOrder: [['brick-vault'], ['brick-ghost']],
      }),
    });
    const findings = profileBootorder.run(r);
    assert.equal(findings.length, 3, findings.join('\n')); // no profile, logger unordered, ghost unknown
  });

  it('accepts a manifest with a known profile covering every brick', () => {
    const r = repo('profile-good', {
      'manifest.json': JSON.stringify({
        profile: 'agent +web +public',
        bricks: { 'brick-vault': {}, 'brick-helm': {} },
        bootOrder: [['brick-vault'], ['brick-helm']],
      }),
    });
    assert.deepEqual(profileBootorder.run(r), []);
  });

  it('rejects a profile outside the defined vocabulary', () => {
    const r = repo('profile-vocab', {
      'manifest.json': JSON.stringify({
        profile: 'turbo +everything',
        bricks: { 'brick-vault': {} },
        bootOrder: [['brick-vault']],
      }),
    });
    assert.match(profileBootorder.run(r)[0], /not in the defined vocabulary/);
  });
});
