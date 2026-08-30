import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/packages/pkg-queue/INTENT.md#2-universal-invariants-parameterized
// Non-regression (Rule 29): until H9 the template's live round-trip posted an
// `agent-sync` job that nothing ever dispatched (auto-dispatch handles
// `agent.inject`) and left it PENDING in the ledger forever. A proof that
// manufactures drift is not a proof. This test fails on the unpatched live test.

const LIVE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../universes/_template/test/socle-live.test.js',
);

function roundTripSource(src) {
  const start = src.indexOf('queue job round-trip');
  assert.ok(start >= 0, 'the live suite must contain the queue job round-trip');
  const next = src.indexOf("test('", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

describe('the live test leaves every job it creates in a terminal state', () => {
  const src = fs.readFileSync(LIVE, 'utf8');
  const roundTrip = roundTripSource(src);

  it('posts a job — that is the round-trip', () => {
    assert.match(roundTrip, /\/api\/jobs/, 'the round-trip must POST a job');
  });

  it('then PATCHes that job to COMPLETED or FAILED — auto-dispatch will not', () => {
    assert.match(
      roundTrip,
      /method:\s*['"]PATCH['"]/,
      'a posted job that nothing dispatches stays PENDING unless the test closes it',
    );
    assert.match(
      roundTrip,
      /status:\s*['"](?:COMPLETED|FAILED)['"]/,
      'the PATCH must be a terminal status, not RUNNING',
    );
  });
});
