import { normalizeLocale } from './locale.js';
import {
  cartesiaConfigured,
  cartesiaApiKey,
  cartesiaTtsModel,
  envCartesiaVoiceIdForLocale,
  stripAudioTags,
  emotionFromText,
  cartesiaVoiceMapStatus,
  CARTESIA_API_VERSION,
} from './cartesiaVoices.js';
import { getVoiceIdForLocale, getVoiceIds } from './settingsStore.js';

const API_BASE = 'https://api.cartesia.ai';

export {
  cartesiaConfigured,
  cartesiaTtsModel,
  envCartesiaVoiceIdForLocale,
  cartesiaVoiceMapStatus,
};

function authHeaders() {
  return {
    Authorization: `Bearer ${cartesiaApiKey()}`,
    'Cartesia-Version': CARTESIA_API_VERSION,
    'Content-Type': 'application/json',
  };
}

function looksLikeCartesiaVoiceId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}

async function resolveCartesiaVoiceId(locale, preferred) {
  const direct = String(preferred || '').trim();
  if (looksLikeCartesiaVoiceId(direct)) return direct;
  try {
    const stored = await getVoiceIdForLocale(locale);
    if (looksLikeCartesiaVoiceId(stored)) return stored;
  } catch {
    /* settings optional */
  }
  return envCartesiaVoiceIdForLocale(locale);
}

function cartesiaErrorMessage(data, status) {
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail.trim();
  return `Cartesia TTS ${status}`;
}

/**
 * List voices (optionally filtered by language).
 * @param {{ language?: string, limit?: number }} [opts]
 */
export async function listCartesiaVoices(opts = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit || 100));
  if (opts.language) params.set('language', normalizeLocale(opts.language));

  const res = await fetch(`${API_BASE}/voices?${params}`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(cartesiaErrorMessage(data, res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const voices = Array.isArray(data.data) ? data.data : [];
  return voices.map((v) => ({
    voiceId: v.id,
    name: String(v.name || v.id).replace(/\t/g, ' ').trim(),
    category: v.is_public ? 'public' : 'custom',
    description: v.description || '',
    previewUrl: v.preview_url || null,
    labels: { language: v.language || '', gender: v.gender || '' },
    gender: v.gender || '',
    accent: '',
    language: v.language || '',
    verifiedLanguages: [],
    verifiedLangCodes: v.language ? [String(v.language).slice(0, 2)] : [],
    apiFreeTierOk: true,
    provider: 'cartesia',
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Synthesize speech via Cartesia /tts/bytes (streams body; we buffer for current Helm client).
 * @param {string} text
 * @param {string} lang
 * @param {{ voiceId?: string }} [opts]
 */
export async function synthesizeCartesiaSpeech(text, lang, opts = {}) {
  const locale = normalizeLocale(lang);
  const emotion = emotionFromText(text);
  const transcript = stripAudioTags(text);
  if (!transcript) throw new Error('Empty TTS text');

  const voiceId = await resolveCartesiaVoiceId(locale, opts.voiceId);
  const modelId = cartesiaTtsModel();

  const payload = {
    model_id: modelId,
    transcript,
    language: locale,
    voice: { mode: 'id', id: voiceId },
    output_format: {
      container: 'mp3',
      sample_rate: 44100,
      bit_rate: 128000,
    },
  };
  if (emotion) {
    payload.generation_config = { emotion };
  }

  const res = await fetch(`${API_BASE}/tts/bytes`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = cartesiaErrorMessage(data, res.status);
    console.error('[cartesia-tts] HTTP synthesize failed', {
      status: res.status,
      message,
      voiceId,
      modelId,
      language: locale,
      data,
    });
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    audioBase64: buffer.toString('base64'),
    contentType: res.headers.get('content-type') || 'audio/mpeg',
    voiceId,
    modelId,
    language: locale,
    provider: 'cartesia',
  };
}

let cartesiaQuotaCache = { at: 0, value: null };

/** Probe whether Cartesia TTS still has credits (errors do not consume quota). */
export async function probeCartesiaQuota() {
  const now = Date.now();
  if (cartesiaQuotaCache.value && now - cartesiaQuotaCache.at < 45_000) {
    return cartesiaQuotaCache.value;
  }
  if (!cartesiaConfigured()) {
    const value = { configured: false, ok: false, quotaExceeded: false };
    cartesiaQuotaCache = { at: now, value };
    return value;
  }
  try {
    const payload = {
      model_id: cartesiaTtsModel(),
      transcript: 'ok',
      language: 'en',
      voice: { mode: 'id', id: envCartesiaVoiceIdForLocale('en') },
      output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
    };
    const res = await fetch(`${API_BASE}/tts/bytes`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const quotaExceeded = res.status === 402;
    let message = '';
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      message = cartesiaErrorMessage(data, res.status);
    }
    const value = {
      configured: true,
      ok: res.ok,
      quotaExceeded,
      status: res.status,
      message,
    };
    cartesiaQuotaCache = { at: now, value };
    return value;
  } catch (err) {
    const value = {
      configured: true,
      ok: false,
      quotaExceeded: false,
      message: err instanceof Error ? err.message : String(err),
    };
    cartesiaQuotaCache = { at: now, value };
    return value;
  }
}

export async function resolvedCartesiaVoiceMap() {
  const stored = await getVoiceIds({ force: true });
  return cartesiaVoiceMapStatus(stored);
}
