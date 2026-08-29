import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkManifestInvariants } from '../index.js';

// Intent: software/RULES.md#rule-37
// Non-regression (Rule 29): the schema states fork→forkedFrom as JSON-Schema
// if/then, which the subset validator silently ignores — so until this
// invariant existed, a fork with no origin passed the whole validation suite.

const base = (brick) => ({
  bricks: { 'brick-ged': { image: 'img-ged', package: '@shaper/pkg-ged-engine', ...brick } },
  bootOrder: [['brick-ged']],
});

describe('Rule 37 — fork lineage invariant', () => {
  it('refuses a fork with no forkedFrom', () => {
    const errors = checkManifestInvariants(base({ source: 'fork', perimeter: 'P2' }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /origin is unknown/);
  });

  it('refuses forkedFrom on a brick that is not a fork', () => {
    const errors = checkManifestInvariants(base({
      source: 'catalogue', perimeter: 'P2',
      forkedFrom: { package: '@shaper/pkg-ged-engine', atVersion: '1.12.0' },
    }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /one of the two is lying/);
  });

  it('accepts a fork that states its origin', () => {
    const errors = checkManifestInvariants(base({
      source: 'fork', perimeter: 'P2',
      forkedFrom: { package: '@shaper/pkg-ged-engine', atVersion: '1.12.0' },
    }));
    assert.deepEqual(errors, []);
  });
});
