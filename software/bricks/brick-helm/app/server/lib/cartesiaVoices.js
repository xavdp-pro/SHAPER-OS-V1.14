import { normalizeLocale, LOCALES } from './locale.js';

/** Default Cartesia public voices (native language). */
export const CARTESIA_DEFAULT_VOICES = {
  fr: '0418348a-0ca2-4e90-9986-800fb8b3bbc0', // Antoine
  es: '15d0c2e2-8d29-44c3-be23-d585d5f154a1', // Pedro
  en: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', // Skylar
};

export const CARTESIA_API_VERSION = '2026-03-01';
export const CARTESIA_TTS_MODEL = process.env.CARTESIA_TTS_MODEL?.trim() || 'sonic-3.5';

/**
 * Official Sonic emotions (generation_config.emotion / SSML).
 * @see https://docs.cartesia.ai/build-with-cartesia/sonic-3/volume-speed-emotion
 */
export const CARTESIA_EMOTIONS = [
  'neutral', 'happy', 'excited', 'enthusiastic', 'elated', 'euphoric', 'triumphant',
  'amazed', 'surprised', 'flirtatious', 'curious', 'content', 'peaceful', 'serene',
  'calm', 'grateful', 'affectionate', 'trust', 'sympathetic', 'anticipation', 'mysterious',
  'angry', 'mad', 'outraged', 'frustrated', 'agitated', 'threatened', 'disgusted',
  'contempt', 'envious', 'sarcastic', 'ironic', 'sad', 'dejected', 'melancholic',
  'disappointed', 'hurt', 'guilty', 'bored', 'tired', 'rejected', 'nostalgic', 'wistful',
  'apologetic', 'hesitant', 'insecure', 'confused', 'resigned', 'anxious', 'panicked',
  'alarmed', 'scared', 'proud', 'confident', 'distant', 'skeptical', 'contemplative',
  'determined',
];

/** Best-supported primary emotions (doc). */
export const CARTESIA_PRIMARY_EMOTIONS = [
  'neutral', 'calm', 'angry', 'content', 'sad', 'scared',
];

const EMOTION_SET = new Set(CARTESIA_EMOTIONS);

/** Aliases from older ElevenLabs-style tags → Sonic emotion id. */
const EMOTION_ALIASES = {
  emphatic: 'confident',
  whisper: 'mysterious',
  whispers: 'mysterious',
  laugh: 'happy',
  laughs: 'happy',
  laughing: 'happy',
  sigh: 'sad',
  sighs: 'sad',
  joy: 'happy',
  joyful: 'happy',
  fear: 'scared',
  fearful: 'scared',
  love: 'affectionate',
  warm: 'content',
  serious: 'determined',
  thinking: 'contemplative',
};

export function cartesiaConfigured() {
  return Boolean(process.env.CARTESIA_API_KEY?.trim());
}

export function cartesiaApiKey() {
  const key = process.env.CARTESIA_API_KEY?.trim();
  if (!key) throw new Error('CARTESIA_API_KEY not configured');
  return key;
}

export function cartesiaTtsModel() {
  return CARTESIA_TTS_MODEL;
}

export function envCartesiaVoiceIdForLocale(locale) {
  const lang = normalizeLocale(locale);
  const fromEnv = process.env[`CARTESIA_VOICE_ID_${lang.toUpperCase()}`]?.trim();
  if (fromEnv) return fromEnv;
  return CARTESIA_DEFAULT_VOICES[lang] || CARTESIA_DEFAULT_VOICES.en;
}

/** Strip [emotion] tags — Cartesia uses generation_config.emotion. */
export function stripAudioTags(text) {
  return String(text || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a bracket tag or raw name to a valid Sonic emotion.
 * @param {string} raw
 * @returns {string|undefined}
 */
export function resolveCartesiaEmotion(raw) {
  const key = String(raw || '')
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!key) return undefined;
  if (EMOTION_SET.has(key)) return key;
  const alias = EMOTION_ALIASES[key];
  if (alias && EMOTION_SET.has(alias)) return alias;
  return undefined;
}

/** Map first [tag] in text to a Cartesia Sonic emotion when possible. */
export function emotionFromText(text) {
  const m = String(text || '').match(/\[([a-zA-Z_ -]+)\]/);
  if (!m) return undefined;
  return resolveCartesiaEmotion(m[1]);
}

/**
 * Split a demo/script into one TTS segment per emotion tag.
 * HTTP /tts/bytes only accepts one generation_config.emotion — so each tag
 * must be its own request (otherwise only the first [calm] colors everything).
 * @param {string} text
 * @returns {string[]} segments that still include their leading [emotion] tag
 */
export function splitEmotionSegments(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  const re = /\[([a-zA-Z_ -]+)\]/g;
  /** @type {{ index: number, len: number }[]} */
  const hits = [];
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (resolveCartesiaEmotion(m[1])) {
      hits.push({ index: m.index, len: m[0].length });
    }
  }
  if (!hits.length) return [raw.trim()];

  const out = [];
  if (hits[0].index > 0) {
    const pre = raw.slice(0, hits[0].index).trim();
    if (pre) out.push(pre);
  }
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : raw.length;
    const seg = raw.slice(start, end).trim();
    if (seg) out.push(seg);
  }
  return out;
}

/** Demo scripts — warmer Sonic emotions (text must match the tag). */
export const CARTESIA_TEST_SCRIPTS = {
  fr: [
    '[happy] Bonjour ! Je suis l’assistant vocal KovZu — ravie de te parler.',
    '[curious] Tu entends bien la ponctuation ? Points… virgules, points d’interrogation ?',
    '[excited] Parfait ! Ça déménage, on avance ensemble !',
    '[enthusiastic] Dis-moi ce que tu veux changer — j’ai vraiment hâte d’y aller.',
    '[affectionate] Ou chuchote si tu préfères rester discret : je t’écoute.',
    '[proud] Merci — je suis là, prêt pour la suite.',
  ].join('\n\n'),
  es: [
    '[happy] ¡Hola! Soy el asistente de voz de KovZu — encantado de hablar contigo.',
    '[curious] ¿Se oye bien la puntuación? Puntos… comas, ¿signos de interrogación?',
    '[excited] ¡Perfecto! Esto avanza genial.',
    '[enthusiastic] Dime qué quieres cambiar — ¡tengo ganas!',
    '[affectionate] O susurra si prefieres discreción: te escucho.',
    '[proud] Gracias — aquí estoy, listo para seguir.',
  ].join('\n\n'),
  en: [
    '[happy] Hello! I am the KovZu voice assistant — so glad to talk with you.',
    '[curious] Can you hear the punctuation clearly? Periods… commas, question marks?',
    '[excited] Perfect! This is moving fast — let’s keep going!',
    '[enthusiastic] Tell me what you want to change — I can’t wait.',
    '[affectionate] Or whisper if you’d rather stay quiet: I’m listening.',
    '[proud] Thanks — I’m here, ready for whatever’s next.',
  ].join('\n\n'),
};

export const CARTESIA_QUICK_TEST = {
  fr: '[excited] Bonjour ! Test Sonic KovZu — ça sonne vivant et clairement !',
  es: '[excited] ¡Hola! Prueba Sonic KovZu — ¡suena con vida y claridad!',
  en: '[excited] Hello! KovZu Sonic voice test — lively and crystal clear!',
};

export function cartesiaTestScriptForLocale(locale) {
  const lang = normalizeLocale(locale);
  return CARTESIA_TEST_SCRIPTS[lang] || CARTESIA_TEST_SCRIPTS.fr;
}

export function cartesiaQuickTestForLocale(locale) {
  const lang = normalizeLocale(locale);
  return CARTESIA_QUICK_TEST[lang] || CARTESIA_QUICK_TEST.fr;
}

export function looksLikeCartesiaVoiceId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}

export function cartesiaVoiceMapStatus(overrides = {}) {
  const map = {};
  for (const lang of LOCALES) {
    const raw = String(overrides[lang] || '').trim();
    map[lang] = looksLikeCartesiaVoiceId(raw)
      ? raw.toLowerCase()
      : envCartesiaVoiceIdForLocale(lang);
  }
  return { ...map, model: cartesiaTtsModel() };
}
