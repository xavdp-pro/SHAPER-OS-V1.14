import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADOPTED_DIGEST, createGovernor, createGovernorServer } from '../index.js';
import { defaultRecipeRunner, startMaker } from '../../../universes/_maker-template/poller.mjs';

// Intent: software/packages/pkg-governor/INTENT.md#an-adopted-row-creates-nothing
// Intent: software/universes/_maker-template/INTENT.md#adopt
//
// Decided 2 September 2026 (B6 and G7 of the maker-and-governor verdict),
// before any frozen tenant was written to a ledger. "The idempotence was
// designed for exactly this" had been claimed of adopting containers that
// already exist: write a row, let the stamp find them, report "already
// exists". It could not: the stamp's idempotence is keyed by row id (its
// instance name derives from the row, never from a name the row carries),
// its "already exists" is only ever its own replay, it launches what it
// does not find and exec's inside — and the governor withheld every stamp
// whose digest the maker had not declared, which a container born of no
// matrix never is. A frozen tenant written as DESIRED was offered a stamp
// withheld forever, or born a second time beside the original. Adoption is
// a fourth kind of work: it looks, it binds, it creates nothing.

const SCHEMA = { 'univ-demo-vpn': { instance: { type: 'string', unique: true } } };
const ROW = { account: 'tenant-a', klass: 'univ-demo-vpn', matrix: 'none', digest: ADOPTED_DIGEST, machine: 'gbs-test', env: 'demo' };

const waitFor = async (predicate, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
};

/** Two stub recipes: an adopt that looks and reports, and a stamp that
 *  leaves a mark if it is ever run — the mark is what must not exist. */
function recipes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-recipes-'));
  const created = path.join(dir, 'CREATED');
  fs.writeFileSync(path.join(dir, 'lxd-adopt.sh'), `#!/usr/bin/env bash
# Looks at the named instance, binds, reports. Never launches, never execs.
printf '{"instance":"%s","state":"RUNNING","legacy":true,"argc":%s}\\n' "$SHAPER_PARAM_INSTANCE" "$#"
`);
  fs.writeFileSync(path.join(dir, 'lxd-stamp.sh'), `#!/usr/bin/env bash
touch ${JSON.stringify(created)}
printf '{"state":"RUNNING"}\\n'
`);
  return { dir, created };
}

describe('an adopted row creates nothing', () => {
  it('an adopted row creates nothing', async () => {
    const governor = createGovernor({ paramsSchema: SCHEMA });
    const server = createGovernorServer({ governor, adminToken: 'tandem-secret' });
    await new Promise((r) => server.on('listening', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const { token } = governor.enrolMaker({ host: 'gbs-test' });
    const { dir, created: mark } = recipes();
    let maker = null;
    try {
      // A row for a container that already exists, named through the slot.
      const nameless = governor.desire(ROW);
      assert.equal(nameless.refused, true, 'an adopted row with no instance name is a row for nothing');
      assert.match(nameless.reason, /params\.instance/);
      const { row, created } = governor.desire({ ...ROW, params: { instance: 'legacy-a' } });
      assert.equal(created, true);

      // The maker holds no matrix at all, and is offered the adoption anyway:
      // the inventory vouches for bytes, and this container was born of none.
      const first = governor.poll({ token, host: 'gbs-test', inventory: [] });
      assert.deepEqual(first.work.map((w) => w.kind), ['adopt'],
        'the row was offered a stamp (or nothing) — an adoption is not gated by the inventory');
      assert.deepEqual(first.preload, [], `a preload of "${ADOPTED_DIGEST}" was ordered — no matrix exists to preload`);
      assert.equal(first.work[0].params.instance, 'legacy-a');

      maker = startMaker({
        governorUrl: url, token, host: 'gbs-test', intervalMs: 50,
        inventory: () => [],
        runRecipe: defaultRecipeRunner({ recipesDir: dir, hostKind: 'lxd' }),
        log: () => {},
      });
      await waitFor(() => governor.getRow(row.id).state === 'PURRING', 5000);
      maker.stop();

      assert.equal(governor.getRow(row.id).state, 'PURRING');
      const events = governor.getRow(row.id).events;
      assert.deepEqual(events.map((e) => e.event), ['ADOPTING', 'ADOPTED'],
        'an adoption announces itself and reports under its own name');
      const adopted = events.at(-1).data;
      assert.equal(adopted.legacy, true, 'the fact that this instance was born outside the ledger must ride the event');
      assert.equal(adopted.instance, 'legacy-a', 'the recipe read the name from SHAPER_PARAM_INSTANCE');
      assert.equal(adopted.argc, 6, 'the six positions, and the name on the environment — never a seventh argv');
      assert.equal(fs.existsSync(mark), false, 'the stamp recipe ran: something was created for a row that adopts');
      assert.equal(governor.referencedDigests().has(ADOPTED_DIGEST), false,
        `"${ADOPTED_DIGEST}" is counted as a matrix a live row references`);
      // A second row may not adopt the same container.
      const twin = governor.desire({ ...ROW, account: 'tenant-a-bis', params: { instance: 'legacy-a' } });
      assert.equal(twin.refused, true);
      assert.equal(twin.row.id, row.id);
    } finally {
      // A failed assertion must not leave the door open: a listening server
      // keeps the process alive and a red test becomes a hung suite.
      maker?.stop();
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an adoption is a fact too: a container not running, or not admitted legacy, never purrs', () => {
    const g = createGovernor({ paramsSchema: SCHEMA });
    const { token } = g.enrolMaker({ host: 'gbs-test' });
    const { row: stopped } = g.desire({ ...ROW, params: { instance: 'legacy-a2' } });
    g.report({ token, rowId: stopped.id, event: 'ADOPTED', data: { instance: 'legacy-a2', state: 'STOPPED', legacy: true } });
    assert.equal(g.getRow(stopped.id).state, 'DEGRADED', 'a stopped container was taken for an adoption');
    assert.deepEqual(g.getRow(stopped.id).events.at(-1).unmet, ['state']);

    const { row: mute } = g.desire({ ...ROW, account: 'tenant-b', params: { instance: 'legacy-b' } });
    const out = g.report({ token, rowId: mute.id, event: 'ADOPTED', data: { instance: 'legacy-b', state: 'RUNNING' } });
    assert.equal(g.getRow(mute.id).state, 'DEGRADED', 'an ADOPTED that never admitted legacy purred');
    assert.deepEqual(out.unmet, ['legacy']);

    const { row: bound } = g.desire({ ...ROW, account: 'tenant-c', params: { instance: 'legacy-c' } });
    g.report({ token, rowId: bound.id, event: 'ADOPT_FAILED', data: { error: 'no such container' } });
    assert.equal(g.getRow(bound.id).state, 'DEGRADED');
  });
});
