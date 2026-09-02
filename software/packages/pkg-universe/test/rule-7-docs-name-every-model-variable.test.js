import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-7

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/**
 * Rule 7 in the documents: every bridge's model is measured at deploy, and
 * the documents that list the variables list all of them, with no default.
 *
 * Non-regression. The Rule 7 sweep of the 2 September correction release
 * made every bridge halt without its model variable — CURSOR_MODEL,
 * AGY_MODEL (or ANTIGRAVITY_MODEL), OLLAMA_MODEL (or DEEPSEEK_MODEL) beside
 * OPENCODE_MODEL — and made podman-up.sh halt before starting a bridge whose
 * variable is empty. The documents lagged: PREREQUISITES §4 and the runbook's
 * measurement step named OPENCODE_MODEL alone, so a universe enabling a
 * second bridge met a halt the literal path never announced; and
 * KEYS-AND-ACCOUNTS still said the OpenCode model had a "(default set)" —
 * the default that had been withdrawn from its catalogue while shipped.
 *
 * The variable names are checked against the bridge sources, so this guard
 * cannot document a variable no bridge reads.
 */
const PHRASE = /measured at deploy, never written here/;
const VARIABLES = [
  { name: 'OPENCODE_MODEL', readBy: 'software/packages/pkg-opencode-server/server.mjs' },
  { name: 'CURSOR_MODEL', readBy: 'software/packages/pkg-bridge-cursor/index.js' },
  { name: 'AGY_MODEL', readBy: 'software/packages/pkg-bridge-agy/index.js' },
  { name: 'ANTIGRAVITY_MODEL', readBy: 'software/packages/pkg-bridge-agy/index.js' },
  { name: 'OLLAMA_MODEL', readBy: 'software/packages/pkg-bridge-deepseek/index.js' },
  { name: 'DEEPSEEK_MODEL', readBy: 'software/packages/pkg-bridge-deepseek/index.js' },
];
const ANY_MODEL_VAR = /\b(OPENCODE|CURSOR|AGY|ANTIGRAVITY|OLLAMA|DEEPSEEK)_MODEL=(?!\s*$)(?!<)(\S+)/;

test('every variable this guard expects is one a bridge really reads', () => {
  const fiction = VARIABLES.filter(({ name, readBy }) => !read(readBy).includes(name)).map(({ name }) => name);
  assert.deepEqual(fiction, [], `no bridge reads:\n  ${fiction.join('\n  ')}`);
});

function section(text, from, to) {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + 1);
  assert.ok(start !== -1 && end !== -1, `section "${from}" … "${to}" not found`);
  return text.slice(start, end);
}

test('PREREQUISITES §4 lists every bridge\'s model variable, measured at deploy', () => {
  const minimum = section(read('docs/PREREQUISITES.md'), '## 4.', '## 5.');
  const absent = VARIABLES.map(({ name }) => name).filter((name) => !minimum.includes(`\`${name}\``));
  assert.deepEqual(absent, [], `PREREQUISITES §4 does not list:\n  ${absent.join('\n  ')}`);
  assert.match(minimum, PHRASE, 'the table must say the value is measured at deploy, never written here');
});

test('the runbook\'s measurement step names every bridge\'s variable in the same shape', () => {
  const measure = section(read('docs/agent/RUNBOOK-EXPLICIT.md'), '# 4.2b', '# 4.3');
  const absent = VARIABLES.map(({ name }) => name).filter((name) => !measure.includes(name));
  assert.deepEqual(absent, [], `runbook Step 4.2b does not name:\n  ${absent.join('\n  ')}`);
  assert.match(measure, PHRASE);
});

test('KEYS-AND-ACCOUNTS names no default model and lists every bridge\'s variable', () => {
  const keys = read('docs/human/KEYS-AND-ACCOUNTS.md');
  assert.doesNotMatch(keys, /default set/i, 'a "(default set)" is a default the canon forbids (Rule 7)');
  const absent = VARIABLES.map(({ name }) => name).filter((name) => !keys.includes(`\`${name}\``));
  assert.deepEqual(absent, [], `the key map does not list:\n  ${absent.join('\n  ')}`);
  assert.match(keys, PHRASE);
});

test('software/.env.example declares every model variable, and none with a value', () => {
  const example = read('software/.env.example');
  const absent = VARIABLES.map(({ name }) => name).filter((name) => !new RegExp(`^#?\\s*${name}=\\s*$`, 'm').test(example));
  assert.deepEqual(absent, [], `.env.example does not declare (empty):\n  ${absent.join('\n  ')}`);
});

test('no document in the deploy path writes a model into a model variable', () => {
  const shipped = [];
  for (const rel of ['docs/PREREQUISITES.md', 'docs/agent/RUNBOOK-EXPLICIT.md', 'docs/human/KEYS-AND-ACCOUNTS.md', 'software/.env.example', 'examples/universe.env.example']) {
    read(rel).split('\n').forEach((line, i) => {
      const m = ANY_MODEL_VAR.exec(line);
      if (m) shipped.push(`${rel}:${i + 1}  ${m[0]}`);
    });
  }
  assert.deepEqual(shipped, [], `a model written where it must be measured (Rule 7):\n  ${shipped.join('\n  ')}`);
});
