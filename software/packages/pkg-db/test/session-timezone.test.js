import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { verifyIdentity } from '../pool.js';

// Intent: software/packages/pkg-db/INTENT.md#2-invariants
// (invariant 8: every session speaks UTC)
// Non-regression: sessions inherited the server's time zone. Vault compares a
// bootstrap expiry through UNIX_TIMESTAMP(DATETIME) and stores credential
// expiry with FROM_UNIXTIME, so on a server whose zone was ahead of UTC every
// issuance was refused (found by the live test on a +02:00 workstation). The
// live proof is pkg-vault/test/evidence-outbox.live.mjs, on a +05:00 server.

describe('a unit session reads and writes instants in UTC', () => {
  const pool = (tz) => ({ query: async () => [[{ who: 'queue@localhost', db: 'queue', tz }]] });

  it('accepts the pinned UTC session', async () => {
    await verifyIdentity(pool('+00:00'), 'queue');
  });

  it('refuses a session left in another time zone, where UNIX_TIMESTAMP and FROM_UNIXTIME would shift instants', async () => {
    await assert.rejects(verifyIdentity(pool('SYSTEM'), 'queue'), { code: 'SESSION_TIMEZONE' });
    await assert.rejects(verifyIdentity(pool('+05:00'), 'queue'), { code: 'SESSION_TIMEZONE' });
  });

  it('pins the session on every new pool connection', () => {
    const source = fs.readFileSync(new URL('../pool.js', import.meta.url), 'utf8');
    assert.match(source, /pool\.on\('connection', \(connection\) => \{/);
    assert.ok(source.includes(`connection.query("SET time_zone = '+00:00'", (err) => { if (err) connection.destroy(); });`),
      'a connection that cannot be pinned is destroyed, never used');
  });
});
