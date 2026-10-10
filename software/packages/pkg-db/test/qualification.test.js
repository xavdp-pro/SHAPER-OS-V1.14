import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertDisposableStoreAllowed, qualificationFlags, resolveUnitDbConfig } from '../index.js';

// Intent: software/packages/pkg-db/INTENT.md#dev-scaffolding
// Non-regression: a unit could be started on its JSONL file or in memory, or
// reach MariaDB through MYSQL_PASSWORD, with nothing to stop that artefact
// from being qualified or promoted. DEV scaffolding is now refused whenever
// the run declares itself a qualification or promotion.

describe('a promotion or qualification run is declared by its environment', () => {
  it('names the flags that are set, and nothing for disposable DEV', () => {
    assert.deepEqual(qualificationFlags({}), []);
    assert.deepEqual(qualificationFlags({ SHAPER_QUALIFICATION: '', SHAPER_RUNTIME_MODE: 'development' }), []);
    assert.deepEqual(qualificationFlags({ SHAPER_QUALIFICATION: '0', SHAPER_RUNTIME_MODE: 'dev' }), []);
    assert.deepEqual(qualificationFlags({ SHAPER_QUALIFICATION: '1' }), ['SHAPER_QUALIFICATION=1']);
    for (const mode of ['production', 'test', 'demo']) {
      assert.deepEqual(qualificationFlags({ SHAPER_RUNTIME_MODE: mode }), [`SHAPER_RUNTIME_MODE=${mode}`]);
    }
  });

  it('refuses a DEV store under either flag, with a typed reason naming the flag', () => {
    assert.doesNotThrow(() => assertDisposableStoreAllowed({ unit: 'queue', store: 'file', env: {} }));
    for (const env of [{ SHAPER_QUALIFICATION: 'release-2026-10' }, { SHAPER_RUNTIME_MODE: 'production' }]) {
      assert.throws(() => assertDisposableStoreAllowed({ unit: 'queue', store: 'memory', env }), (err) => err.code === 'DEV_STORE_REFUSED'
        && err.message.includes(Object.keys(env)[0]) && err.message.includes('memory'));
    }
  });

  it('refuses the MYSQL_PASSWORD fallback under a flag, and still allows it for DEV', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-db-qual-'));
    try {
      const dev = resolveUnitDbConfig({ slug: 'queue', appsRoot: root, allowDevFallback: true, env: { MYSQL_PASSWORD: 'dev-only' } });
      assert.equal(dev.passwordSource, 'env-dev-fallback');
      assert.throws(() => resolveUnitDbConfig({
        slug: 'queue', appsRoot: root, allowDevFallback: true, env: { MYSQL_PASSWORD: 'dev-only', SHAPER_QUALIFICATION: '1' },
      }), { code: 'DEV_FALLBACK_REFUSED' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
