import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripLeadingVoiceAck, stripLeadingVoiceAckForTts } from './voiceAckStrip.js';

describe('stripLeadingVoiceAck', () => {
  it('strips generic ack lead', () => {
    const out = stripLeadingVoiceAck('Je vérifie ça tout de suite. La RAM fait 4 Go.');
    assert.equal(out, 'La RAM fait 4 Go.');
  });

  it('strips stacked ack sentences', () => {
    const out = stripLeadingVoiceAck("D'accord. Je m'en occupe. Voici le résultat.");
    assert.equal(out, 'Voici le résultat.');
  });

  it('keeps answer-only text', () => {
    const text = 'La machine dispose de quatre gigaoctets de mémoire vive.';
    assert.equal(stripLeadingVoiceAck(text), text);
  });
});

describe('stripLeadingVoiceAckForTts', () => {
  it('does not re-speak Groq ack alone', () => {
    assert.equal(stripLeadingVoiceAckForTts("D'accord.", "D'accord."), '');
    assert.equal(stripLeadingVoiceAckForTts('Je vérifie ça.', 'Je vérifie ça.'), '');
  });

  it('speaks only the useful answer after ack', () => {
    const out = stripLeadingVoiceAckForTts(
      "D'accord. La RAM fait 4 Go.",
      "D'accord.",
    );
    assert.equal(out, 'La RAM fait 4 Go.');
  });

  it('skips ack-only composer reply when Groq already spoke', () => {
    assert.equal(
      stripLeadingVoiceAckForTts("Ok, je m'en occupe.", "Ok, je m'en occupe."),
      '',
    );
  });
});
