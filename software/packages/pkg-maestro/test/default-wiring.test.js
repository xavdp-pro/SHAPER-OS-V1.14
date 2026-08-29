import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/univ-base/INTENT.md#proof
// Non-regression (Rule 29): until V1.13.2 the template left MAESTRO_QUEUE_URL
// empty by default, so beats went straight to a bridge and no queue job — and
// therefore no audit event carrying a job id — ever existed. The runbook's own
// proof #4 was then satisfiable only on hand-wired deployments: a V1.13.1
// re-test reached it only after setting the variable itself. One entry point,
// one ledger, BY DEFAULT. This test fails on the unpatched template.

const TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../universes/_template/deploy/podman-up.sh',
);

describe('the template wires maestro to the queue by default', () => {
  const script = fs.readFileSync(TEMPLATE, 'utf8');

  it('gives MAESTRO_QUEUE_URL a non-empty default pointing at the queue', () => {
    const line = script.split('\n').find((l) => l.includes('export MAESTRO_QUEUE_URL='));
    assert.ok(line, 'the template must export MAESTRO_QUEUE_URL');
    assert.doesNotMatch(
      line,
      /MAESTRO_QUEUE_URL:-\s*"?\s*}/,
      'an empty default means beats bypass the queue and the audit trail has no job id to carry',
    );
    assert.match(line, /QUEUE_PORT/, 'the default must resolve to this universe\'s queue');
  });

  it('still lets an operator opt out explicitly', () => {
    const line = script.split('\n').find((l) => l.includes('export MAESTRO_QUEUE_URL='));
    assert.match(line, /\$\{MAESTRO_QUEUE_URL:-/, 'an env value must still win over the default');
  });
});
