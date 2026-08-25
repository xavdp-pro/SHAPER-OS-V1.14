import { normalizeLocale, LOCALES } from './locale.js';

/**
 * Defaults — overridden by DB settings then env.
 * Free tier API: only category=premade works. Library/professional voices → 402.
 * FR/ES speech on premades: use language_code + [French accent] / [Spanish accent].
 */
export const DEFAULT_VOICES = {
  fr: 'XrExE9yKIg1WjnnlVkGX', // Matilda (premade, verified FR)
  es: 'pFZP5JQG7iQjIQuC4Bku', // Lily (premade)
  en: 'JBFqnCBsd6RMkjVDRZzb', // George (premade EN)
};

const ACCENT_PREFIX = {
  fr: '[French accent]',
  es: '[Spanish accent]',
  en: '',
};

/** Demo scripts with punctuation + ElevenLabs v3 emotion tags. */
export const VOICE_TEST_SCRIPTS = {
  fr: '[calm] Bonjour. Je suis l’assistant vocal KovZu.\n\n[curious] Tu entends bien la ponctuation ? Points… virgules, points d’interrogation ?\n\n[excited] Parfait ! [laughs] On peut même rire un peu.\n\n[emphatic] Dis-moi ce que tu veux changer — [whispers] ou chuchoter si tu préfères.',
  es: '[calm] Hola. Soy el asistente de voz de KovZu.\n\n[curious] ¿Se oye bien la puntuación? Puntos… comas, ¿signos de interrogación?\n\n[excited] ¡Perfecto! [laughs] Incluso podemos reír un poco.\n\n[emphatic] Dime qué quieres cambiar — [whispers] o susurrar si prefieres.',
  en: '[calm] Hello. I am the KovZu voice assistant.\n\n[curious] Can you hear the punctuation clearly? Periods… commas, question marks?\n\n[excited] Perfect! [laughs] We can even laugh a little.\n\n[emphatic] Tell me what you want to change — [whispers] or whisper if you prefer.',
};

/** Short lines for admin “Tester” — small payload, fast feedback. */
export const VOICE_QUICK_TEST = {
  fr: '[calm] Bonjour. [excited] Test de la voix KovZu !',
  es: '[calm] Hola. [excited] ¡Prueba de voz KovZu!',
  en: '[calm] Hello. [excited] KovZu voice test!',
};

export function elevenLabsTtsModel() {
  return process.env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_v3';
}

export function envVoiceIdForLocale(locale) {
  const lang = normalizeLocale(locale);
  const envKey = `ELEVENLABS_VOICE_ID_${lang.toUpperCase()}`;
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.ELEVENLABS_VOICE_ID?.trim() && lang === 'en') {
    return process.env.ELEVENLABS_VOICE_ID.trim();
  }
  return DEFAULT_VOICES[lang] || DEFAULT_VOICES.fr;
}

/** Sync fallback (env/defaults) — prefer getVoiceIdForLocale from settings. */
export function voiceIdForLocale(locale) {
  return envVoiceIdForLocale(locale);
}

export function ensureLocaleAccent(text, locale) {
  const lang = normalizeLocale(locale);
  const raw = String(text || '').trim();
  if (!raw) return raw;
  const prefix = ACCENT_PREFIX[lang];
  if (!prefix) return raw;
  if (/\[[^\]]*(accent|french|spanish|español|francais|français)[^\]]*\]/i.test(raw)) {
    return raw;
  }
  return `${prefix} ${raw}`;
}

export function voiceMapStatus(overrides = {}) {
  const map = {};
  for (const lang of LOCALES) {
    map[lang] = overrides[lang] || envVoiceIdForLocale(lang);
  }
  return { ...map, model: elevenLabsTtsModel() };
}

export function testScriptForLocale(locale) {
  const lang = normalizeLocale(locale);
  return VOICE_TEST_SCRIPTS[lang] || VOICE_TEST_SCRIPTS.fr;
}

export function quickTestForLocale(locale) {
  const lang = normalizeLocale(locale);
  return VOICE_QUICK_TEST[lang] || VOICE_QUICK_TEST.fr;
}
