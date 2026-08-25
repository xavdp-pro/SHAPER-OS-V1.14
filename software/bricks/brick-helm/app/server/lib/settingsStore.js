import { query } from './db.js';
import { LOCALES, normalizeLocale } from './locale.js';
import { DEFAULT_VOICES, envVoiceIdForLocale } from './elevenlabsVoices.js';
import {
  DEFAULT_MODEL,
  DEFAULT_CURSOR_MODEL,
  describeCursorModel,
  resolveCursorModelId,
  MODEL_FAMILIES,
  publicModelFamilies,
  modelFamiliesForPlugin,
} from './modelCatalog.js';

export const DEFAULT_AGENT_NAME = 'Zephir';
export const DEFAULT_APP_NAME = 'KovZu';
export const COMPOSER_MODEL_FAST = 'gemini-3.7-flash-low';
export const COMPOSER_MODEL_FULL = 'gemini-3.7-flash-low';

export function composerModelForFast(fast) {
  return 'gemini-3.7-flash-low';
}

export async function ensureSettingsSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      \`setting_key\` VARCHAR(100) NOT NULL PRIMARY KEY,
      \`setting_value\` LONGTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

const AGENT_NAME_KEY = 'agent_name';
const APP_NAME_KEY = 'app_name';
const COMPOSER_FAST_KEY = 'composer_fast';
const MODEL_FAMILY_KEY = 'model_family';
const MODEL_EFFORT_KEY = 'model_effort';
const MODEL_FAST_KEY = 'model_fast';
const AGENT_PLUGIN_KEY = 'agent_plugin';
const ENABLED_PLUGINS_KEY = 'enabled_plugins';
const CLAUDE_MODEL_KEY = 'claude_model';
const CLAUDE_THINKING_KEY = 'claude_thinking';
const DEFAULT_CLAUDE_MODEL = process.env.DEFAULT_CLAUDE_MODEL || 'or-kimi-k3';
const CLAUDE_THINKING_MODES = ['auto', 'on', 'off'];
const DEFAULT_CLAUDE_THINKING = 'auto';
const MAX_AGENT_NAME = 40;
const MAX_APP_NAME = 40;
const VOICE_KEY = (lang) => `voice_id_${normalizeLocale(lang)}`;
const TTS_PROVIDER_KEY = 'tts_provider';
const TTS_PROVIDERS = new Set(['cartesia', 'deepgram', 'elevenlabs']);

const DEFAULT_ENGINE_MODELS = {
  opencode: process.env.OPENCODE_MODEL || 'groq/llama-3.3-70b-versatile',
  agy: 'gemini-3.7-flash',
  cursor: 'composer-2.5',
  claude: 'claude-3-7-sonnet',
};
const DEFAULT_MODEL_KEY = (engine) => `default_model_${String(engine || '').toLowerCase().trim()}`;

const DEFAULT_ENABLED_PLUGINS = { opencode: true, agy: true, cursor: true };

const defaultDesc = describeCursorModel(DEFAULT_MODEL || DEFAULT_CURSOR_MODEL);

let cache = {
  agentName: DEFAULT_AGENT_NAME,
  appName: DEFAULT_APP_NAME,
  composerFast: true,
  modelFamily: defaultDesc.family,
  modelEffort: defaultDesc.effort || 'low',
  modelFast: Boolean(defaultDesc.fast),
  agentPlugin: process.env.DEFAULT_AGENT_PLUGIN || 'opencode',
  enabledPlugins: { ...DEFAULT_ENABLED_PLUGINS },
  claudeModel: DEFAULT_CLAUDE_MODEL,
  claudeThinking: DEFAULT_CLAUDE_THINKING,
  defaultModels: { ...DEFAULT_ENGINE_MODELS },
  voices: { ...DEFAULT_VOICES },
  ttsProvider: '',
  loadedAt: 0,
};
const CACHE_MS = 3000;

export function normalizeAgentName(raw) {
  const name = String(raw || '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_AGENT_NAME);
  return name || DEFAULT_AGENT_NAME;
}

export function normalizeAppName(raw) {
  const name = String(raw || '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_APP_NAME);
  return name || DEFAULT_APP_NAME;
}

export function normalizeComposerFast(raw) {
  if (typeof raw === 'boolean') return raw;
  const s = String(raw || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function normalizeVoiceId(raw) {
  const v = String(raw || '').trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(v) ? v : '';
}

export function normalizeTtsProvider(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return TTS_PROVIDERS.has(v) ? v : '';
}

/** Sync read for TTS routing — empty means fall back to env / auto. */
export function getTtsProviderSync() {
  return normalizeTtsProvider(cache.ttsProvider);
}

export function normalizeEnabledPlugins(raw, knownKeys = ['opencode', 'agy', 'cursor']) {
  if (!raw) return { ...DEFAULT_ENABLED_PLUGINS };
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_ENABLED_PLUGINS };
    }
  }
  if (!obj || typeof obj !== 'object') return { ...DEFAULT_ENABLED_PLUGINS };
  const out = {};
  for (const k of knownKeys) {
    if (k === 'claude') continue;
    out[k] = obj[k] !== false;
  }
  if (Object.values(out).every((v) => v === false)) {
    out[knownKeys[0] || 'opencode'] = true;
  }
  return out;
}

async function getSetting(key) {
  try {
    const rows = await query('SELECT `setting_value` as `value` FROM app_settings WHERE `setting_key` = ? LIMIT 1', [key]);
    if (rows?.[0]) return rows[0].value;
  } catch (err) {
    console.error('[getSetting] error:', err.message);
  }
  return null;
}

async function setSetting(key, value) {
  const strVal = String(value ?? '');
  await query(
    'INSERT INTO app_settings (`setting_key`, `setting_value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`)',
    [key, strVal],
  );
}

async function loadCache({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.loadedAt && now - cache.loadedAt < CACHE_MS) return cache;
  try {
    const rawAgent = await getSetting(AGENT_NAME_KEY);
    const agentName = normalizeAgentName(rawAgent);
    const rawApp = await getSetting(APP_NAME_KEY);
    const appName = normalizeAppName(rawApp);
    const rawFast = await getSetting(COMPOSER_FAST_KEY);
    const composerFast = rawFast == null ? defaultDesc.fast : normalizeComposerFast(rawFast);
    const rawFamily = await getSetting(MODEL_FAMILY_KEY);
    const modelFamily = rawFamily ? String(rawFamily).trim() : defaultDesc.family;
    const rawEffort = await getSetting(MODEL_EFFORT_KEY);
    const modelEffort = rawEffort ? String(rawEffort).trim() : (defaultDesc.effort || 'low');
    const rawModelFast = await getSetting(MODEL_FAST_KEY);
    const modelFast = rawModelFast != null ? normalizeComposerFast(rawModelFast) : composerFast;
    const agentPlugin = (await getSetting(AGENT_PLUGIN_KEY)) || process.env.DEFAULT_AGENT_PLUGIN || 'opencode';
    const rawClaudeModel = await getSetting(CLAUDE_MODEL_KEY);
    const claudeModel = rawClaudeModel ? String(rawClaudeModel).trim() : DEFAULT_CLAUDE_MODEL;
    const rawClaudeThinking = await getSetting(CLAUDE_THINKING_KEY);
    const claudeThinking = normalizeClaudeThinking(rawClaudeThinking);
    const enabledPlugins = normalizeEnabledPlugins(await getSetting(ENABLED_PLUGINS_KEY));
    const ttsProvider = normalizeTtsProvider(await getSetting(TTS_PROVIDER_KEY));
    const voices = {};
    for (const lang of LOCALES) {
      const stored = normalizeVoiceId(await getSetting(VOICE_KEY(lang)));
      voices[lang] = stored || envVoiceIdForLocale(lang);
    }
    const defaultModels = { ...DEFAULT_ENGINE_MODELS };
    for (const eng of Object.keys(DEFAULT_ENGINE_MODELS)) {
      const stored = await getSetting(DEFAULT_MODEL_KEY(eng));
      if (stored && typeof stored === 'string' && stored.trim()) {
        defaultModels[eng] = stored.trim();
      }
    }
    cache = {
      agentName, appName, composerFast, modelFamily, modelEffort, modelFast,
      agentPlugin, enabledPlugins, claudeModel, claudeThinking, defaultModels, voices, ttsProvider, loadedAt: now,
    };
  } catch {
    if (!cache.loadedAt) {
      cache = {
        agentName: DEFAULT_AGENT_NAME,
        appName: DEFAULT_APP_NAME,
        composerFast: true,
        modelFamily: defaultDesc.family,
        modelEffort: defaultDesc.effort || 'low',
        modelFast: Boolean(defaultDesc.fast),
        agentPlugin: process.env.DEFAULT_AGENT_PLUGIN || 'opencode',
        enabledPlugins: { ...DEFAULT_ENABLED_PLUGINS },
        claudeModel: DEFAULT_CLAUDE_MODEL,
        claudeThinking: DEFAULT_CLAUDE_THINKING,
        defaultModels: { ...DEFAULT_ENGINE_MODELS },
        voices: { ...DEFAULT_VOICES },
        ttsProvider: '',
        loadedAt: now,
      };
    }
  }
  return cache;
}

export async function getAgentName({ force = false } = {}) {
  const c = await loadCache({ force });
  return c.agentName;
}

export async function setAgentName(raw) {
  const name = normalizeAgentName(raw);
  await setSetting(AGENT_NAME_KEY, name);
  cache = { ...cache, agentName: name, loadedAt: Date.now() };
  return name;
}

export async function getAppName({ force = false } = {}) {
  const c = await loadCache({ force });
  return c.appName;
}

export async function setAppName(raw) {
  const name = normalizeAppName(raw);
  await setSetting(APP_NAME_KEY, name);
  cache = { ...cache, appName: name, loadedAt: Date.now() };
  return name;
}

export async function getVoiceIds({ force = false } = {}) {
  const c = await loadCache({ force });
  return { ...c.voices };
}

export async function getVoiceIdForLocale(locale, { force = false } = {}) {
  const lang = normalizeLocale(locale);
  const voices = await getVoiceIds({ force });
  return voices[lang] || envVoiceIdForLocale(lang);
}

export async function setVoiceIds(partial = {}) {
  const next = await getVoiceIds({ force: true });
  for (const lang of LOCALES) {
    if (partial[lang] == null && partial[`voiceId${lang.toUpperCase()}`] == null) continue;
    const raw = partial[lang] ?? partial[`voiceId${lang.toUpperCase()}`];
    const id = normalizeVoiceId(raw);
    if (!id) {
      throw new Error(`Invalid voice ID for ${lang}`);
    }
    await setSetting(VOICE_KEY(lang), id);
    next[lang] = id;
  }
  cache = { ...cache, voices: next, loadedAt: Date.now() };
  return { ...next };
}

export async function getComposerFast({ force = false } = {}) {
  const c = await loadCache({ force });
  return Boolean(c.composerFast);
}

export async function setComposerFast(raw) {
  const fast = normalizeComposerFast(raw);
  await setSetting(COMPOSER_FAST_KEY, fast ? '1' : '0');
  cache = { ...cache, composerFast: fast, loadedAt: Date.now() };
  return fast;
}

export async function getComposerModel({ force = false } = {}) {
  const c = await loadCache({ force });
  const families = modelFamiliesForPlugin(c.agentPlugin);
  const family = families.some((f) => f.id === c.modelFamily)
    ? c.modelFamily
    : (families[0]?.id || 'gemini-3.7-flash');
  return resolveCursorModelId({
    family,
    effort: c.modelEffort,
    fast: c.modelFast,
  });
}

export async function setModelSelection({ family, effort, fast } = {}) {
  const c = await loadCache({ force: true });
  const nextFamily = family != null ? String(family).trim() : c.modelFamily;
  const nextEffort = effort != null ? String(effort).trim() : c.modelEffort;
  const nextFast = fast != null ? normalizeComposerFast(fast) : c.modelFast;
  await setSetting(MODEL_FAMILY_KEY, nextFamily);
  await setSetting(MODEL_EFFORT_KEY, nextEffort);
  await setSetting(MODEL_FAST_KEY, nextFast ? '1' : '0');
  if (nextFamily === 'composer-2.5') {
    await setSetting(COMPOSER_FAST_KEY, nextFast ? '1' : '0');
  }
  cache = {
    ...cache,
    modelFamily: nextFamily,
    modelEffort: nextEffort,
    modelFast: nextFast,
    composerFast: nextFamily === 'composer-2.5' ? nextFast : cache.composerFast,
    loadedAt: Date.now(),
  };
  const modelId = resolveCursorModelId({ family: nextFamily, effort: nextEffort, fast: nextFast });
  return { ...describeCursorModel(modelId), modelId };
}

export async function setAgentPlugin(raw) {
  const id = String(raw || 'agy').trim() || 'agy';
  const enabled = await getEnabledPlugins();
  if (enabled[id] === false) {
    throw new Error(`CLI « ${id} » is disabled in admin`);
  }
  await setSetting(AGENT_PLUGIN_KEY, id);
  cache = { ...cache, agentPlugin: id, loadedAt: Date.now() };
  return id;
}

export async function getEnabledPlugins({ force = false } = {}) {
  const c = await loadCache({ force });
  return normalizeEnabledPlugins(c.enabledPlugins || DEFAULT_ENABLED_PLUGINS);
}

/**
 * @param {Record<string, boolean>} partial
 * @returns {Promise<{ enabledPlugins: Record<string, boolean>, agentPlugin: string }>}
 */
export async function setEnabledPlugins(partial) {
  const current = await getEnabledPlugins({ force: true });
  const known = Object.keys({ ...DEFAULT_ENABLED_PLUGINS, ...current, ...(partial || {}) });
  const next = normalizeEnabledPlugins({ ...current, ...(partial || {}) }, known);
  await setSetting(ENABLED_PLUGINS_KEY, JSON.stringify(next));

  let agentPlugin = cache.agentPlugin || 'opencode';
  if (next[agentPlugin] === false) {
    const fallback = known.find((id) => next[id]) || 'opencode';
    await setSetting(AGENT_PLUGIN_KEY, fallback);
    agentPlugin = fallback;
  }

  cache = {
    ...cache,
    enabledPlugins: next,
    agentPlugin,
    loadedAt: Date.now(),
  };
  return { enabledPlugins: next, agentPlugin };
}

export function normalizeClaudeThinking(raw) {
  const v = String(raw || DEFAULT_CLAUDE_THINKING).trim().toLowerCase();
  return CLAUDE_THINKING_MODES.includes(v) ? v : DEFAULT_CLAUDE_THINKING;
}

export async function getClaudeThinking({ force = false } = {}) {
  const c = await loadCache({ force });
  return normalizeClaudeThinking(c.claudeThinking);
}

export async function setClaudeThinking(raw) {
  const mode = normalizeClaudeThinking(raw);
  await setSetting(CLAUDE_THINKING_KEY, mode);
  cache = { ...cache, claudeThinking: mode, loadedAt: Date.now() };
  return mode;
}

export async function getClaudeModel({ force = false } = {}) {
  const c = await loadCache({ force });
  return c.claudeModel || DEFAULT_CLAUDE_MODEL;
}

export async function setClaudeModel(raw) {
  const id = String(raw || DEFAULT_CLAUDE_MODEL).trim() || DEFAULT_CLAUDE_MODEL;
  await setSetting(CLAUDE_MODEL_KEY, id);
  cache = { ...cache, claudeModel: id, loadedAt: Date.now() };
  return id;
}

export async function getTtsProvider({ force = false } = {}) {
  const c = await loadCache({ force });
  return normalizeTtsProvider(c.ttsProvider);
}

export async function setTtsProvider(raw) {
  const id = normalizeTtsProvider(raw);
  if (!id) throw new Error('Invalid TTS engine (cartesia, deepgram or elevenlabs)');
  await setSetting(TTS_PROVIDER_KEY, id);
  cache = { ...cache, ttsProvider: id, loadedAt: Date.now() };
  return id;
}

export async function getDefaultEngineModels({ force = false } = {}) {
  const c = await loadCache({ force });
  return { ...DEFAULT_ENGINE_MODELS, ...(c.defaultModels || {}) };
}

export async function setDefaultEngineModel(engine, modelId) {
  const eng = String(engine || '').toLowerCase().trim();
  const mod = String(modelId || '').trim();
  if (!eng || !mod) throw new Error('engine and modelId required');
  await ensureSettingsSchema();
  await setSetting(DEFAULT_MODEL_KEY(eng), mod);
  cache = {
    ...cache,
    defaultModels: { ...(cache.defaultModels || DEFAULT_ENGINE_MODELS), [eng]: mod },
    loadedAt: Date.now(),
  };
  return { ok: true, engine: eng, model: mod };
}

export async function getSettings() {
  const c = await loadCache({ force: true });
  const composerModel = resolveCursorModelId({
    family: c.modelFamily,
    effort: c.modelEffort,
    fast: c.modelFast,
  });
  const enabledPlugins = normalizeEnabledPlugins(c.enabledPlugins || DEFAULT_ENABLED_PLUGINS);
  let agentPlugin = c.agentPlugin;
  if (enabledPlugins[agentPlugin] === false) {
    agentPlugin = Object.keys(enabledPlugins).find((id) => enabledPlugins[id]) || 'opencode';
  }
  return {
    agentName: c.agentName,
    appName: c.appName,
    composerFast: Boolean(c.modelFast),
    composerModel,
    modelFamily: c.modelFamily,
    modelEffort: c.modelEffort,
    modelFast: Boolean(c.modelFast),
    modelLabel: describeCursorModel(composerModel).label,
    modelFamilies: publicModelFamilies(agentPlugin),
    agentPlugin,
    enabledPlugins,
    claudeModel: c.claudeModel || DEFAULT_CLAUDE_MODEL,
    claudeThinking: normalizeClaudeThinking(c.claudeThinking),
    defaultModels: { ...DEFAULT_ENGINE_MODELS, ...(c.defaultModels || {}) },
    voices: { ...c.voices },
    ttsProvider: normalizeTtsProvider(c.ttsProvider),
  };
}
