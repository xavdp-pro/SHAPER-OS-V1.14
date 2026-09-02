import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as mapLinks from '../checks/map-links.mjs';
import * as versionCoherence from '../checks/version-coherence.mjs';
import * as committedIdentity from '../checks/committed-identity.mjs';
import * as profileBootorder from '../checks/profile-bootorder.mjs';

// Intent: software/packages/pkg-verify/INTENT.md#what-it-checks-today
//
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
      'software/packages/pkg-a/package.json': '{"version": "1.12.0"}',
      'software/universes/_template/manifest.json': '{"version": "1.12.0", "universe": "univ-example"}',
      'software/node_modules/dep/package.json': '{"version": "0.0.1"}',
    });
    assert.deepEqual(versionCoherence.run(ok), []);
    const univ = repo('univ-client-acme', { 'manifest.json': '{"intent": "SHAPER-OS-V1.11/x"}' });
    assert.deepEqual(versionCoherence.run(univ), []);
  });

  // Non-regression (Rule 29): the check read the root package.json alone, and
  // accepted any version under the folder's prefix. Sixteen other package.json
  // and the template's were never opened, so one package could say 1.13.23
  // beside the root's 1.13.2, and the template's package.json could still say
  // 1.7.0 in a V1.13 tree, while verify reported the release named itself once.
  it('catches a package or a manifest whose version differs from the root', () => {
    const r = repo('SHAPER-OS-V1.13', {
      'package.json': '{"version": "1.13.2"}',
      'software/package.json': '{"version": "1.13.2"}',
      'software/packages/pkg-a/package.json': '{"version": "1.13.23"}',
      'software/universes/_template/package.json': '{"version": "1.7.0"}',
      'software/universes/_template/manifest.json': '{"version": "1.12.0", "universe": "univ-example"}',
      'software/universes/univ-x/manifest.json': '{"universe": "univ-x"}',
      'software/node_modules/dep/package.json': '{"version": "0.0.1"}',
    });
    const findings = versionCoherence.run(r);
    assert.equal(findings.length, 3, findings.join('\n'));
    const text = findings.join('\n');
    assert.match(text, /software\/packages\/pkg-a\/package\.json declares 1\.13\.23, the root package\.json declares 1\.13\.2/);
    assert.match(text, /software\/universes\/_template\/package\.json declares 1\.7\.0/);
    assert.match(text, /software\/universes\/_template\/manifest\.json declares 1\.12\.0/);
    assert.doesNotMatch(text, /node_modules/, 'a dependency is not the release');
  });

  // Non-regression (Rule 29): the extended check walked the working tree, so
  // a universe an operator copies from the template into `universes/univ-<slug>`
  // (what the clean-sheet guide prescribes) was judged as if the repository
  // shipped it, and verify went red on every operator's machine over a
  // package.json the repository does not deliver (beta finding F12). The
  // check now reads what git tracks.
  it('judges the tracked tree, not an operator\'s untracked universe copy', () => {
    const r = repo('tracked/SHAPER-OS-V1.13', {
      'package.json': '{"version": "1.13.2"}',
      'software/packages/pkg-a/package.json': '{"version": "1.13.2"}',
      'software/universes/_template/manifest.json': '{"intent": "SHAPER-OS-V1.13/software/INTENT.md"}',
      'software/universes/univ-acme-dev/package.json': '{"version": "1.7.0"}',
      'software/universes/univ-acme-dev/manifest.json': '{"version": "1.7.0", "intent": "SHAPER-OS-V1.11/software/INTENT.md"}',
    });
    const git = (...args) => execFileSync('git', ['-C', r, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('add', 'package.json', 'software/packages/pkg-a/package.json', 'software/universes/_template/manifest.json');
    assert.deepEqual(versionCoherence.run(r), []);
    // And a tracked divergence in the same tree is still reported, alone.
    fs.mkdirSync(path.join(r, 'software/packages/pkg-b'), { recursive: true });
    fs.writeFileSync(path.join(r, 'software/packages/pkg-b/package.json'), '{"version": "1.13.23"}');
    git('add', 'software/packages/pkg-b/package.json');
    const findings = versionCoherence.run(r);
    assert.equal(findings.length, 1, findings.join('\n'));
    assert.match(findings[0], /software\/packages\/pkg-b\/package\.json declares 1\.13\.23, the root package\.json declares 1\.13\.2/);
  });

  // Non-regression (Rule 29): a package.json that does not parse used to end
  // verify on a stack trace (verify.mjs runs each check without a net) instead
  // of a finding that names the file — an exit, but not a halt that speaks (0J).
  it('names a package.json or a manifest that is not valid JSON, instead of throwing', () => {
    const r = repo('badjson/SHAPER-OS-V1.13', {
      'package.json': '{"version": "1.13.2"}',
      'software/universes/univ-bad-dev/package.json': '{ not json',
      'software/universes/univ-bad-dev/manifest.json': '{ "version": ',
    });
    let findings;
    assert.doesNotThrow(() => { findings = versionCoherence.run(r); });
    assert.equal(findings.length, 2, findings.join('\n'));
    assert.match(findings[0], /software\/universes\/univ-bad-dev\/package\.json is not valid JSON/);
    assert.match(findings[1], /software\/universes\/univ-bad-dev\/manifest\.json is not valid JSON/);
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
      'server.js': "const port = process.env.LOGGER_PORT || '8620'; const model = process.env.GED_LLM_MODEL || 'nemotron-3-nano:30b';",
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
