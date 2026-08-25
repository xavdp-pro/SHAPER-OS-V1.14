import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyCursorLanguage } from './locale.js';

describe('applyCursorLanguage workspace', () => {
  it('includes active workspace path in inject directives', () => {
    const out = applyCursorLanguage('Draw a boat', 'fr', {
      workspaceCwd: '/home/zaza/Bureau/NOW3',
      agentName: 'Zephir',
      appName: 'KovZu',
    });
    assert.match(out, /WORKSPACE ACTIF.*\/home\/zaza\/Bureau\/NOW3/);
    assert.match(out, /pas dans.*\.cursor\/projects/);
    assert.match(out, /assets/);
    assert.match(out, /docs/);
    assert.match(out, /data/);
    assert.match(out, /scripts/);
    assert.match(out, /Draw a boat/);
  });

  it('includes multimedia playbook and on-demand install rules', () => {
    const out = applyCursorLanguage('Génère un PDF', 'fr', {
      workspaceCwd: '/home/zaza/Bureau/NOW3',
    });
    assert.match(out, /PLAYBOOK MULTIMÉDIA/i);
    assert.match(out, /GenerateImage/i);
    assert.match(out, /python-docx|pandoc/i);
    assert.match(out, /Ne PAS pré-installer|pas au démarrage/i);
    assert.match(out, /pip install|npm install/i);
  });

  it('includes playbook for voice turns too', () => {
    const out = applyCursorLanguage('Crée une image', 'fr', {
      workspaceCwd: '/home/zaza/Bureau/NOW3',
      voiceTurn: true,
      ackText: 'Compris pour l’image.',
    });
    assert.match(out, /PLAYBOOK MULTIMÉDIA/i);
    assert.match(out, /MODE VOIX/i);
    assert.match(out, /Crée une image/);
  });

  it('returns user text only after bootstrap (chat)', () => {
    const out = applyCursorLanguage('Liste les ports', 'fr', {
      bootstrapped: true,
      workspaceCwd: '/home/zaza/Bureau/NOW3',
      agentName: 'Zephir',
    });
    assert.equal(out, 'Liste les ports');
  });

  it('re-injects language for LiteLLM after bootstrap', () => {
    const out = applyCursorLanguage('Liste les ports', 'fr', {
      bootstrapped: true,
      alwaysLang: true,
    });
    assert.match(out, /LANGUE OBLIGATOIRE.*français/i);
    assert.match(out, /Liste les ports/);
  });

  it('adds thinking off directive when requested', () => {
    const out = applyCursorLanguage('Hello', 'fr', {
      claudeThinking: 'off',
    });
    assert.match(out, /Thinking DÉSACTIVÉ/i);
  });

  it('keeps voice-only directives after bootstrap', () => {
    const out = applyCursorLanguage('Tableau des ventes', 'fr', {
      bootstrapped: true,
      voiceTurn: true,
      ackText: 'D’accord.',
    });
    assert.match(out, /MODE VOIX/i);
    assert.doesNotMatch(out, /PLAYBOOK MULTIMÉDIA/i);
    assert.doesNotMatch(out, /skills KovZu/i);
    assert.match(out, /Tableau des ventes/);
  });
});
