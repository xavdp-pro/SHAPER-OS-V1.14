import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor, createGovernorServer } from '../index.js';

// Intent: software/packages/pkg-governor/INTENT.md
//
// The two-names binding (v1.13.24) must survive the HTTP door. A remote
// tandem enrols a maker over HTTP with both names; if the door drops the
// fleetName, every row written for the fleet name is invisible to a maker
// asking under its kernel name — work silently never delivered, the exact
// defect the binding exists to prevent. Found while enrolling the first
// remote maker against a deployed governor, 2026-08-31.

describe('the HTTP door carries both names', () => {
  it('a maker enrolled over HTTP with a fleetName receives fleet-named work', async () => {
    const governor = createGovernor();
    const server = createGovernorServer({ governor, adminToken: 'tandem-secret' });
    await new Promise((r) => server.on('listening', r));
    const url = `http://127.0.0.1:${server.address().port}`;

    try {
      // The tandem enrols the maker THROUGH THE DOOR, both names given.
      const enrolRes = await fetch(`${url}/api/makers/enrol`, {
        method: 'POST',
        headers: { Authorization: 'Bearer tandem-secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'vps-053c1354', fleetName: 'gbs-test' }),
      });
      assert.equal(enrolRes.status, 201);
      const { token } = await enrolRes.json();

      // A row written the way a human or product writes it: the FLEET name.
      governor.desire({
        account: 'A', klass: 'univ-demo-crm', matrix: 'demo-crm-nu',
        digest: 'sha256:aa', machine: 'gbs-test', env: 'demo',
      });

      // The maker asks under the name its kernel gives.
      const pollRes = await fetch(`${url}/api/makers/poll`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'vps-053c1354', version: 't', lanes: 1, inventory: ['sha256:aa'],
        }),
      });
      const out = await pollRes.json();
      assert.equal(out.ok, true);
      assert.equal(
        out.work.length, 1,
        'fleet-named work never reached the kernel-named maker — the door dropped the fleetName',
      );
    } finally {
      server.close();
    }
  });
});
