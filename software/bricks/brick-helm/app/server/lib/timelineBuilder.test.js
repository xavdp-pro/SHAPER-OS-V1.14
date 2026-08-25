import test from 'node:test';
import assert from 'node:assert/strict';
import {
  writeHumanTurn,
  writeResendTurn,
  writePrimeRun,
  writeTurnFailure,
  linkBridgeRun,
  applyBridgeEventToStore,
  invalidateTimelineCache,
} from './timelineBuilder.js';
import { loadTimeline, purgeTimeline } from './timelineStore.js';
import { getPool } from './db.js';

async function cleanup(convPath) {
  invalidateTimelineCache(convPath);
  try { await purgeTimeline(convPath); } catch { /* DB absent */ }
}

let counter = 0;
function freshPath(name) {
  counter += 1;
  // No Date.now() dependency — a stable counter keeps runs reproducible.
  return `test-node/test-user/${name}-${counter}`;
}

test('writeHumanTurn stores human + pending run with provided ids', async (t) => {
  const conv = freshPath('turn');
  await cleanup(conv);
  t.after(() => cleanup(conv));

  const items = await writeHumanTurn(conv, {
    text: 'Bonjour', humanId: 'h1', runId: 'r1', images: [],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'human');
  assert.equal(items[0].id, 'h1');
  assert.equal(items[0].text, 'Bonjour');
  assert.equal(items[1].type, 'run');
  assert.equal(items[1].id, 'r1');
  assert.equal(items[1].status, 'running');

  const stored = await loadTimeline(conv);
  assert.equal(stored.items.length, 2, 'turn persisted immediately');
});

test('bridge events fill the run and response_complete finalizes it', async (t) => {
  const conv = freshPath('stream');
  await cleanup(conv);
  t.after(() => cleanup(conv));

  await writeHumanTurn(conv, { text: 'Question', humanId: 'h1', runId: 'r1' });
  linkBridgeRun(conv, 'bridge-run-A');

  await applyBridgeEventToStore(conv, {
    type: 'response', run_id: 'bridge-run-A', seq: 0, delta: 'Réponse ', text: 'Réponse ',
  });
  await applyBridgeEventToStore(conv, {
    type: 'response', run_id: 'bridge-run-A', seq: 1, delta: 'complète', text: 'Réponse complète',
  });
  await applyBridgeEventToStore(conv, {
    type: 'response_complete', run_id: 'bridge-run-A', seq: 2, text: 'Réponse complète',
  });

  const { items } = await loadTimeline(conv);
  const run = items.find((it) => it.type === 'run');
  assert.equal(run.status, 'done');
  const assistant = run.blocks.find((b) => b.type === 'assistant');
  assert.equal(assistant.text, 'Réponse complète');
  assert.equal(assistant.streaming, false);
});

test('events from a stale run are dropped after a new turn starts', async (t) => {
  const conv = freshPath('stale');
  await cleanup(conv);
  t.after(() => cleanup(conv));

  await writeHumanTurn(conv, { text: 'Premier', humanId: 'h1', runId: 'r1' });
  linkBridgeRun(conv, 'bridge-A');
  await applyBridgeEventToStore(conv, {
    type: 'response_complete', run_id: 'bridge-A', seq: 5, text: 'ok premier',
  });

  await writeHumanTurn(conv, { text: 'Deuxième', humanId: 'h2', runId: 'r2' });
  linkBridgeRun(conv, 'bridge-B');

  // Late delta from the dead first run must not pollute the second run.
  await applyBridgeEventToStore(conv, {
    type: 'response', run_id: 'bridge-A', seq: 6, delta: 'fantôme', text: 'ok premierfantôme',
  });
  await applyBridgeEventToStore(conv, {
    type: 'response_complete', run_id: 'bridge-B', seq: 0, text: 'ok deuxième',
  });

  const { items } = await loadTimeline(conv);
  const runs = items.filter((it) => it.type === 'run');
  assert.equal(runs.length, 2);
  const second = runs[1];
  const assistant = second.blocks.find((b) => b.type === 'assistant');
  assert.equal(assistant.text, 'ok deuxième');
  assert.ok(!JSON.stringify(items).includes('fantôme'), 'stale delta dropped');
});

test('run_aborted (replaced) from the old run never aborts the new pending turn', async (t) => {
  const conv = freshPath('replaced');
  await cleanup(conv);
  t.after(() => cleanup(conv));

  await writeHumanTurn(conv, { text: 'Premier', humanId: 'h1', runId: 'r1' });
  linkBridgeRun(conv, 'bridge-A');

  // User sends again while A is still running: turn written, then bridge kills A.
  await writeHumanTurn(conv, { text: 'Deuxième', humanId: 'h2', runId: 'r2' });
  await applyBridgeEventToStore(conv, {
    type: 'run_aborted', run_id: 'bridge-A', reason: 'replaced',
  });

  const { items } = await loadTimeline(conv);
  const r2 = items.find((it) => it.type === 'run' && it.id === 'r2');
  assert.equal(r2.status, 'running', 'new pending run untouched');
  const r1 = items.find((it) => it.type === 'run' && it.id === 'r1');
  assert.equal(r1.status, 'aborted', 'old run aborted');
});

test('events without run_id (legacy bridge) still apply', async (t) => {
  const conv = freshPath('legacy');
  await cleanup(conv);
  t.after(() => cleanup(conv));

  await writeHumanTurn(conv, { text: 'Salut', humanId: 'h1', runId: 'r1' });
  await applyBridgeEventToStore(conv, { type: 'response', delta: 'Bonjour', text: 'Bonjour' });
  await applyBridgeEventToStore(conv, { type: 'response_complete', text: 'Bonjour' });

  const { items } = await loadTimeline(conv);
  const run = items.find((it) => it.type === 'run');
  assert.equal(run.status, 'done');
  assert.equal(run.blocks.find((b) => b.type === 'assistant').text, 'Bonjour');
});

test('voice turn: ack sits between human and run, run flagged voiceTurn', async (t) => {
  const conv = freshPath('voice');
  await cleanup(conv);
  t.after(() => cleanup(conv));

  const items = await writeHumanTurn(conv, {
    text: 'Montre les mails', humanId: 'h1', runId: 'r1', voiceTurn: true, ackText: 'Je regarde ça.',
  });
  assert.deepEqual(items.map((it) => it.type), ['human', 'voice_ack', 'run']);
  assert.equal(items[1].text, 'Je regarde ça.');
  assert.equal(items[2].voiceTurn, true);
});

test('writeResendTurn truncates at the human and rebuilds context', async (t) => {
  const conv = freshPath('resend');
  await cleanup(conv);
  t.after(() => cleanup(conv));

  await writeHumanTurn(conv, { text: 'Premier', humanId: 'h1', runId: 'r1' });
  linkBridgeRun(conv, 'bridge-A');
  await applyBridgeEventToStore(conv, {
    type: 'response_complete', run_id: 'bridge-A', text: 'Réponse un',
  });
  await writeHumanTurn(conv, { text: 'Deuxième', humanId: 'h2', runId: 'r2' });
  linkBridgeRun(conv, 'bridge-B');
  await applyBridgeEventToStore(conv, {
    type: 'response_complete', run_id: 'bridge-B', text: 'Réponse deux',
  });

  const prepared = await writeResendTurn(conv, { humanId: 'h2', text: 'Deuxième corrigé', runId: 'r3' });
  assert.ok(prepared.ok);
  assert.ok(prepared.hadContext, 'context prefix built from first exchange');
  assert.ok(prepared.injectText.includes('Premier'));
  assert.ok(prepared.injectText.includes('Deuxième corrigé'));

  const { items } = await loadTimeline(conv);
  const humans = items.filter((it) => it.type === 'human');
  assert.equal(humans.length, 2);
  assert.equal(humans[1].text, 'Deuxième corrigé');
  const lastRun = items[items.length - 1];
  assert.equal(lastRun.type, 'run');
  assert.equal(lastRun.id, 'r3');
  assert.equal(lastRun.status, 'running');
});

test('writePrimeRun stores a running presentation run', async (t) => {
  const conv = freshPath('prime');
  await cleanup(conv);
  t.after(() => cleanup(conv));

  await writePrimeRun(conv, { runId: 'prime-1' });
  const { items } = await loadTimeline(conv);
  assert.equal(items.length, 1);
  assert.equal(items[0].prime, true);
  assert.equal(items[0].status, 'running');

  linkBridgeRun(conv, 'bridge-P');
  await applyBridgeEventToStore(conv, {
    type: 'response_complete', run_id: 'bridge-P', text: 'Bonjour, je suis Zephir.',
  });
  const after = (await loadTimeline(conv)).items;
  assert.equal(after[0].status, 'done');
  assert.equal(after[0].prime, true, 'prime flag preserved');
});

test('writeTurnFailure aborts the pending run and appends the error', async (t) => {
  const conv = freshPath('failure');
  await cleanup(conv);
  t.after(() => cleanup(conv));

  await writeHumanTurn(conv, { text: 'Message', humanId: 'h1', runId: 'r1' });
  await writeTurnFailure(conv, 'CURSOR_API_KEY manquant');

  const { items } = await loadTimeline(conv);
  const run = items.find((it) => it.type === 'run');
  assert.equal(run.status, 'aborted');
  const sys = items[items.length - 1];
  assert.equal(sys.type, 'system');
  assert.match(sys.text, /CURSOR_API_KEY/);
});

// Close the shared MariaDB pool so `node --test` can exit cleanly.
test('teardown: close db pool', async () => {
  try { await getPool().end(); } catch { /* already closed */ }
});
