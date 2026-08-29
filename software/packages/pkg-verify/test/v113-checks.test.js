import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as manifestLineage from '../checks/manifest-lineage.mjs';
import * as slugGrammar from '../checks/universe-slug-grammar.mjs';
import * as prodAlerting from '../checks/prod-declares-alerting.mjs';

// Intent: INTENT.md
// The V1.13 checks: Rule 37 lineage fields, the Rule 1 slug grammar, and the
// Rule 27 alerting contract that four of five archetype designs ignored.

let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-v113-'));
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function repo(name, files) {
  const base = path.join(root, name);
  fs.mkdirSync(base, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const abs = path.join(base, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return base;
}

describe('manifest-lineage — Rule 37', () => {
  it('catches the missing perimeter, the unknown source, the testless fork', () => {
    const r = repo('lineage-bad', {
      'manifest.json': {
        bricks: {
          'brick-vault': { source: 'base' },                                   // no perimeter
          'brick-x': { source: 'armory', perimeter: 'P1' },                    // unlegislated enum
          'brick-ged': { source: 'fork', perimeter: 'P2' },                    // fork, no forkedFrom
        },
        bootOrder: [['brick-vault', 'brick-x', 'brick-ged']],
        profile: 'agent',
      },
    });
    const findings = manifestLineage.run(r);
    assert.equal(findings.length, 3, findings.join('\n'));
  });

  it('refuses a known brick relocated to another layer — layer, never owner', () => {
    const r = repo('lineage-relocated', {
      'manifest.json': {
        bricks: { 'brick-vault': { source: 'base', perimeter: 'P3' } },
        bootOrder: [['brick-vault']],
        profile: 'agent',
      },
    });
    assert.match(manifestLineage.run(r)[0], /layer, never owner/);
  });

  it('refuses forkedFrom on a brick that is not a fork, and a shapeless repo lineage', () => {
    const r = repo('lineage-lying', {
      'manifest.json': {
        forkedFrom: { repo: 'univ-boutik-shop' }, // no atTag
        bricks: {
          'brick-scraper': {
            source: 'native', perimeter: 'P3',
            forkedFrom: { package: '@shaper/pkg-pipeline', atVersion: '1.12.0' },
          },
        },
        bootOrder: [['brick-scraper']],
        profile: 'agent',
      },
    });
    const findings = manifestLineage.run(r);
    assert.equal(findings.length, 2, findings.join('\n'));
  });

  it('accepts the four sources correctly declared', () => {
    const r = repo('lineage-good', {
      'manifest.json': {
        bricks: {
          'brick-vault': { source: 'base', perimeter: 'P1' },
          'brick-ged': { source: 'fork', perimeter: 'P2', forkedFrom: { package: '@shaper/pkg-ged-engine', atVersion: '1.12.0' } },
          'brick-qdrant': { source: 'catalogue', perimeter: 'P2' },
          'brick-storefront': { source: 'native', perimeter: 'P3' },
        },
        bootOrder: [['brick-vault'], ['brick-ged', 'brick-qdrant', 'brick-storefront']],
        profile: 'agent +data',
      },
    });
    assert.deepEqual(manifestLineage.run(r), []);
  });
});

describe('universe-slug-grammar — Rule 1', () => {
  it('catches the one-word slug and the missing lineage', () => {
    const r = repo('univ-mailo', { 'README.md': '# mailo' });
    const findings = slugGrammar.run(r);
    assert.equal(findings.length, 2, findings.join('\n'));
    assert.match(findings[0], /-core/);
    assert.match(findings[1], /LINEAGE/);
  });

  it('accepts a well-formed class repo, ignores non-universe repos', () => {
    const ok = repo('univ-mailo-core', { 'LINEAGE.md': '# LINEAGE\nCut from: SHAPER-OS-V1.13 @ v1.13.0' });
    assert.deepEqual(slugGrammar.run(ok), []);
    const base = repo('SHAPER-OS-V9.9', { 'README.md': '# base' });
    assert.deepEqual(slugGrammar.run(base), []);
  });

  it('refuses degenerate hyphen slugs — segments never start or end with one', () => {
    for (const bad of ['univ-badname--', 'univ-x--y', 'univ--core']) {
      const r = repo(bad, { 'LINEAGE.md': 'Cut from: SHAPER-OS-V1.13' });
      assert.equal(slugGrammar.run(r).length, 1, `${bad} should be refused`);
    }
  });

  it('refuses a LINEAGE that never names the base it was cut against', () => {
    const r = repo('univ-mailo-batch', { 'LINEAGE.md': '# LINEAGE\nBecause reasons.' });
    assert.match(slugGrammar.run(r)[0], /never names the base/);
  });
});

describe('prod-declares-alerting — Rule 27', () => {
  it('refuses prod and test universes with no declared channel', () => {
    const r = repo('alert-bad', {
      'a/manifest.json': { environment: 'prod', profile: 'agent', bricks: { 'brick-vault': { source: 'base', perimeter: 'P1' } }, bootOrder: [['brick-vault']] },
      'b/manifest.json': { environment: 'test', profile: 'agent', bricks: { 'brick-vault': { source: 'base', perimeter: 'P1' } }, bootOrder: [['brick-vault']] },
    });
    assert.equal(prodAlerting.run(r).length, 2);
  });

  it('lets dev stay silent, and prod speak', () => {
    const r = repo('alert-good', {
      'dev/manifest.json': { environment: 'dev', profile: 'agent', bricks: { 'brick-vault': { source: 'base', perimeter: 'P1' } }, bootOrder: [['brick-vault']] },
      'prod/manifest.json': { environment: 'prod', profile: 'agent', alerting: { channel: 'mail' }, bricks: { 'brick-vault': { source: 'base', perimeter: 'P1' } }, bootOrder: [['brick-vault']] },
    });
    assert.deepEqual(prodAlerting.run(r), []);
  });
});
