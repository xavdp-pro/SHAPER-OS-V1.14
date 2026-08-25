import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTtsPronunciation } from './voiceTtsPronounce.js';

describe('normalizeTtsPronunciation', () => {
  it('phoneticizes brand names in French context', () => {
    const text = 'Bienvenue sur Shaper OS avec KovZu et Zephir.';
    const result = normalizeTtsPronunciation(text, 'fr');
    assert.equal(result, 'Bienvenue sur Shaper O.S. avec Kovzou et Zéphir.');
  });

  it('expands IA into intelligence artificielle to prevent Deepgram English phonetic glitch', () => {
    const text = "L'IA est prête. Je suis une IA d'assistance.";
    const result = normalizeTtsPronunciation(text, 'fr');
    assert.equal(result, "L'intelligence artificielle est prête. Je suis une intelligence artificielle d'assistance.");
  });

  it('punctuates technical acronyms so TTS spells them letter-by-letter', () => {
    const text = 'Traitement des fichiers PDF et GED pour le CRM et l\'ERP.';
    const result = normalizeTtsPronunciation(text, 'fr');
    assert.equal(result, 'Traitement des fichiers P.D.F. et G.E.D. pour le C.R.M. et l\'E.R.P.');
  });

  it('strips markdown images, links, backticks and headers for clean speech', () => {
    const text = 'Voici le document : ![aperçu](/assets/img.png) et le lien [rapport](docs/rapport.pdf). Utilise `df -h` pour voir la RAM.';
    const result = normalizeTtsPronunciation(text, 'fr');
    assert.equal(result, 'Voici le document : et le lien rapport. Utilise df -h pour voir la R.A.M.');
  });

  it('collapses multiple trailing dots cleanly', () => {
    const text = 'Le projet fonctionne sur Shaper OS.';
    const result = normalizeTtsPronunciation(text, 'fr');
    assert.equal(result, 'Le projet fonctionne sur Shaper O.S.');
  });
});
