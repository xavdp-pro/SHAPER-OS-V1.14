import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import * as fixShipsTest from '../checks/fix-ships-test.mjs';

// Intent: INTENT.md

let root;
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-r29-'));
  git('init', '-q');
  git('config', 'user.email', 'test@shaper.local');
  git('config', 'user.name', 'shaper-test');
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function commit(subject, files) {
  for (const [file, content] of Object.entries(files)) {
    const abs = path.join(root, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', subject);
}

describe('fix-ships-test — Rule 29', () => {
  it('catches a fix commit that touches code with no test beside it', () => {
    commit('fix: close the bug on "it works now"', { 'lib/engine.js': 'export const x = 1;' });
    const findings = fixShipsTest.run(root);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /no test beside it/);
  });

  it('accepts a fix that ships its non-regression test in the same commit', () => {
    commit('fix: the real way', {
      'lib/engine.js': 'export const x = 2;',
      'test/engine.test.js': 'import assert from "node:assert";',
    });
    // The old offender is still in history; only verify the new commit is clean.
    const findings = fixShipsTest.run(root);
    assert.equal(findings.length, 1, 'only the first, testless fix remains flagged');
  });

  it('leaves docs-and-manifest fixes alone — no code, no test required', () => {
    commit('fix(v1.12): stale version pointers', { 'manifest.json': '{}', 'README.md': '# doc' });
    const before = fixShipsTest.run(root).length;
    assert.equal(before, 1, 'the pointer fix adds no finding');
  });
});
