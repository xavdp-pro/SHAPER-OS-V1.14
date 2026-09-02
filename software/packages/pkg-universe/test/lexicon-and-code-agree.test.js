import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-37
// Intent: software/RULES.md#rule-11
//
// Non-regression (Rule 29) for the maker-and-governor verdict of
// 2 September 2026. The governor's code had five states and the law named
// four: a row could be REAPED in `pkg-governor/index.js` and the word existed
// in no rule and on no lexicon page, so a cold agent reading Rule 37 believed
// a reaped row was still one of the living. The fleet map admitted two host
// kinds while a third was being built under a token, `lxc`, that is the name
// of LXD's client binary — the very command the `lxd` recipes call. And three
// nouns the doctrine used on every page (governor, maker, matrix) were in the
// lexicon of no page, which Rule 37 forbids: a noun enters by amendment, with
// the failure it prevents written beside it.
//
// This guard holds the three texts and the code together:
//   1. every state the governor knows is named in Rule 37's state-machine
//      clause and in the lexicon's table;
//   2. every host kind the fleet map admits is a token the maker template
//      keys its recipes by, spelled in Rule 11, and never the bare `lxc`;
//   3. governor, maker and matrix sit in the lexicon's table, each with the
//      failure it prevents.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const RULES = read('software/RULES.md');
const LEXICON = read('docs/architecture/LEXICON.md');
const FLEET = read('docs/architecture/FLEET.md');
const MAKER_INTENT = read('software/universes/_maker-template/INTENT.md');
const GOVERNOR = read('software/packages/pkg-governor/index.js');

/** The text of one rule: from the heading its anchor precedes to the next
 *  rule's heading. */
function ruleText(anchor) {
  const at = RULES.indexOf(`<a id="${anchor}"></a>`);
  assert.notEqual(at, -1, `RULES.md offers no anchor "${anchor}"`);
  const heading = RULES.indexOf('\n### Rule ', at);
  assert.notEqual(heading, -1, `no rule heading follows the anchor "${anchor}"`);
  const rest = RULES.slice(heading + 1);
  const next = rest.search(/\n### Rule /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** One top-level bullet of a rule, by the bold words it opens with. */
function bulletOf(text, opening) {
  const start = text.indexOf(`* **${opening}`);
  assert.notEqual(start, -1, `no bullet opening with "${opening}"`);
  const rest = text.slice(start + 1);
  const next = rest.search(/\n\* \*\*/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The states the governor's code knows: the STATES literal, read as text. */
function statesOfTheCode() {
  const m = GOVERNOR.match(/^const STATES = \[([^\]]+)\];/m);
  assert.ok(m, 'pkg-governor/index.js declares no STATES literal');
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/** The rows of the lexicon's word table: `| **word** | sentence |`. */
function lexiconRows() {
  const rows = new Map();
  for (const m of LEXICON.matchAll(/^\|\s*\*\*([^*]+)\*\*\s*\|(.+)\|\s*$/gm)) rows.set(m[1].trim(), m[2]);
  return rows;
}

/** The host kinds the fleet map admits: the `kind:` line of its schema. */
function kindsOfTheFleetMap() {
  const m = FLEET.match(/^\s*kind:\s*([^#\n]+)/m);
  assert.ok(m, 'FLEET.md declares no `kind:` line');
  return m[1].split('|').map((k) => k.trim()).filter(Boolean);
}

test('every state the governor knows is named by Rule 37 and by the lexicon', () => {
  const states = statesOfTheCode();
  assert.ok(states.length >= 4, `the governor names ${states.length} states`);
  const clause = bulletOf(ruleText('rule-37'), 'One state machine');
  const table = [...lexiconRows().values()].join('\n');
  const missing = [];
  for (const state of states) {
    const word = new RegExp(`\\b${state}\\b`);
    if (!word.test(clause)) missing.push(`${state}: absent from Rule 37's state-machine clause`);
    if (!word.test(table)) missing.push(`${state}: absent from the lexicon's word table`);
  }
  assert.deepEqual(missing, [], `states the code knows and the law does not name:\n  ${missing.join('\n  ')}`);
});

test('every host kind the fleet map admits is a recipe token the maker and Rule 11 name, and never `lxc`', () => {
  const kinds = kindsOfTheFleetMap();
  assert.ok(kinds.length >= 2, `FLEET.md admits ${kinds.length} host kinds`);
  const rule11 = ruleText('rule-11');
  const wrong = [];
  for (const kind of kinds) {
    if (!/^[a-z][a-z0-9]*$/.test(kind)) wrong.push(`${kind}: a kind is one lowercase word — it keys a recipe file name`);
    if (kind === 'lxc') wrong.push('lxc: the bare word is LXD\'s client binary, which the lxd recipes call — the plain-LXC family is `liblxc`');
    if (!MAKER_INTENT.includes(`\`${kind}\``)) wrong.push(`${kind}: the maker template's INTENT names no such host kind`);
    if (!rule11.includes(`\`${kind}\``)) wrong.push(`${kind}: Rule 11 names no such host family token`);
  }
  if (!/<kind>-<work>\.sh/.test(MAKER_INTENT)) wrong.push('the maker template does not state the recipe grammar `<kind>-<work>.sh`');
  assert.deepEqual(wrong, [], `host kinds the map admits and the texts do not carry:\n  ${wrong.join('\n  ')}`);
});

test('governor, maker and matrix are lexicon words, each with the failure it prevents', () => {
  const rows = lexiconRows();
  const missing = [];
  for (const word of ['governor', 'maker', 'matrix']) {
    const sentence = rows.get(word);
    if (!sentence) { missing.push(`${word}: not a row of the lexicon's table`); continue; }
    if (!/prevents/i.test(sentence)) missing.push(`${word}: its row does not say what failure it prevents (Rule 37)`);
  }
  assert.deepEqual(missing, [], `nouns the doctrine uses and the lexicon does not seal:\n  ${missing.join('\n  ')}`);
});
