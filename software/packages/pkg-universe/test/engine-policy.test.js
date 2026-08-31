import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkManifestInvariants, loadManifest, loadSchema, validateManifest } from '../index.js';

// Intent: software/RULES.md#rule-7
//
// Born from an operator ruling after the first production deployment: the
// most performant engine is sometimes cheap and sometimes not, so a single
// hard-coded "cheapest wins" encodes an arbitration the law has no right to
// make. Rule 7 now runs on two cursors: the contract eliminates, dominance
// eliminates, and the universe DECLARES its cursor. This test holds the
// declaration's grammar: the three policies pass, anything else is refused.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const schema = loadSchema();
const sound = loadManifest(path.join(REPO, 'software/universes/univ-base/manifest.json')).manifest;

test('the three declared cursors pass: frugal, swift, and an operator ceiling', () => {
  for (const policy of ['frugal', 'swift', { budgetPerTask: 0.25 }]) {
    const m = structuredClone(sound);
    m.enginePolicy = policy;
    const { valid, errors } = validateManifest(m, schema);
    assert.equal(valid, true, `enginePolicy ${JSON.stringify(policy)} must pass:\n${(errors || []).join('\n')}`);
    assert.deepEqual(checkManifestInvariants(m).filter((e) => e.includes('enginePolicy')), [],
      `the invariants must accept ${JSON.stringify(policy)}`);
  }
});

test('a policy the law does not name is refused — no hidden fourth cursor', () => {
  for (const policy of ['cheapest', 'balanced', { budgetPerTask: 0 }, { budgetPerTask: -1 }, { budget: 3 }, 7]) {
    const m = structuredClone(sound);
    m.enginePolicy = policy;
    const refusedBySchema = validateManifest(m, schema).valid === false;
    const refusedByInvariant = checkManifestInvariants(m).some((e) => e.includes('enginePolicy'));
    assert.equal(refusedBySchema || refusedByInvariant, true,
      `enginePolicy ${JSON.stringify(policy)} must be refused by the schema or the invariants`);
  }
});

test('absent means frugal: a manifest without the field still passes', () => {
  const m = structuredClone(sound);
  assert.equal(validateManifest(m, schema).valid, true);
  assert.deepEqual(checkManifestInvariants(m).filter((e) => e.includes('enginePolicy')), []);
});
