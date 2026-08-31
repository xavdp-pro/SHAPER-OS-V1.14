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
      runRecipe: async (work) => { ran.push(work); return { note: 'stamped in test' }; },
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
      runRecipe: async (work) => { received = work.account; return {}; },
      log: () => {},
    });
    await waitFor(() => received !== null);
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
