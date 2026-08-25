import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTextForTts } from './ttsFormat.js';

describe('formatTextForTts', () => {
  it('expands technical acronyms into hyphenated letters for natural TTS', () => {
    const raw = "L'API REST utilise des requêtes SQL et produit du JSON ou du CSV pour la GED.";
    const formatted = formatTextForTts(raw, 'fr');
    assert.match(formatted, /A-P-I/);
    assert.match(formatted, /S-Q-L/);
    assert.match(formatted, /J-S-O-N/);
    assert.match(formatted, /C-S-V/);
    assert.match(formatted, /G-E-D/);
  });

  it('strips markdown code blocks, links, and bold formatting', () => {
    const raw = "# Titre\n\nVoici le lien [Documentation](https://doc.local) et un bloc ```js\nconst a = 1;\n``` puis du **texte gras**.";
    const formatted = formatTextForTts(raw, 'fr');
    assert.doesNotMatch(formatted, /```/);
    assert.doesNotMatch(formatted, /https:\/\/doc\.local/);
    assert.match(formatted, /Documentation/);
    assert.match(formatted, /texte gras/);
  });

  it('normalizes symbols based on locale', () => {
    assert.equal(formatTextForTts('100% & contact@shaper.example.com', 'fr'), '100 pour cent et contact arobase shaper.example.com');
    assert.equal(formatTextForTts('100% & contact@shaper.example.com', 'en'), '100 percent and contact at shaper.example.com');
  });

  it('strips emotion tags like [calm]', () => {
    const raw = "[calm] Bonjour Xavier, [excited] comment vas-tu ?";
    const formatted = formatTextForTts(raw, 'fr');
    assert.equal(formatted, 'Bonjour Xavier, comment vas-tu ?');
  });
});
