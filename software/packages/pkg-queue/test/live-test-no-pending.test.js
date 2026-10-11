import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/packages/pkg-queue/INTENT.md#2-universal-invariants-parameterized
// Non-regression (Rule 29): until H9 the template's live round-trip posted an
// `agent-sync` job that nothing ever dispatched and left it PENDING in the
// ledger forever. A proof that manufactures drift is not a proof.
//
// Since the base release (wave 3) Queue accepts nothing but a minimal health
// without a Vault-signed credential, and the template's live test is a smoke
// test from outside: it creates nothing. Every write it attempts is anonymous
// and must be refused — so it can leave no job, PENDING or otherwise.

const LIVE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../universes/_template/test/socle-live.test.js',
);

describe('the live test leaves no job behind', () => {
  const src = fs.readFileSync(LIVE, 'utf8');

  it('sends no credential, so nothing it posts can be accepted', () => {
    assert.doesNotMatch(src, /Authorization|Bearer|bootstrap|X-Vault-Token/i);
  });

  it('expects every write it attempts on Queue to be refused (401)', () => {
    const queueTest = src.slice(src.indexOf('Queue refuses'), src.indexOf("test('", src.indexOf('Queue refuses') + 1));
    assert.match(queueTest, /\/api\/jobs`, \{\s*method: 'POST'/, 'it attempts an enqueue');
    const writes = (src.match(/method: 'POST'/g) || []).length;
    const refusals = (src.match(/\.status, 401\)/g) || []).length;
    assert.ok(refusals >= writes, `${writes} write(s), ${refusals} refusal(s) expected`);
    assert.doesNotMatch(src, /method:\s*['"](PATCH|PUT|DELETE)['"]/, 'no job to settle: none was created');
  });
});
