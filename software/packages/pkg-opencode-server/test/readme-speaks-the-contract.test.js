import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-7
// Intent: software/RULES.md#rule-0-language-collaboration-protocol

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(PKG, 'README.md'), 'utf8');
const envExample = fs.readFileSync(path.join(PKG, '.env.example'), 'utf8');

/**
 * The package's front door says what the package does, in the corpus's
 * language, and promises no engine.
 *
 * Non-regression. Until the 2 September correction release this README was
 * written in French (Rule 0: technical text is English, so that every agent
 * that follows can read it) and carried a "Défaut :" line naming a versioned
 * free model — validated on a tool call, a table and prose — while server.mjs
 * had already stopped naming one (Rule 7). A tester reported it on 29 August;
 * nobody picked it up. A README is what a reader sees before the code, so a
 * default there is a promise about the engine exactly like one in code.
 */
const VERSIONED_MODEL = /claude[- ]?\d|gpt[- ]?\d|gpt[- ]?oss|gemini[- ]?\d|grok[- ]?\d|llama[- ]?\d|qwen\d|mistral[- ]?\d|nemotron[- ]?\d|deepseek[- ]?[vr]\d|composer[- ]?\d|mimo[- ]?v\d/i;
const FRENCH = /(^|[\s(])(Défaut|Rôle|Quand|Modèles|Vérification|Particularité|Événements|Il permet|Installation du)\b/m;

test('the README names no model and no default — the engine is measured at deployment', () => {
  const named = readme.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => VERSIONED_MODEL.test(l));
  assert.deepEqual(named, [], `a versioned model in the README:\n  ${named.map(([n, l]) => `${n}: ${l}`).join('\n  ')}`);
  assert.doesNotMatch(readme, /^(Défaut|Default)\s*:/m, 'a "Default:" line is a default the canon forbids (Rule 7)');
  assert.match(readme, /OPENCODE_MODEL/, 'the README must say where the model comes from');
  assert.match(readme, /measured at deploy/i, 'and that it is measured at deployment, never named here');
  assert.doesNotMatch(envExample, VERSIONED_MODEL, '.env.example names a versioned model');
});

/**
 * The same review found .env.example shipping one operator's host layout as
 * its example values (/apps/helm-v2/ws/opencode): not a model, but a value
 * that is somebody's alone, exactly what Boot Contract 10b keeps out of a
 * tracked file. The code's own fallbacks (/opt/bridge, $HOME/ws/opencode)
 * belong in a comment; the example names nobody's host.
 */
const OPERATOR_LAYOUT = /helm-v2|\/apps\//;

test('.env.example ships no operator host layout as a value (Boot Contract 10b)', () => {
  const own = envExample.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith('#') && OPERATOR_LAYOUT.test(l));
  assert.deepEqual(own, [], `an operator's host layout shipped as an example value:\n  ${own.map(([n, l]) => `${n}: ${l}`).join('\n  ')}`);
  for (const name of ['OPENCODE_BIN', 'OPENCODE_WS_BASE']) {
    assert.match(envExample, new RegExp(`^${name}=\\s*$`, 'm'), `${name} must be declared empty — the code's fallback is documented in a comment, not written as a value`);
  }
});

test('the README is written in English (Rule 0)', () => {
  const m = FRENCH.exec(readme);
  assert.equal(m, null, `French in a technical text: "${m && m[2]}" — Rule 0 keeps the corpus readable by every agent that follows`);
});
