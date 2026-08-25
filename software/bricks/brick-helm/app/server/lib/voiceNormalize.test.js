import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseSpelling,
  applyLexicon,
  normalizeTranscript,
  foldToken,
  phoneticKey,
} from './voiceNormalize.js';

const LEXICON = {
  canonicals: ['gbs-h1', 'gbs-p2', 'gbs-p7', 'gbs-k0', 'kovzu', 'wg0'],
  aliases: [
    { alias: 'cas zéro', canonical: 'gbs-k0' },
    { alias: 'k zéro', canonical: 'gbs-k0' },
    { alias: 'pé deux', canonical: 'gbs-p2' },
  ],
};

test('foldToken / phoneticKey basics', () => {
  assert.equal(foldToken('GBS-H1 !'), 'gbsh1');
  assert.equal(phoneticKey('cas'), 'kas');
  assert.equal(phoneticKey('k'), 'k');
});

test('NATO run collapses without marker', () => {
  assert.equal(
    collapseSpelling('clone depuis golf bravo sierra tiret papa sept'),
    'clone depuis gbs-p7',
  );
});

test('single NATO word stays untouched (normal conversation)', () => {
  assert.equal(collapseSpelling('le delta du fleuve'), 'le delta du fleuve');
});

test('spell marker enables letter names', () => {
  assert.equal(
    collapseSpelling('va sur épelle gé bé esse tiret ache un maintenant'),
    'va sur gbs-h1 maintenant',
  );
});

test('digits and dashes inside spelled sequences', () => {
  assert.equal(
    collapseSpelling('épelle ka zéro'),
    'k0',
  );
});

test('alias exact match replaces spoken form', () => {
  const { text, replacements } = applyLexicon('crée un conteneur sur cas zéro stp', LEXICON);
  assert.equal(text, 'crée un conteneur sur gbs-k0 stp');
  assert.deepEqual(replacements, [{ from: 'cas zéro', to: 'gbs-k0' }]);
});

test('alias phonetic match (STT wrote "casse zéro")', () => {
  const { text } = applyLexicon('déploie sur casse zéro', LEXICON);
  assert.equal(text, 'déploie sur gbs-k0');
});

test('canonical folded match: "GBS H 1" → gbs-h1', () => {
  const { text } = applyLexicon('redémarre GBS H 1 maintenant', LEXICON);
  assert.equal(text, 'redémarre gbs-h1 maintenant');
});

test('fuzzy repairs near-miss with digits: gbs-p 2 → gbs-p2', () => {
  const { text } = applyLexicon('sauvegarde gbs-p 2 ce soir', LEXICON);
  assert.equal(text, 'sauvegarde gbs-p2 ce soir');
});

test('plain words are never falsely matched', () => {
  const { text, replacements } = applyLexicon(
    'quel est le chiffre d’affaires de la semaine', LEXICON,
  );
  assert.equal(text, 'quel est le chiffre d’affaires de la semaine');
  assert.equal(replacements.length, 0);
});

test('full pipeline: spelling then lexicon snap', () => {
  const { text, replacements } = normalizeTranscript(
    'clone le conteneur depuis golf bravo sierra tiret papa sept vers cas zéro go',
    LEXICON,
  );
  assert.equal(text, 'clone le conteneur depuis gbs-p7 vers gbs-k0 go');
  assert.ok(replacements.some((r) => r.to === 'gbs-k0'));
});

test('punctuation from STT survives', () => {
  const { text } = normalizeTranscript('redémarre cas zéro, puis vérifie.', LEXICON);
  assert.equal(text, 'redémarre gbs-k0, puis vérifie.');
});

test('already canonical text is untouched', () => {
  const { text, replacements } = normalizeTranscript('redémarre gbs-h1 stp', LEXICON);
  assert.equal(text, 'redémarre gbs-h1 stp');
  assert.equal(replacements.length, 0);
});
