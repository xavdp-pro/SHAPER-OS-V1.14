import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#registry-contract
// Non-regression (Rule 29): the build's "already published?" probe used to
// write `http${SHAPER_TLS_VERIFY:+s}://`, which tests whether the variable is
// SET, not what it says. The runbook's own `export SHAPER_TLS_VERIFY=false`
// — the plain-HTTP registry — therefore probed over https, and a TLS registry
// with the variable unset was probed over http; both failed silently inside
// `curl -sf … >/dev/null` and every brick was rebuilt on every run. Found by
// the 2 September audit. The scheme now follows the VALUE, the same posture
// `podman pull --tls-verify` is given. Both tests fail on the unpatched scripts.

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LADDER = path.join(SOFTWARE, 'scripts/deploy-image-resolve.sh');
const BUILD = path.join(SOFTWARE, 'scripts/build-all-bricks.sh');

/** Sources the real ladder and asks it for the registry URL under one TLS posture. */
function urlUnder(tlsVerify) {
  const env = { ...process.env, SHAPER_REGISTRY: 'registry.invalid:5000' };
  delete env.SHAPER_TLS_VERIFY;
  if (tlsVerify !== undefined) env.SHAPER_TLS_VERIFY = tlsVerify;
  return execFileSync('bash', ['-c', `set -euo pipefail; source "${LADDER}"; shaper_registry_url`], { env, encoding: 'utf8' }).trim();
}

describe('the registry scheme follows the value of SHAPER_TLS_VERIFY, not its presence', () => {
  it('SHAPER_TLS_VERIFY=false — the runbook\'s plain-HTTP case — probes over http', () => {
    assert.equal(urlUnder('false'), 'http://registry.invalid:5000');
  });

  it('unset, or true, probes over https — the posture podman pull is given', () => {
    assert.equal(urlUnder(undefined), 'https://registry.invalid:5000');
    assert.equal(urlUnder('true'), 'https://registry.invalid:5000');
  });

  it('the build probe uses that function and no longer tests presence', () => {
    const text = fs.readFileSync(BUILD, 'utf8');
    assert.doesNotMatch(text, /\$\{SHAPER_TLS_VERIFY:\+/, 'a `:+` expansion chooses the scheme by presence, which is the defect');
    assert.match(text, /shaper_registry_url/, 'the probe must take its scheme from the shared ladder');
  });
});
