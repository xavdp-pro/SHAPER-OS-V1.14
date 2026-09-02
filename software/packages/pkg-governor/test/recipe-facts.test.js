import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
// Intent: software/universes/_maker-template/INTENT.md
import path from 'node:path';
import { defaultRecipeRunner } from '../../../universes/_maker-template/poller.mjs';

describe('the runner reads facts from the recipe', () => {
  it('parses the last stdout line as the event data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-'));
    fs.writeFileSync(path.join(dir, 'lxd-stamp.sh'),
      '#!/bin/bash\necho prose ignored\necho \'{"instance":"i","checks":true}\'\n');
    const run = defaultRecipeRunner({ recipesDir: dir, hostKind: 'lxd' });
    const facts = await run({ kind: 'stamp', rowId: 'r', klass: 'k', matrix: 'm', digest: 'd', account: 'a', env: 'demo' });
    assert.deepEqual(facts, { instance: 'i', checks: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps unparseable output as an audit tail, never a crash', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-'));
    fs.writeFileSync(path.join(dir, 'lxd-reap.sh'), '#!/bin/bash\necho just words\n');
    const run = defaultRecipeRunner({ recipesDir: dir, hostKind: 'lxd' });
    const facts = await run({ kind: 'reap', rowId: 'r', klass: 'k', matrix: 'm', digest: 'd', account: 'a', env: 'demo' });
    assert.match(facts.stdout, /just words/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('a birth is proven by facts, an end by its exit code', () => {
  // Intent: software/universes/_maker-template/INTENT.md
  it('an unreadable stamp result is a failure, not a birth', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-'));
    // A stamp that exits 0 and ends in prose: it used to be reported STAMPED.
    fs.writeFileSync(path.join(dir, 'lxd-stamp.sh'), '#!/bin/bash\necho launched, probably\n');
    const run = defaultRecipeRunner({ recipesDir: dir, hostKind: 'lxd' });
    await assert.rejects(
      () => run({ kind: 'stamp', rowId: 'r', klass: 'k', matrix: 'm', digest: 'd', account: 'a', env: 'demo' }),
      /without a line of facts.*launched, probably/s,
      'a stamp without facts must be a failure the maker reports as STAMP_FAILED',
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
