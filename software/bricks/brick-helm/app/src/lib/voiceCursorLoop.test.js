import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { speakableUnixPaths, speechTextFromAssistant } from './voiceCursorLoop.js';

describe('voiceCursorLoop', () => {
  it('speakableUnixPaths replaces slashes in absolute paths', () => {
    assert.equal(
      speakableUnixPaths('Le fichier est dans /apps/helm-v2/app/src'),
      'Le fichier est dans apps helm-v2 app src',
    );
  });

  it('speakableUnixPaths strips spoken slash words', () => {
    assert.equal(
      speakableUnixPaths('Va dans slash apps slash helm'),
      'Va dans apps helm',
    );
  });

  it('speechTextFromAssistant normalizes unix paths for TTS', () => {
    const out = speechTextFromAssistant('Chemin : /apps/helm-v2/app');
    assert.match(out, /apps helm-v2 app/);
    assert.doesNotMatch(out, /\//);
  });

  it('undoubleSpeechText collapses repeated phrase chunks', async () => {
    const { undoubleSpeechText } = await import('./voiceCursorLoop.js');
    const a = 'Je recupere le repertoire.';
    const b = 'Repertoire courant NOW3.';
    assert.equal(undoubleSpeechText(a + a + b + b), a + b);
  });
});

  it('speechTextFromAssistant reads memory tables as labeled sentences', () => {
    const md = `| Type | Total | Utilisé | Libre | Partagé | Buff/Cache | Disponible |
| --- | --- | --- | --- | --- | --- | --- |
| RAM (Physique) | 8.0 GiB | 2.2 GiB | 5.4 GiB | 4.2 MiB | 413 MiB | 5.8 GiB |
| Swap | 4.0 GiB | 2.3 GiB | 1.7 GiB | | | |`;
    const out = speechTextFromAssistant(md, { locale: 'fr' });
    assert.match(out, /RAM physique/i);
    assert.match(out, /8 gigaoctets/);
    assert.match(out, /2,2 gigaoctets/);
    assert.match(out, /413 mégaoctets/);
    assert.match(out, /Swap/i);
    assert.doesNotMatch(out, /\|/);
    assert.doesNotMatch(out, /GiB/);
  });
