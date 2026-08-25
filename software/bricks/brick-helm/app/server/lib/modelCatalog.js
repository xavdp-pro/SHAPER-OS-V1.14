/**
 * CLI model catalog for Helm-v2 (OpenCode + Antigravity + Cursor).
 */

export const OPENCODE_FREE_MODELS = [
  {
    id: 'opencode/nemotron-3.5-lightning-free',
    label: 'Nemotron 3.5 Lightning (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/nemotron-3.5-lightning-free'; },
  },
  {
    id: 'opencode/big-pickle',
    label: 'Big Pickle (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/big-pickle'; },
  },
  {
    id: 'opencode/hy3-free',
    label: 'HY3 (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/hy3-free'; },
  },
  {
    id: 'opencode/mimo-v2.5-free',
    label: 'Mimo V2.5 (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/mimo-v2.5-free'; },
  },
  {
    id: 'opencode/nemotron-3-ultra-free',
    label: 'Nemotron 3 Ultra (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/nemotron-3-ultra-free'; },
  },
  {
    id: 'opencode/muse-spark-1.2-contributor-free',
    label: 'Muse Spark 1.2 (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/muse-spark-1.2-contributor-free'; },
  },
  {
    id: 'opencode/x-preview-f-free',
    label: 'X-Preview (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/x-preview-f-free'; },
  },
  {
    id: 'deepseek/deepseek-chat',
    label: 'DeepSeek V3 (Direct)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'deepseek/deepseek-chat'; },
  },
  {
    id: 'deepseek/deepseek-reasoner',
    label: 'DeepSeek R1 Raisonnement',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'deepseek/deepseek-reasoner'; },
  },
  {
    id: 'opencode/laguna-s-2.1-free',
    label: 'Laguna S 2.1 (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/laguna-s-2.1-free'; },
  },
  {
    id: 'opencode/hy3-free',
    label: 'HY3 (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/hy3-free'; },
  },
  {
    id: 'opencode/big-pickle',
    label: 'Big Pickle (Gratuit)',
    engines: ['opencode'],
    efforts: ['full'],
    supportsFast: false,
    resolve() { return 'opencode/big-pickle'; },
  },
];

export const MODEL_FAMILIES = [
  ...OPENCODE_FREE_MODELS,
  {
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    engines: ['agy', 'cursor'],
    efforts: ['low', 'medium', 'high'],
    supportsFast: true,
    resolve({ effort = 'low' }) {
      const e = ['low', 'medium', 'high'].includes(effort) ? effort : 'low';
      return `gemini-3.7-flash-${e}`;
    },
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    engines: ['agy', 'cursor'],
    efforts: ['low', 'medium', 'high'],
    supportsFast: true,
    resolve({ effort = 'low' }) {
      const e = ['low', 'medium', 'high'].includes(effort) ? effort : 'low';
      return `gemini-3.6-flash-${e}`;
    },
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    engines: ['agy', 'cursor'],
    efforts: ['low', 'medium', 'high'],
    supportsFast: true,
    resolve({ effort = 'low' }) {
      const e = ['low', 'medium', 'high'].includes(effort) ? effort : 'low';
      return `gemini-3.5-flash-${e}`;
    },
  },
  {
    id: 'gemini-3.1-pro',
    label: 'Gemini 3.1 Pro',
    engines: ['agy', 'cursor'],
    efforts: ['low', 'high'],
    supportsFast: false,
    resolve({ effort = 'low' }) {
      return `gemini-3.1-pro-${effort === 'high' ? 'high' : 'low'}`;
    },
  },
  {
    id: 'grok-4.5',
    label: 'Grok 4.5',
    engines: ['cursor'],
    efforts: ['low', 'medium', 'high'],
    supportsFast: true,
    resolve({ effort = 'medium', fast = false }) {
      const e = ['low', 'medium', 'high'].includes(effort) ? effort : 'medium';
      return fast
        ? `cursor-grok-4.5-${e}-fast`
        : `cursor-grok-4.5-${e}`;
    },
  },
  {
    id: 'composer-2.5',
    label: 'Composer 2.5',
    engines: ['cursor'],
    efforts: ['full'],
    supportsFast: true,
    resolve({ fast = false }) {
      return fast ? 'composer-2.5-fast' : 'composer-2.5';
    },
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    engines: ['agy'],
    efforts: ['full'],
    supportsFast: false,
    resolve() {
      return 'claude-sonnet-4-6';
    },
  },
  {
    id: 'claude-opus-4-6-thinking',
    label: 'Claude Opus 4.6 Thinking',
    engines: ['agy'],
    efforts: ['full'],
    supportsFast: false,
    resolve() {
      return 'claude-opus-4-6-thinking';
    },
  },
  {
    id: 'gpt-oss-120b',
    label: 'GPT-OSS 120B',
    engines: ['agy'],
    efforts: ['medium'],
    supportsFast: false,
    resolve() {
      return 'gpt-oss-120b-medium';
    },
  },
];

export function modelFamiliesForPlugin(pluginId) {
  const raw = String(pluginId || process.env.DEFAULT_AGENT_PLUGIN || 'opencode').trim().toLowerCase();
  if (raw.startsWith('opencode')) {
    return OPENCODE_FREE_MODELS;
  }
  const engine = raw === 'cursor' ? 'cursor' : 'agy';
  return MODEL_FAMILIES.filter((f) => (f.engines || ['agy']).includes(engine));
}

export function publicModelFamilies(pluginId) {
  return modelFamiliesForPlugin(pluginId).map((f) => ({
    id: f.id,
    label: f.label,
    efforts: f.efforts,
    supportsFast: f.supportsFast,
  }));
}

export const CURSOR_MODEL_FAMILIES = MODEL_FAMILIES;

export const DEFAULT_MODEL = process.env.DEFAULT_OPENCODE_MODEL
  || process.env.OPENCODE_MODEL
  || process.env.DEFAULT_AGY_MODEL
  || process.env.DEFAULT_MODEL
  || 'groq/llama-3.3-70b-versatile';

export const DEFAULT_CURSOR_MODEL = DEFAULT_MODEL;

/** Parse stored settings into a concrete CLI --model id. */
export function resolveCursorModelId({
  family = DEFAULT_MODEL,
  effort = 'low',
  fast = false,
  modelId = '',
} = {}) {
  const explicit = String(modelId || '').trim();
  if (explicit) return explicit;
  const fam = MODEL_FAMILIES.find((f) => f.id === family)
    || MODEL_FAMILIES.find((f) => f.id === DEFAULT_MODEL)
    || MODEL_FAMILIES[0];
  return fam.resolve({ effort, fast });
}

export function describeCursorModel(modelId) {
  const id = String(modelId || '').trim();
  const opencodeMatch = OPENCODE_FREE_MODELS.find((m) => m.id === id);
  if (opencodeMatch) {
    return {
      family: opencodeMatch.id,
      effort: 'full',
      fast: opencodeMatch.supportsFast,
      modelId: opencodeMatch.id,
      label: opencodeMatch.label,
    };
  }
  if (!id || id === 'opencode/nemotron-3-ultra-free') {
    return {
      family: 'opencode/nemotron-3-ultra-free',
      effort: 'full',
      fast: false,
      modelId: 'opencode/nemotron-3-ultra-free',
      label: 'Nemotron 3 Ultra (Gratuit)',
    };
  }
  if (id === 'gemini-3.7-flash-low' || id === 'gemini-3.7-flash') {
    return {
      family: 'gemini-3.7-flash',
      effort: 'low',
      fast: true,
      modelId: 'gemini-3.7-flash-low',
      label: 'Gemini 3.7 Flash · Low',
    };
  }
  const gm = id.match(/^gemini-(3\.[1567]-(?:flash|pro))-(low|medium|high)$/);
  if (gm) {
    const famId = `gemini-${gm[1]}`;
    return {
      family: famId,
      effort: gm[2],
      fast: famId.includes('flash'),
      modelId: id,
      label: `Gemini ${gm[1].replace('-', ' ')} · ${gm[2]}`,
    };
  }
  const m = id.match(/^cursor-grok-4\.5-(low|medium|high)(-fast)?$/);
  if (m) {
    return {
      family: 'grok-4.5',
      effort: m[1],
      fast: Boolean(m[2]),
      modelId: id,
      label: `Grok 4.5 · ${m[1]}${m[2] ? ' · fast' : ''}`,
    };
  }
  if (id === 'composer-2.5-fast') {
    return { family: 'composer-2.5', effort: 'full', fast: true, modelId: id, label: 'Composer 2.5 Fast' };
  }
  if (id === 'composer-2.5') {
    return {
      family: 'composer-2.5',
      effort: 'full',
      fast: false,
      modelId: id || 'composer-2.5',
      label: 'Composer 2.5',
    };
  }
  if (id === 'claude-sonnet-4-6') {
    return { family: 'claude-sonnet-4-6', effort: 'full', fast: false, modelId: id, label: 'Claude Sonnet 4.6' };
  }
  if (id === 'claude-opus-4-6-thinking') {
    return { family: 'claude-opus-4-6-thinking', effort: 'full', fast: false, modelId: id, label: 'Claude Opus 4.6 Thinking' };
  }
  if (id === 'gpt-oss-120b-medium' || id === 'gpt-oss-120b') {
    return { family: 'gpt-oss-120b', effort: 'medium', fast: false, modelId: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B · medium' };
  }
  return { family: id, effort: 'full', fast: false, modelId: id, label: id };
}
