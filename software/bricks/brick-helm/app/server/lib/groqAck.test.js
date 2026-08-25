import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAckIntent,
  isValidAckText,
  pickFallbackAck,
  cleanAckText,
} from './groqAck.js';

describe('groqAck', () => {
  it('classifies greeting vs task', () => {
    assert.equal(classifyAckIntent('bonjour'), 'greeting');
    assert.equal(classifyAckIntent('Salut !'), 'greeting');
    assert.equal(classifyAckIntent('donne moi la taille de la ram'), 'task');
    assert.equal(classifyAckIntent('merci'), 'thanks');
  });

  it('accepts short generic receipts', () => {
    const msg = 'donne moi la taille de la ram stp';
    assert.equal(isValidAckText(pickFallbackAck('fr', msg), msg), true);
    assert.equal(isValidAckText('Je regarde la RAM tout de suite.', msg), true);
    assert.equal(isValidAckText('D\'accord, je m\'occupe de taille ram — deux secondes.', msg), true);
  });

  it('rejects composer jargon and questions', () => {
    const msg = 'donne moi la taille de la ram stp';
    assert.equal(isValidAckText('Compris pour taille ram — Composer travaille.', msg), false);
    assert.equal(isValidAckText('Salut, je t\'écoute — qu\'est-ce que tu veux faire ?', 'bonjour'), false);
  });

  it('accepts greeting receipts', () => {
    assert.equal(isValidAckText('Salut, je t’écoute.', 'bonjour'), true);
  });

  it('rejects partial answers', () => {
    const msg = 'donne moi la taille de la ram stp';
    assert.equal(isValidAckText('Je peux te donner la RAM mais quel OS ?', msg), false);
    assert.equal(isValidAckText('Voici le résultat : 16 Go', msg), false);
  });

  it('pickFallbackAck returns localized phrase', () => {
    const phrase = pickFallbackAck('fr', 'bonjour');
    assert.ok(phrase.length >= 6);
  });

  it('pickFallbackAck cites topic for tasks', () => {
    const phrase = pickFallbackAck('fr', 'donne moi la taille de la ram stp');
    assert.match(phrase.toLowerCase(), /taille|ram/);
    assert.ok(phrase.length > 20);
  });

  it('cleanAckText trims quotes', () => {
    assert.equal(cleanAckText('« Je vérifie. »'), 'Je vérifie.');
  });
});
