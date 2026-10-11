import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/_template/INTENT.md#materialise
// Non-regression (Rule 29): until V1.13.2 the template left MAESTRO_QUEUE_URL
// empty by default, so beats went straight to a bridge and no queue job — and
// therefore no audit event carrying a job id — ever existed. One entry point,
// one ledger, BY DEFAULT.
//
// Since the base release (wave 3) the template starts its base units through
// univ-minimal's own podman-up.sh, installed in the universe's base/; Maestro's
// durable store has no direct-to-bridge path at all and refuses to start
// without a Queue address. So the guard follows the code: the template runs
// the base's script, and that script gives Maestro the universe's own Queue,
// with no variable to empty it.

const UNIVERSES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../universes');

describe('Maestro reaches work through the universe\'s Queue, always', () => {
  const template = fs.readFileSync(path.join(UNIVERSES, '_template/deploy/podman-up.sh'), 'utf8');
  const base = fs.readFileSync(path.join(UNIVERSES, 'univ-minimal/deploy/podman-up.sh'), 'utf8');

  it('the template starts its base units with the base\'s own script', () => {
    assert.match(template, /^bash "\$BASE\/deploy\/podman-up\.sh" "\$@"$/m);
    assert.doesNotMatch(template, /MAESTRO_QUEUE_URL|MAESTRO_BRIDGE_URL/, 'the template wires no unit itself');
  });

  it('the base gives Maestro the manifest\'s Queue, and no variable can empty it', () => {
    const maestro = base.match(/^ {4}maestro\)\n([\s\S]*?);;/m);
    assert.ok(maestro, 'univ-minimal declares Maestro\'s runtime wiring');
    assert.match(maestro[1], /"MAESTRO_QUEUE_URL=\$QUEUE_URL"/);
    assert.match(base, /^QUEUE_URL="http:\/\/127\.0\.0\.1:\$\(port_of queue\)"$/m, 'the Queue address is the manifest\'s port, on loopback');
    assert.doesNotMatch(base, /MAESTRO_QUEUE_URL:-|MAESTRO_BRIDGE_URL/, 'no operator default and no direct bridge');
  });
});
