import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { interpretAgyVerdict } from '../agy-verdict.js';

describe('interpretAgyVerdict', () => {
  it('accepts SUCCESS from agy JSON', () => {
    const v = interpretAgyVerdict(JSON.stringify({ status: 'SUCCESS', usage: { total_tokens: 100 } }));
    assert.equal(v.ok, true);
    assert.equal(v.status, 'SUCCESS');
  });

  it('treats artifact-path ERROR as success when the agent produced a substantive response', () => {
    const v = interpretAgyVerdict(JSON.stringify({
      status: 'ERROR',
      error: 'invalid tool call error (invalid_args) /repo/foo.md is not a valid artifact path; artifacts must be in /home/.gemini/antigravity-cli/brain/uuid/',
      response: 'x'.repeat(100),
      usage: { total_tokens: 50 },
    }));
    assert.equal(v.ok, true);
    assert.equal(v.status, 'SUCCESS_WITH_ARTIFACT_WARN');
  });

  it('keeps ERROR when artifact failed without substantive output', () => {
    const v = interpretAgyVerdict(JSON.stringify({
      status: 'ERROR',
      error: 'not a valid artifact path',
      response: 'short',
    }));
    assert.equal(v.ok, false);
    assert.equal(v.status, 'ERROR');
  });
});
