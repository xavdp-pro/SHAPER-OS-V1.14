import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGovernor, createGovernorServer } from '../index.js';
import { startMaker } from '../../../universes/_maker-template/poller.mjs';

// Intent: software/universes/_maker-template/INTENT.md
//
// The maker against a real governor over real HTTP — asynchronously, because
// this process hosts the governor the maker talks to, and a synchronous wait
// would deadlock the loop that serves it (the lesson is written in the
// queue's own meta-test).

async function liveGovernor() {
  const governor = createGovernor();
  const server = createGovernorServer({ governor, adminToken: 'tandem-secret' });
  await new Promise((r) => server.on('listening', r));
  const { port } = server.address();
  return { governor, server, url: `http://127.0.0.1:${port}` };
}

const waitFor = async (predicate, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
};

describe('the maker asks, stamps, reports — and listens on nothing', () => {
  it('reconciles a desired row into PURRING through the real HTTP contract', async () => {
    const { governor, server, url } = await liveGovernor();
    const { token } = governor.enrolMaker({ host: 'test-host' });
    const { row } = governor.desire({
      account: 'a1', klass: 'univ-demo-crm', matrix: 'crm',
      digest: 'sha256:aa', machine: 'test-host',
    });
    const ran = [];
    const maker = startMaker({
      governorUrl: url, token, host: 'test-host', lanes: 1, intervalMs: 50,
      inventory: () => ['sha256:aa'],
      // The recipe's facts: a birth is one only if the container runs.
      runRecipe: async (work) => { ran.push(work); return { state: 'RUNNING', note: 'stamped in test' }; },
      log: () => {},
    });
    await waitFor(() => governor.getRow(row.id).state === 'PURRING');
    maker.stop();
    server.close();
    assert.equal(governor.getRow(row.id).state, 'PURRING');
    assert.equal(ran.length, 1);
    assert.equal(ran[0].kind, 'stamp');
    const events = governor.getRow(row.id).events.map((e) => e.event);
    assert.deepEqual(events, ['STAMPING', 'STAMPED'],
      'the maker must announce before it acts and report after');
  });

  it('a failing recipe becomes STAMP_FAILED and DEGRADED — reported, never improvised around', async () => {
    const { governor, server, url } = await liveGovernor();
    const { token } = governor.enrolMaker({ host: 'test-host' });
    const { row } = governor.desire({
      account: 'a1', klass: 'univ-demo-crm', matrix: 'crm',
      digest: 'sha256:aa', machine: 'test-host',
    });
    const maker = startMaker({
      governorUrl: url, token, host: 'test-host', intervalMs: 50,
      inventory: () => ['sha256:aa'],
      runRecipe: async () => { throw new Error('image import refused'); },
      log: () => {},
    });
    await waitFor(() => governor.getRow(row.id).state === 'DEGRADED');
    maker.stop();
    server.close();
    assert.equal(governor.getRow(row.id).state, 'DEGRADED');
    assert.match(governor.getRow(row.id).events.at(-1).data.error, /image import refused/);
  });

  it('form data reaches the recipe as argv, byte for byte — never through a shell', async () => {
    const { governor, server, url } = await liveGovernor();
    const { token } = governor.enrolMaker({ host: 'test-host' });
    const hostile = 'Léa & Fils; rm -rf / #';
    const { row } = governor.desire({
      account: hostile, klass: 'univ-demo-crm', matrix: 'crm',
      digest: 'sha256:aa', machine: 'test-host',
    });
    let received = null;
    const maker = startMaker({
      governorUrl: url, token, host: 'test-host', intervalMs: 50,
      inventory: () => ['sha256:aa'],
      runRecipe: async (work) => { received = work.account; return { state: 'RUNNING' }; },
      log: () => {},
    });
    // Wait for the row to purr, not merely for the recipe to be called: the
    // STAMPED report is still in flight at that moment, and asserting PURRING
    // right after the call raced it — a loss under the full suite's load.
    await waitFor(() => governor.getRow(row.id).state === 'PURRING');
    maker.stop();
    server.close();
    assert.equal(received, hostile,
      'the hostile string must arrive intact as data — mangled means something interpreted it');
    assert.equal(governor.getRow(row.id).state, 'PURRING');
  });

  it('the poller opens no server: the file contains no listen and no createServer', () => {
    const src = fs.readFileSync(new URL('../../../universes/_maker-template/poller.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /createServer|\.listen\(/,
      'what holds power has no inbound door — a listening maker breaks the doctrine');
  });
});

describe('a refusal is not a failure', () => {
  // Intent: software/packages/pkg-governor/INTENT.md#deadlines-are-desired-state
  it('the maker reports a recipe\'s exit 4 as REAP_REFUSED, never as REAP_FAILED', async () => {
    const { governor, server, url } = await liveGovernor();
    const { token } = governor.enrolMaker({ host: 'test-host' });
    const { row } = governor.desire({
      account: 'a1', klass: 'univ-demo-crm', matrix: 'crm',
      digest: 'sha256:aa', machine: 'test-host', env: 'prod',
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
    });
    governor.report({ token, rowId: row.id, event: 'STAMPED', data: { state: 'RUNNING' } });
    let runs = 0;
    const maker = startMaker({
      governorUrl: url, token, host: 'test-host', intervalMs: 50,
      inventory: () => ['sha256:aa'],
      // What execFile throws when lxd-reap.sh exits 4: a production
      // universe, and a robot does not end one.
      runRecipe: async () => {
        runs += 1;
        const err = new Error('Command failed: bash lxd-reap.sh\n[lxd-reap] inst-x is a production universe');
        err.code = 4;
        throw err;
      },
      log: () => {},
    });
    await waitFor(() => governor.getRow(row.id).state === 'DEGRADED');
    // A few more beats: a refused reap used to be offered again at each one.
    await new Promise((r) => setTimeout(r, 300));
    maker.stop();
    server.close();
    const events = governor.getRow(row.id).events.map((e) => e.event);
    assert.deepEqual(events.slice(-2), ['REAPING', 'REAP_REFUSED'],
      'exit 4 must reach the ledger under its own name');
    assert.equal(governor.getRow(row.id).events.at(-1).data.exitCode, 4);
    assert.equal(runs, 1, `the refused reap ran ${runs} times — the storm is back`);
  });
});
