import { LOCALES } from './locale.js';
import { getVoiceIds, getTtsProviderSync } from './settingsStore.js';
import {
  elevenLabsConfigured,
  synthesizeSpeech as elevenSynthesize,
  listAccountVoices as listElevenVoices,
  resolvedVoiceMap as resolvedElevenVoices,
  elevenLabsTtsModel,
} from './elevenlabsClient.js';
import {
  testScriptForLocale as elevenTestScriptForLocale,
  quickTestForLocale as elevenQuickTestForLocale,
  envVoiceIdForLocale,
} from './elevenlabsVoices.js';
import {
  cartesiaConfigured,
  cartesiaTtsModel,
  listCartesiaVoices,
  synthesizeCartesiaSpeech,
  resolvedCartesiaVoiceMap,
  envCartesiaVoiceIdForLocale,
} from './cartesiaClient.js';
import {
  cartesiaTestScriptForLocale,
  cartesiaQuickTestForLocale,
  looksLikeCartesiaVoiceId,
} from './cartesiaVoices.js';
import {
  deepgramConfigured,
  deepgramTtsModelFamily,
  deepgramSttModel,
  listDeepgramVoices,
  synthesizeDeepgramSpeech,
  transcribeDeepgramAudio,
  resolvedDeepgramVoiceMap,
  envDeepgramVoiceIdForLocale,
} from './deepgramClient.js';
import {
  deepgramTestScriptForLocale,
  deepgramQuickTestForLocale,
  looksLikeDeepgramVoiceId,
} from './deepgramVoices.js';
import { probeCartesiaQuota } from './cartesiaClient.js';
import { fetchDeepgramBalance } from './deepgramClient.js';


const TTS_PROVIDERS = new Set(['cartesia', 'deepgram', 'elevenlabs']);

function providerConfigured(id) {
  if (id === 'cartesia') return cartesiaConfigured();
  if (id === 'deepgram') return deepgramConfigured();
  if (id === 'elevenlabs') return elevenLabsConfigured();
  return false;
}

export function availableTtsProviders() {
  return ['cartesia', 'deepgram', 'elevenlabs'].filter(providerConfigured);
}

function looksLikeElevenLabsVoiceId(id) {
  return /^[a-zA-Z0-9]{10,64}$/.test(String(id || '').trim());
}

/** Detect which TTS provider a stored voice id belongs to. */
export function voiceIdProviderHint(id) {
  const raw = String(id || '').trim();
  if (!raw) return null;
  if (looksLikeCartesiaVoiceId(raw)) return 'cartesia';
  if (looksLikeDeepgramVoiceId(raw)) return 'deepgram';
  if (looksLikeElevenLabsVoiceId(raw)) return 'elevenlabs';
  return null;
}

/** Active voice id for locale — same rules as chat TTS synthesis. */
export function activeVoiceIdForProvider(provider, lang, storedId) {
  const id = String(storedId || '').trim();
  if (provider === 'cartesia') {
    return looksLikeCartesiaVoiceId(id) ? id.toLowerCase() : envCartesiaVoiceIdForLocale(lang);
  }
  if (provider === 'deepgram') {
    return looksLikeDeepgramVoiceId(id) ? id.toLowerCase() : envDeepgramVoiceIdForLocale(lang);
  }
  if (looksLikeElevenLabsVoiceId(id)) return id;
  return envVoiceIdForLocale(lang);
}

/**
 * Admin + status: saved DB voices vs what chat actually uses (hybrid-safe).
 */
export async function voiceSelectionState(providerOverride) {
  const stack = voiceStackStatus();
  const provider = providerOverride
    ? resolveTtsProvider(providerOverride)
    : stack.ttsProvider;
  const stored = await getVoiceIds({ force: true });
  const active = {};
  const mismatch = {};
  const savedMeta = {};

  for (const lang of LOCALES) {
    const savedId = String(stored[lang] || '').trim();
    active[lang] = activeVoiceIdForProvider(provider, lang, savedId);
    mismatch[lang] = Boolean(savedId && savedId !== active[lang]);
    savedMeta[lang] = savedId
      ? {
        voiceId: savedId,
        provider: voiceIdProviderHint(savedId),
        ignored: mismatch[lang],
      }
      : null;
  }

  return {
    stack,
    saved: { ...stored },
    active,
    mismatch,
    savedMeta,
    karaoke: provider === 'cartesia' || provider === 'deepgram',
    karaokeGrain: provider === 'cartesia' ? 'word' : provider === 'deepgram' ? 'sentence' : null,
    ttsProviderEnv: String(process.env.TTS_PROVIDER || '').trim() || null,
    ttsProviderSetting: getTtsProviderSync() || null,
    availableProviders: availableTtsProviders(),
    browseProvider: provider,
  };
}

/**
 * TTS provider: cartesia | deepgram | elevenlabs
 * STT: Deepgram Nova (live WS + batch) when DEEPGRAM_API_KEY is set.
 */
export function sttProvider() {
  if (deepgramConfigured()) return 'deepgram';
  if (elevenLabsConfigured()) return 'elevenlabs';
  return null;
}

export function ttsProvider() {
  const fromSettings = getTtsProviderSync();
  const forced = String(fromSettings || process.env.TTS_PROVIDER || '').trim().toLowerCase();
  if (TTS_PROVIDERS.has(forced)) {
    if (!providerConfigured(forced)) {
      throw new Error(`TTS_PROVIDER=${forced} but API key missing`);
    }
    return forced;
  }
  // Cartesia is first historically, but Deepgram is the working fallback when Cartesia quota is gone.
  if (deepgramConfigured()) return 'deepgram';
  if (cartesiaConfigured()) return 'cartesia';
  if (elevenLabsConfigured()) return 'elevenlabs';
  return null;
}

/** Resolve an admin/test override, or the active chat TTS engine. */
export function resolveTtsProvider(override) {
  const raw = String(override || '').trim().toLowerCase();
  if (!raw) return ttsProvider();
  if (!TTS_PROVIDERS.has(raw)) {
    throw new Error(`Moteur TTS inconnu : ${raw}`);
  }
  if (!providerConfigured(raw)) {
    throw new Error(`Moteur TTS ${raw} non configuré (clé API manquante)`);
  }
  return raw;
}

export function ttsConfigured() {
  return Boolean(ttsProvider());
}

export async function ttsBillingStatus() {
  const [cartesia, deepgram] = await Promise.all([
    probeCartesiaQuota(),
    fetchDeepgramBalance(),
  ]);
  return { cartesia, deepgram };
}

export function voiceStackStatus() {
  const stt = sttProvider();
  const tts = ttsProvider();
  let ttsModel = null;
  let sttModel = null;
  if (tts === 'cartesia') ttsModel = cartesiaTtsModel();
  else if (tts === 'deepgram') ttsModel = deepgramTtsModelFamily();
  else if (tts === 'elevenlabs') ttsModel = elevenLabsTtsModel();
  if (stt === 'deepgram') sttModel = deepgramSttModel();
  else if (stt === 'elevenlabs') sttModel = 'scribe_v2_realtime';

  return {
    configured: Boolean(stt && tts),
    sttProvider: stt,
    sttModel,
    sttStream: stt === 'deepgram',
    ttsProvider: tts,
    ttsModel,
    /** Browser ↔ Helm WebSocket proxy (Cartesia or Deepgram streaming). */
    ttsStream: tts === 'cartesia' || tts === 'deepgram',
  };
}

export async function transcribeSpeech(buffer, mimeType, lang) {
  const stt = sttProvider();
  if (stt === 'deepgram') return transcribeDeepgramAudio(buffer, mimeType, lang);
  if (stt === 'elevenlabs') {
    const { transcribeAudio } = await import('./elevenlabsClient.js');
    return transcribeAudio(buffer, mimeType, lang);
  }
  throw new Error('STT non configuré (DEEPGRAM_API_KEY ou ELEVENLABS_API_KEY)');
}

export async function synthesizeSpeech(text, lang, opts = {}) {
  const provider = resolveTtsProvider(opts.provider);
  if (!provider) {
    throw new Error(
      'Aucun fournisseur TTS configuré (CARTESIA_API_KEY, DEEPGRAM_API_KEY ou ELEVENLABS_API_KEY)',
    );
  }
  if (provider === 'cartesia') return synthesizeCartesiaSpeech(text, lang, opts);
  if (provider === 'deepgram') return synthesizeDeepgramSpeech(text, lang, opts);
  return elevenSynthesize(text, lang, opts);
}

export async function listTtsVoices(lang, providerOverride) {
  const provider = resolveTtsProvider(providerOverride);
  if (provider === 'cartesia') {
    if (lang) return listCartesiaVoices({ language: lang, limit: 100 });
    const lists = await Promise.all(
      LOCALES.map((l) => listCartesiaVoices({ language: l, limit: 50 })),
    );
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const v of list) {
        if (seen.has(v.voiceId)) continue;
        seen.add(v.voiceId);
        out.push(v);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (provider === 'deepgram') {
    if (lang) return listDeepgramVoices({ language: lang });
    const lists = await Promise.all(
      LOCALES.map((l) => listDeepgramVoices({ language: l })),
    );
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const v of list) {
        if (seen.has(v.voiceId)) continue;
        seen.add(v.voiceId);
        out.push(v);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  return listElevenVoices();
}

export async function resolvedTtsVoiceMap() {
  const provider = ttsProvider();
  if (provider === 'cartesia') return resolvedCartesiaVoiceMap();
  if (provider === 'deepgram') return resolvedDeepgramVoiceMap();
  return resolvedElevenVoices();
}

export function testScriptForLocale(locale, providerOverride) {
  const p = resolveTtsProvider(providerOverride);
  if (p === 'cartesia') return cartesiaTestScriptForLocale(locale);
  if (p === 'deepgram') return deepgramTestScriptForLocale(locale);
  return elevenTestScriptForLocale(locale);
}

export function quickTestForLocale(locale, providerOverride) {
  const p = resolveTtsProvider(providerOverride);
  if (p === 'cartesia') return cartesiaQuickTestForLocale(locale);
  if (p === 'deepgram') return deepgramQuickTestForLocale(locale);
  return elevenQuickTestForLocale(locale);
}
