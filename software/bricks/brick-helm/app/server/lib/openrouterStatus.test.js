import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decorateClaudeModels,
  formatAgentModelError,
  isOpenRouterModel,
  openRouterKeyConfigured,
} from './openrouterStatus.js';

describe('openrouterStatus', () => {
  it('detects OpenRouter model ids', () => {
    assert.equal(isOpenRouterModel('or-kimi-k3'), true);
    assert.equal(isOpenRouterModel('groq-llama-8b'), false);
  });

  it('rejects placeholder keys', () => {
    assert.equal(openRouterKeyConfigured('your-openrouter-key'), false);
    assert.equal(openRouterKeyConfigured('sk-or-v1-abc'), true);
  });

  it('decorates unavailable or-* models', () => {
    const models = [{ id: 'or-kimi-k3', label: 'Kimi K3' }, { id: 'groq-llama-8b', label: 'Groq' }];
    const out = decorateClaudeModels(models, { configured: false, ok: false });
    const kimi = out.find((m) => m.id === 'or-kimi-k3');
    const groq = out.find((m) => m.id === 'groq-llama-8b');
    assert.equal(kimi.available, false);
    assert.equal(groq.available, true);
  });

  it('formats auth errors', () => {
    const msg = formatAgentModelError(new Error('AuthenticationError Openrouter 401'), { model: 'or-kimi-k3' });
    assert.match(msg, /clé API manquante|OpenRouter/i);
  });
});
