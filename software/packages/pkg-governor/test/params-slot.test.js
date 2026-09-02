import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileStorage, createGovernor, createGovernorServer } from '../index.js';
import { defaultRecipeRunner, recipeEnvironment, startMaker } from '../../../universes/_maker-template/poller.mjs';

// Intent: software/packages/pkg-governor/INTENT.md#params-are-typed
// Intent: software/universes/_maker-template/INTENT.md#typed-parameters
//
// Decided 2 September 2026 (D1 of the maker-and-governor verdict), before
// any class needing it existed. A recipe that must derive a host resource
// from a number the product assigned — a tenant's N, hence its bridge, its
// DNAT port, its unit — had no conforming way to receive it: six argv
// positions, none of them free, and `account` is a stranger's text the
// recipe may not derive anything from. The row needed a typed slot. Left
// unspecified, that slot had three holes: a re-ask carrying another N used
// to be answered with the old row and nothing said; two rows could carry
// one N (two DNAT rules on one port); and a param laid on the recipe's
// environment by inheritance would have carried LD_PRELOAD or BASH_ENV
// into a shell running as root. These tests hold the slot to its shape.

const SCHEMA = { 'univ-demo-vpn': { n: { type: 'number', unique: true }, label: { type: 'string' } } };
const ASK = { account: 'A', klass: 'univ-demo-vpn', matrix: 'vpn', digest: 'sha256:aa', machine: 'gbs-test' };

function world(options = {}) {
  const g = createGovernor({ paramsSchema: SCHEMA, ...options });
  const { token } = g.enrolMaker({ host: 'gbs-test' });
  const offers = () => g.poll({ token, host: 'gbs-test', inventory: ['sha256:aa'] });
  const report = (rowId, event, data = {}) => g.report({ token, rowId, event, data });
  return { g, token, offers, report };
}

/** A recipe directory holding one stub `lxd-stamp.sh` with the given body. */
function recipeDir(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'params-recipe-'));
  fs.writeFileSync(path.join(dir, 'lxd-stamp.sh'), `#!/usr/bin/env bash\n${body}\n`);
  return dir;
}

describe('the params slot: typed, immutable, unique, and never a shell\'s word', () => {
  it('params persist through storage and ride the work', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'params-ledger-'));
    const file = path.join(dir, 'ledger.jsonl');
    const first = createGovernor({ storage: createFileStorage(file), paramsSchema: SCHEMA });
    const { token } = first.enrolMaker({ host: 'gbs-test' });
    const asked = first.desire({ ...ASK, params: { n: 12, label: 'tenant twelve' } });
    assert.equal(asked.created, true);
    assert.deepEqual(asked.row.params, { n: 12, label: 'tenant twelve' });

    // The governor dies; the row it wrote still carries its params.
    const second = createGovernor({ storage: createFileStorage(file), paramsSchema: SCHEMA });
    assert.deepEqual(second.getRow(asked.row.id).params, { n: 12, label: 'tenant twelve' },
      'a param forgotten at restart would leave the recipe deriving N from nothing');

    // The work carries them as data, beside the six positions.
    const { work } = second.poll({ token, host: 'gbs-test', inventory: ['sha256:aa'] });
    assert.equal(work.length, 1);
    assert.deepEqual(work[0].params, { n: 12, label: 'tenant twelve' });

    // And the recipe reads them from its environment, under their names,
    // while its argv stays the six typed positions it always had.
    const recipes = recipeDir(
      'printf \'{"state":"RUNNING","argc":%s,"n":"%s","label":"%s"}\\n\' "$#" "$SHAPER_PARAM_N" "$SHAPER_PARAM_LABEL"',
    );
    const run = defaultRecipeRunner({ recipesDir: recipes, hostKind: 'lxd' });
    const facts = await run(work[0]);
    assert.equal(facts.argc, 6, 'a seventh argv position appeared — params are environment, never argv');
    assert.equal(facts.n, '12');
    assert.equal(facts.label, 'tenant twelve');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(recipes, { recursive: true, force: true });
  });

  it('a re-ask with different params is refused with the row id', () => {
    const { g } = world();
    const { row } = g.desire({ ...ASK, params: { n: 12 } });
    const other = g.desire({ ...ASK, params: { n: 13 } });
    assert.equal(other.refused, true, 'a re-ask carrying another N was answered with the old row and nothing said');
    assert.equal(other.created, false);
    assert.equal(other.row.id, row.id, 'the refusal names the living row whose params stand');
    assert.match(other.reason, /immutable/);
    assert.equal(g.listRows().length, 1, 'a second row was born for the same account');
    assert.deepEqual(g.getRow(row.id).params, { n: 12 }, 'the living row\'s params were rewritten');

    // The same params again is the idempotent ask it always was.
    const same = g.desire({ ...ASK, params: { n: 12 } });
    assert.equal(same.refused, undefined);
    assert.equal(same.created, false);
    assert.equal(same.row.id, row.id);
  });

  it('a forbidden key never reaches the recipe\'s environment', async () => {
    // At the door: the governor refuses what its allow-list does not name,
    // as a typed fact, before any row is written.
    const { g } = world();
    for (const [params, why] of [
      [{ LD_PRELOAD: '/tmp/evil.so' }, /not a word a recipe may receive/],
      [{ BASH_ENV: '/tmp/evil.sh' }, /not a word a recipe may receive/],
      [{ 'a key': 1 }, /not a word a recipe may receive/],
      [{ ld_preload: '/tmp/evil.so' }, /not declared for class/],
      [{ n: [12] }, /must be a scalar/],
      [{ n: '12' }, /must be a number/],
    ]) {
      const out = g.desire({ ...ASK, params });
      assert.equal(out.refused, true, `${JSON.stringify(params)} was written to the ledger`);
      assert.match(out.reason, why);
    }
    assert.equal(g.listRows().length, 0);
    assert.equal(g.desire({ ...ASK, account: 'B', klass: 'univ-no-schema', params: { n: 1 } }).refused, true,
      'a class that declares no params accepted one');

    // On the host: the maker holds root and trusts no ledger it cannot read.
    // A work item carrying a hostile key — a governor lying, or a ledger
    // written by hand — is refused before the recipe runs, and the refusal
    // names the keys so the row hears why.
    const recipes = recipeDir('touch "$0.ran"\nprintf \'{"state":"RUNNING"}\\n\'');
    const run = defaultRecipeRunner({ recipesDir: recipes, hostKind: 'lxd' });
    const hostile = {
      kind: 'stamp', rowId: 'r', klass: 'k', matrix: 'm', digest: 'd', account: 'a', env: 'demo',
      params: { LD_PRELOAD: '/tmp/evil.so', BASH_ENV: '/tmp/evil.sh', 'a key': 'x', n: 5 },
    };
    await assert.rejects(() => run(hostile), /"LD_PRELOAD", "BASH_ENV", "a key"/);
    assert.equal(fs.existsSync(path.join(recipes, 'lxd-stamp.sh.ran')), false,
      'the recipe ran with a hostile key on its environment');

    // And the environment is BUILT, never inherited: what the maker's own
    // process carries does not reach the recipe unless it is the host's
    // few words or the operator's SHAPER_* configuration.
    const marker = `SNEAKY_${process.pid}`;
    process.env[marker] = 'inherited';
    process.env.SHAPER_PARAM_SNEAKY = 'a param the row never wrote';
    process.env.SHAPER_MATRICES_DIR = '/var/lib/shaper/matrices';
    try {
      const { env } = recipeEnvironment({ n: 5 }, { ...process.env, LD_PRELOAD: '/tmp/evil.so', BASH_ENV: '/tmp/evil.sh' });
      assert.equal(env.LD_PRELOAD, undefined);
      assert.equal(env.BASH_ENV, undefined);
      assert.equal(env[marker], undefined);
      assert.equal(env.SHAPER_PARAM_SNEAKY, undefined, 'a SHAPER_PARAM_ from the process environment is not the row\'s word');
      assert.equal(env.SHAPER_MATRICES_DIR, '/var/lib/shaper/matrices', 'the operator\'s own configuration reaches the recipe');
      assert.equal(env.SHAPER_PARAM_N, '5');
      assert.ok(env.PATH, 'a recipe with no PATH finds no lxc');

      // Through the real runner and a real bash, the same truth.
      const dump = recipeDir('printf \'{"state":"RUNNING","keys":"%s"}\\n\' "$(env | cut -d= -f1 | tr \'\\n\' \' \')"');
      const facts = await defaultRecipeRunner({ recipesDir: dump, hostKind: 'lxd' })({ ...hostile, params: { n: 5 } });
      const keys = facts.keys.split(' ');
      assert.ok(keys.includes('SHAPER_PARAM_N'));
      assert.ok(keys.includes('PATH'));
      assert.ok(!keys.includes(marker), 'the maker\'s process environment reached the recipe');
      assert.ok(!keys.includes('SHAPER_PARAM_SNEAKY'));
      fs.rmSync(dump, { recursive: true, force: true });
    } finally {
      delete process.env[marker];
      delete process.env.SHAPER_PARAM_SNEAKY;
      delete process.env.SHAPER_MATRICES_DIR;
    }
    fs.rmSync(recipes, { recursive: true, force: true });
  });

  it('a unique key cannot be held by two live rows', () => {
    const { g, offers, report } = world();
    const { row: first } = g.desire({ ...ASK, params: { n: 12 } });
    const clash = g.desire({ ...ASK, account: 'B', params: { n: 12 } });
    assert.equal(clash.refused, true, 'two live rows carry n=12 — two DNAT rules on one port');
    assert.equal(clash.created, false);
    assert.equal(clash.row.id, first.id, 'the refusal names the row holding the value');
    assert.match(clash.reason, /"n" = 12 is already held by live row/);
    assert.equal(g.listRows().length, 1);
    // Another value is free; a non-unique key may repeat.
    assert.equal(g.desire({ ...ASK, account: 'B', params: { n: 13, label: 'same' } }).created, true);
    assert.equal(g.desire({ ...ASK, account: 'C', params: { n: 14, label: 'same' } }).created, true);

    // A reaped row releases its value: the number may be given again.
    report(first.id, 'REAPED');
    assert.equal(g.desire({ ...ASK, account: 'D', params: { n: 12 } }).created, true);
  });

  it('a value passes from a broken row to its successor, and the birth waits for the end', () => {
    // The broken row is ended by the re-ask; its N goes to the successor —
    // a tenant keeps its number across a rebirth — but the successor is not
    // stamped while the predecessor still holds it on the host: the wait
    // is a typed fact in the poll answer, and REAPED lifts it.
    const { g, offers, report } = world();
    const { row: broken } = g.desire({ ...ASK, params: { n: 12 } });
    report(broken.id, 'STAMPING');
    report(broken.id, 'STAMP_FAILED', { error: 'bridge refused' });
    assert.equal(g.getRow(broken.id).state, 'DEGRADED');

    const again = g.desire({ ...ASK, params: { n: 12 } });
    assert.equal(again.created, true, 'the successor of a degraded row may keep its number');
    assert.notEqual(again.row.id, broken.id);
    assert.deepEqual(again.row.params, { n: 12 });

    const beat = offers();
    assert.deepEqual(beat.work.map((w) => `${w.kind}:${w.rowId}`), [`reap:${broken.id}`],
      'the successor was stamped beside a predecessor still holding its value');
    assert.deepEqual(beat.withheld, [{ rowId: again.row.id, key: 'n', on: broken.id }],
      'a withheld birth must be a typed fact, never a silent absence of work');

    report(broken.id, 'REAPING');
    report(broken.id, 'REAPED');
    const next = offers();
    assert.deepEqual(next.work.map((w) => `${w.kind}:${w.rowId}`), [`stamp:${again.row.id}`]);
    assert.deepEqual(next.withheld, []);
  });

  it('a withheld birth is heard on the host, never read as an empty answer', async () => {
    // The governor answers the wait as a typed fact; the maker used to log
    // only `preload`, so on the host a withheld birth looked exactly like a
    // beat with nothing to do — the operator watching the maker's journal
    // could not tell "no work" from "a birth waiting on a reap".
    const g = createGovernor({ paramsSchema: SCHEMA });
    const server = createGovernorServer({ governor: g, adminToken: 'tandem-secret' });
    await new Promise((r) => server.on('listening', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const { token } = g.enrolMaker({ host: 'gbs-test' });
    const report = (rowId, event, data = {}) => g.report({ token, rowId, event, data });
    const { row: broken } = g.desire({ ...ASK, params: { n: 12 } });
    report(broken.id, 'STAMPING');
    report(broken.id, 'STAMP_FAILED', { error: 'bridge refused' });
    const { row: successor } = g.desire({ ...ASK, params: { n: 12 } });
    const journal = [];
    let maker = null;
    try {
      maker = startMaker({
        governorUrl: url, token, host: 'gbs-test', intervalMs: 50,
        inventory: () => ['sha256:aa'],
        // The reap the same beat offers never ends here: the wait must be
        // heard while it stands, not inferred after it lifted.
        runRecipe: () => new Promise(() => {}),
        log: (...words) => journal.push(words.join(' ')),
      });
      const heard = async () => {
        const end = Date.now() + 3000;
        while (Date.now() < end && !journal.some((l) => /withheld/.test(l))) await new Promise((r) => setTimeout(r, 25));
        return journal.find((l) => /withheld/.test(l)) || null;
      };
      const line = await heard();
      assert.ok(line, `the maker's journal never named the withheld birth:\n  ${journal.join('\n  ')}`);
      assert.match(line, new RegExp(successor.id), 'the line must name the row whose birth waits');
      assert.match(line, new RegExp(broken.id), 'the line must name the predecessor it waits on');
      assert.match(line, /\bn\b/, 'the line must name the unique key that is held');
    } finally {
      maker?.stop();
      server.close();
    }
  });
});
