import { normalizeLocale, LOCALES } from './locale.js';

/**
 * Deepgram Aura-2 model ids = voice ids (format aura-2-{name}-{lang}).
 * @see https://developers.deepgram.com/docs/tts-models
 */
export const DEEPGRAM_DEFAULT_VOICES = {
  fr: 'aura-2-agathe-fr',
  es: 'aura-2-nestor-es',
  en: 'aura-2-thalia-en',
};

export const DEEPGRAM_TTS_MODEL_FAMILY = process.env.DEEPGRAM_TTS_MODEL?.trim() || 'aura-2';

export function deepgramTtsSpeed() {
  const envSpeed = parseFloat(process.env.DEEPGRAM_TTS_SPEED || '');
  if (!Number.isNaN(envSpeed) && envSpeed >= 0.7 && envSpeed <= 1.5) {
    return String(envSpeed);
  }
  return '1.06';
}

export function deepgramSttModel() {
  return process.env.DEEPGRAM_STT_MODEL?.trim() || 'nova-3';
}

/** Static catalog (official Aura-2 voices for Helm locales). */
export const DEEPGRAM_VOICE_CATALOG = [
  // French
  { voiceId: 'aura-2-agathe-fr', name: 'Agathe', language: 'fr', gender: 'feminine', accent: 'French', description: 'Charismatic, cheerful, friendly' },
  { voiceId: 'aura-2-hector-fr', name: 'Hector', language: 'fr', gender: 'masculine', accent: 'French', description: 'Confident, empathetic, patient' },
  // Spanish
  { voiceId: 'aura-2-nestor-es', name: 'Nestor', language: 'es', gender: 'masculine', accent: 'Peninsular', description: 'Calm, professional, clear' },
  { voiceId: 'aura-2-celeste-es', name: 'Celeste', language: 'es', gender: 'feminine', accent: 'Colombian', description: 'Clear, energetic, friendly' },
  { voiceId: 'aura-2-estrella-es', name: 'Estrella', language: 'es', gender: 'feminine', accent: 'Mexican', description: 'Approachable, natural, calm' },
  { voiceId: 'aura-2-sirio-es', name: 'Sirio', language: 'es', gender: 'masculine', accent: 'Mexican', description: 'Calm, professional, empathetic' },
  { voiceId: 'aura-2-carina-es', name: 'Carina', language: 'es', gender: 'feminine', accent: 'Peninsular', description: 'Professional, energetic' },
  { voiceId: 'aura-2-alvaro-es', name: 'Alvaro', language: 'es', gender: 'masculine', accent: 'Peninsular', description: 'Calm, knowledgeable' },
  { voiceId: 'aura-2-diana-es', name: 'Diana', language: 'es', gender: 'feminine', accent: 'Peninsular', description: 'Professional, expressive' },
  { voiceId: 'aura-2-aquila-es', name: 'Aquila', language: 'es', gender: 'masculine', accent: 'Latin American', description: 'Expressive, enthusiastic' },
  { voiceId: 'aura-2-selena-es', name: 'Selena', language: 'es', gender: 'feminine', accent: 'Latin American', description: 'Approachable, friendly' },
  { voiceId: 'aura-2-javier-es', name: 'Javier', language: 'es', gender: 'masculine', accent: 'Mexican', description: 'Friendly, professional' },
  { voiceId: 'aura-2-agustina-es', name: 'Agustina', language: 'es', gender: 'feminine', accent: 'Peninsular', description: 'Calm, expressive' },
  { voiceId: 'aura-2-antonia-es', name: 'Antonia', language: 'es', gender: 'feminine', accent: 'Argentine', description: 'Enthusiastic, friendly' },
  { voiceId: 'aura-2-gloria-es', name: 'Gloria', language: 'es', gender: 'feminine', accent: 'Colombian', description: 'Casual, smooth' },
  { voiceId: 'aura-2-luciano-es', name: 'Luciano', language: 'es', gender: 'masculine', accent: 'Mexican', description: 'Charismatic, energetic' },
  { voiceId: 'aura-2-olivia-es', name: 'Olivia', language: 'es', gender: 'feminine', accent: 'Mexican', description: 'Warm, casual' },
  { voiceId: 'aura-2-silvia-es', name: 'Silvia', language: 'es', gender: 'feminine', accent: 'Peninsular', description: 'Charismatic, warm' },
  { voiceId: 'aura-2-valerio-es', name: 'Valerio', language: 'es', gender: 'masculine', accent: 'Mexican', description: 'Deep, professional' },
  // English (featured + common)
  { voiceId: 'aura-2-thalia-en', name: 'Thalia', language: 'en', gender: 'feminine', accent: 'American', description: 'Clear, confident, energetic' },
  { voiceId: 'aura-2-andromeda-en', name: 'Andromeda', language: 'en', gender: 'feminine', accent: 'American', description: 'Casual, expressive' },
  { voiceId: 'aura-2-helena-en', name: 'Helena', language: 'en', gender: 'feminine', accent: 'American', description: 'Caring, natural, friendly' },
  { voiceId: 'aura-2-apollo-en', name: 'Apollo', language: 'en', gender: 'masculine', accent: 'American', description: 'Confident, casual' },
  { voiceId: 'aura-2-arcas-en', name: 'Arcas', language: 'en', gender: 'masculine', accent: 'American', description: 'Natural, smooth, clear' },
  { voiceId: 'aura-2-aries-en', name: 'Aries', language: 'en', gender: 'masculine', accent: 'American', description: 'Warm, energetic' },
  { voiceId: 'aura-2-asteria-en', name: 'Asteria', language: 'en', gender: 'feminine', accent: 'American', description: 'Clear, knowledgeable' },
  { voiceId: 'aura-2-athena-en', name: 'Athena', language: 'en', gender: 'feminine', accent: 'American', description: 'Calm, professional' },
  { voiceId: 'aura-2-atlas-en', name: 'Atlas', language: 'en', gender: 'masculine', accent: 'American', description: 'Enthusiastic, friendly' },
  { voiceId: 'aura-2-draco-en', name: 'Draco', language: 'en', gender: 'masculine', accent: 'British', description: 'Warm, trustworthy' },
  { voiceId: 'aura-2-harmonia-en', name: 'Harmonia', language: 'en', gender: 'feminine', accent: 'American', description: 'Empathetic, calm' },
  { voiceId: 'aura-2-hermes-en', name: 'Hermes', language: 'en', gender: 'masculine', accent: 'American', description: 'Expressive, professional' },
  { voiceId: 'aura-2-hyperion-en', name: 'Hyperion', language: 'en', gender: 'masculine', accent: 'Australian', description: 'Caring, warm' },
  { voiceId: 'aura-2-luna-en', name: 'Luna', language: 'en', gender: 'feminine', accent: 'American', description: 'Friendly, engaging' },
  { voiceId: 'aura-2-orpheus-en', name: 'Orpheus', language: 'en', gender: 'masculine', accent: 'American', description: 'Professional, clear' },
  { voiceId: 'aura-2-pandora-en', name: 'Pandora', language: 'en', gender: 'feminine', accent: 'British', description: 'Smooth, calm' },
  { voiceId: 'aura-2-theia-en', name: 'Theia', language: 'en', gender: 'feminine', accent: 'Australian', description: 'Expressive, polite' },
  { voiceId: 'aura-2-zeus-en', name: 'Zeus', language: 'en', gender: 'masculine', accent: 'American', description: 'Deep, trustworthy' },
];

export function deepgramConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY?.trim());
}

export function deepgramApiKey() {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) throw new Error('DEEPGRAM_API_KEY not configured');
  return key;
}

export function deepgramTtsModelFamily() {
  return DEEPGRAM_TTS_MODEL_FAMILY;
}

export function looksLikeDeepgramVoiceId(id) {
  return /^aura-(?:1|2)-[a-z0-9]+-[a-z]{2}$/i.test(String(id || '').trim());
}

export function envDeepgramVoiceIdForLocale(locale) {
  const lang = normalizeLocale(locale);
  const fromEnv = process.env[`DEEPGRAM_VOICE_ID_${lang.toUpperCase()}`]?.trim();
  if (fromEnv && looksLikeDeepgramVoiceId(fromEnv)) return fromEnv.toLowerCase();
  return DEEPGRAM_DEFAULT_VOICES[lang] || DEEPGRAM_DEFAULT_VOICES.en;
}

/** Strip [emotion] tags — Aura has no Sonic-style emotion API. */
export function stripDeepgramTags(text) {
  return String(text || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const DEEPGRAM_TEST_SCRIPTS = {
  fr: [
    'Bonjour. Je suis l’assistant vocal KovZu.',
    'Tu entends bien la ponctuation ? Points… virgules, points d’interrogation ?',
    'Parfait ! On avance.',
    'Dis-moi ce que tu veux changer.',
    'Merci — je suis là.',
  ].join('\n\n'),
  es: [
    'Hola. Soy el asistente de voz de KovZu.',
    '¿Se oye bien la puntuación? Puntos… comas, ¿signos de interrogación?',
    '¡Perfecto! Seguimos.',
    'Dime qué quieres cambiar.',
    'Gracias — aquí estoy.',
  ].join('\n\n'),
  en: [
    'Hello. I am the KovZu voice assistant.',
    'Can you hear the punctuation clearly? Periods… commas, question marks?',
    'Perfect! Let’s keep going.',
    'Tell me what you want to change.',
    'Thanks — I’m here.',
  ].join('\n\n'),
};

export const DEEPGRAM_QUICK_TEST = {
  fr: 'Bonjour. Test Deepgram Aura KovZu !',
  es: 'Hola. ¡Prueba Deepgram Aura KovZu!',
  en: 'Hello. KovZu Deepgram Aura voice test!',
};

export function deepgramTestScriptForLocale(locale) {
  const lang = normalizeLocale(locale);
  return DEEPGRAM_TEST_SCRIPTS[lang] || DEEPGRAM_TEST_SCRIPTS.fr;
}

export function deepgramQuickTestForLocale(locale) {
  const lang = normalizeLocale(locale);
  return DEEPGRAM_QUICK_TEST[lang] || DEEPGRAM_QUICK_TEST.fr;
}

export function deepgramVoiceMapStatus(overrides = {}) {
  const map = {};
  for (const lang of LOCALES) {
    map[lang] = overrides[lang] || envDeepgramVoiceIdForLocale(lang);
  }
  return { ...map, model: deepgramTtsModelFamily() };
}

export function listDeepgramVoiceCatalog(opts = {}) {
  const lang = opts.language ? normalizeLocale(opts.language) : null;
  return DEEPGRAM_VOICE_CATALOG
    .filter((v) => !lang || v.language === lang)
    .map((v) => ({
      voiceId: v.voiceId,
      name: v.name,
      category: 'public',
      description: v.description || '',
      previewUrl: null,
      labels: { language: v.language, gender: v.gender, accent: v.accent },
      gender: v.gender,
      accent: v.accent,
      language: v.language,
      verifiedLanguages: [],
      verifiedLangCodes: [v.language],
      apiFreeTierOk: true,
      provider: 'deepgram',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
