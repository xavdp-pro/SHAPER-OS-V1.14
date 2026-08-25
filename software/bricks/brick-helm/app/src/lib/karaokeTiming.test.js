import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitKaraokeSentences,
  estimatedSpeechDuration,
  estimateKaraokeSentences,
  rescaleKaraokeUnits,
  karaokeIndexAt,
} from './karaokeTiming.js';

describe('karaokeTiming sentences', () => {
  it('splitKaraokeSentences keeps punctuation with the phrase', () => {
    assert.deepEqual(
      splitKaraokeSentences('Bonjour Xavier. Je suis KovZu. Dis-moi.'),
      ['Bonjour Xavier.', 'Je suis KovZu.', 'Dis-moi.'],
    );
  });

  it('splitKaraokeSentences returns one unit when there is no period', () => {
    assert.deepEqual(
      splitKaraokeSentences('Voici le tableau des ventes'),
      ['Voici le tableau des ventes'],
    );
  });

  it('estimateKaraokeSentences covers the full duration without gaps', () => {
    const text = 'Alpha. Bravo charlie. Delta.';
    const units = estimateKaraokeSentences(text, 6);
    assert.equal(units.length, 3);
    assert.equal(units[0].start, 0);
    assert.equal(units[2].end, 6);
    assert.ok(units[0].end <= units[1].start + 1e-9);
    assert.ok(units[1].end <= units[2].start + 1e-9);
    assert.equal(units[0].wordStart, 0);
    assert.ok(units[2].wordEnd >= 4);
  });

  it('karaokeIndexAt stays on the same sentence for a 10% clock slip', () => {
    const units = estimateKaraokeSentences('Une. Deux trois quatre. Cinq.', 10);
    const mid = (units[1].start + units[1].end) / 2;
    assert.equal(karaokeIndexAt(units, mid), 1);
    assert.equal(karaokeIndexAt(units, mid + 0.4), 1);
    assert.equal(karaokeIndexAt(units, units[0].start + 0.05), 0);
  });

  it('rescaleKaraokeUnits keeps sentence count and maps to new duration', () => {
    const units = estimateKaraokeSentences('Un. Deux. Trois.', 3);
    const next = rescaleKaraokeUnits(units, 9);
    assert.equal(next.length, 3);
    assert.equal(next[0].start, 0);
    assert.equal(next[2].end, 9);
    assert.equal(next[0].word, 'Un.');
  });

  it('estimatedSpeechDuration grows with text length', () => {
    const short = estimatedSpeechDuration('Ok.');
    const long = estimatedSpeechDuration('Bonjour, je te fais un résumé complet de la situation actuelle.');
    assert.ok(short >= 0.8);
    assert.ok(long > short);
  });
});
