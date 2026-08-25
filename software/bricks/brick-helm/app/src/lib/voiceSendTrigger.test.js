import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitVoiceSendCommand,
  splitVoiceClearCommand,
  splitVoiceRebornCommand,
  hasVoiceRebornKeyword,
  VOICE_SEND_WORD,
  VOICE_REBORN_WORD,
} from './voiceSendTrigger.js';

describe('splitVoiceSendCommand', () => {
  it('exports go as the UI send word', () => {
    assert.equal(VOICE_SEND_WORD, 'go');
  });

  it('triggers on message + go', () => {
    const r = splitVoiceSendCommand('montre le CPU go');
    assert.equal(r.triggered, true);
    assert.equal(r.message, 'montre le cpu');
  });

  it('triggers on punctuation before go', () => {
    const r = splitVoiceSendCommand('montre le CPU. Go!');
    assert.equal(r.triggered, true);
    assert.equal(r.message, 'montre le cpu');
  });

  it('keyword-only go does not leave go as message', () => {
    const r = splitVoiceSendCommand('go');
    assert.equal(r.triggered, true);
    assert.equal(r.message, '');
    assert.equal(r.keywordOnly, true);
  });

  it('FR STT gros / gout as last-word send', () => {
    assert.equal(splitVoiceSendCommand('gros').keywordOnly, true);
    assert.equal(splitVoiceSendCommand('goût').keywordOnly, true);
    assert.equal(splitVoiceSendCommand('montre le cpu gros').triggered, true);
    assert.equal(splitVoiceSendCommand('un gros serveur').triggered, false);
  });

  it('does not match go inside logo / google / cargo / algo', () => {
    for (const text of ['change le logo', 'cherche sur google', 'le cargo', 'dime algo']) {
      const r = splitVoiceSendCommand(text);
      assert.equal(r.triggered, false, text);
    }
  });

  it('does not match mid-sentence go', () => {
    const r = splitVoiceSendCommand('go to the server and list files');
    assert.equal(r.triggered, false);
  });

  it('triggers on vasy / vas-y (what FR STT writes instead of go)', () => {
    assert.equal(splitVoiceSendCommand('vasy').keywordOnly, true);
    assert.equal(splitVoiceSendCommand('vas-y').keywordOnly, true);
    assert.equal(splitVoiceSendCommand('vas y').keywordOnly, true);
    const r = splitVoiceSendCommand('montre le cpu vasy');
    assert.equal(r.triggered, true);
    assert.equal(r.message, 'montre le cpu');
  });

  it('does not send on envoie / ok / fini (dictation words)', () => {
    for (const text of [
      'envoie un mail à Jean',
      'liste les fichiers envoie',
      'c est bon ok',
      'voilà fini',
      'merci okay',
    ]) {
      assert.equal(splitVoiceSendCommand(text).triggered, false, text);
    }
  });
});

describe('splitVoiceClearCommand', () => {
  it('triggers on lone clear', () => {
    const r = splitVoiceClearCommand('clear');
    assert.equal(r.triggered, true);
    assert.equal(r.keywordOnly, true);
  });

  it('triggers on message + clear / effacer', () => {
    assert.equal(splitVoiceClearCommand('ma phrase clear').triggered, true);
    assert.equal(splitVoiceClearCommand('ma phrase effacer').triggered, true);
  });

  it('FR STT claire / clair as last-word clear', () => {
    assert.equal(splitVoiceClearCommand('claire').keywordOnly, true);
    assert.equal(splitVoiceClearCommand('clair').keywordOnly, true);
    assert.equal(splitVoiceClearCommand('ma phrase claire').triggered, true);
  });

  it('does not treat declare as clear', () => {
    const r = splitVoiceClearCommand('il faut declare');
    assert.equal(r.triggered, false);
  });
});

describe('splitVoiceRebornCommand & hasVoiceRebornKeyword', () => {
  it('triggers on lone reborn or reboot', () => {
    assert.equal(splitVoiceRebornCommand('reborn').keywordOnly, true);
    assert.equal(splitVoiceRebornCommand('reboot').keywordOnly, true);
    assert.equal(splitVoiceRebornCommand('recommence').keywordOnly, true);
    assert.equal(hasVoiceRebornKeyword('reborn'), true);
    assert.equal(hasVoiceRebornKeyword('reboot'), true);
    assert.equal(hasVoiceRebornKeyword('recommencer'), true);
  });

  it('triggers on phrases like fais un reborn or remets à zéro', () => {
    assert.equal(hasVoiceRebornKeyword('fais un reborn'), true);
    assert.equal(hasVoiceRebornKeyword('lance un reborn'), true);
    assert.equal(hasVoiceRebornKeyword('remets à zéro'), true);
    assert.equal(hasVoiceRebornKeyword('nouvelle session'), true);
  });

  it('does not trigger on unrelated long sentences', () => {
    assert.equal(hasVoiceRebornKeyword('je lis un article sur la technologie des ordinateurs'), false);
  });
});
