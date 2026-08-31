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
