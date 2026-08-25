import { normalizeLocale } from './locale.js';
import {
  elevenLabsTtsModel,
  voiceIdForLocale,
  ensureLocaleAccent,
  voiceMapStatus,
  testScriptForLocale,
} from './elevenlabsVoices.js';
import { getVoiceIdForLocale, getVoiceIds } from './settingsStore.js';

const API_BASE = 'https://api.elevenlabs.io/v1';

function elevenErrorMessage(data, status, fallback = 'ElevenLabs') {
  const d = data?.detail;
  const code = (d && typeof d === 'object' && d.code) || data?.code || '';
  if (status === 402 || code === 'paid_plan_required') {
    return 'Plan gratuit : cette voix (Library / pro) n’est pas utilisable via l’API. '
      + 'Choisis une voix « premade », ou passe à un plan ElevenLabs payant.';
  }
  if (typeof d === 'string' && d.trim()) return d.trim();
  if (Array.isArray(d)) {
    const parts = d.map((x) => x?.message || x?.msg || '').filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  if (d && typeof d === 'object' && typeof d.message === 'string' && d.message.trim()) {
    return d.message.trim();
  }
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  return `${fallback} ${status}`;
}

/** Free-tier API can synthesize premade voices only (not Voice Library / professional). */
export function voiceApiFreeTierOk(category) {
  return String(category || '').toLowerCase() === 'premade';
}

export function elevenLabsConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

/** @deprecated prefer getVoiceIdForLocale */
export function elevenLabsVoiceId() {
  return voiceIdForLocale('en');
}

export { elevenLabsTtsModel, voiceIdForLocale, voiceMapStatus, testScriptForLocale };

function apiKey() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error('ELEVENLABS_API_KEY not configured');
  return key;
}

export async function listAccountVoices() {
  const res = await fetch(`${API_BASE}/voices`, {
    headers: { 'xi-api-key': apiKey() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(elevenErrorMessage(data, res.status, 'Voices'));
  }
  const voices = Array.isArray(data.voices) ? data.voices : [];
  return voices.map((v) => {
    const labels = v.labels || {};
    const verifiedLanguages = Array.isArray(v.verified_languages)
      ? v.verified_languages.map((item) => ({
        language: item?.language || '',
        locale: item?.locale || null,
        accent: item?.accent || null,
        modelId: item?.model_id || null,
      })).filter((item) => item.language)
      : [];
    const category = v.category || '';
    return {
      voiceId: v.voice_id,
      name: v.name || v.voice_id,
      category,
      description: v.description || '',
      previewUrl: v.preview_url || null,
      labels,
      gender: labels.gender || '',
      accent: labels.accent || '',
      language: labels.language || '',
      verifiedLanguages,
      /** Distinct ISO-ish codes from verified_languages */
      verifiedLangCodes: [...new Set(
        verifiedLanguages.map((x) => String(x.language || '').toLowerCase().slice(0, 2)).filter(Boolean),
      )],
      /** false → ElevenLabs returns 402 on free tier API */
      apiFreeTierOk: voiceApiFreeTierOk(category),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Transcribe audio buffer via Scribe v2. */
export async function transcribeAudio(buffer, mimeType = 'audio/webm', lang) {
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append('file', blob, `audio.${mimeType.includes('webm') ? 'webm' : 'wav'}`);
  form.append('model_id', 'scribe_v2');
  if (lang) form.append('language_code', String(lang).slice(0, 2));

  const res = await fetch(`${API_BASE}/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey() },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(elevenErrorMessage(data, res.status, 'STT'));
  }

  const text = String(data.text || '').trim();
  const language = data.language_code || data.language || null;
  return { text, language };
}

async function ttsRequest(voiceId, payload) {
  const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey(),
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(elevenErrorMessage(data, res.status, 'TTS'));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return res;
}

/**
 * Synthesize speech.
 * @param {string} text
 * @param {string} lang
 * @param {{ voiceId?: string, skipAccent?: boolean }} [opts]
 */
export async function synthesizeSpeech(text, lang, opts = {}) {
  const locale = normalizeLocale(lang);
  const raw = opts.skipAccent
    ? String(text || '').trim()
    : ensureLocaleAccent(String(text || '').trim(), locale);
  if (!raw) throw new Error('Empty TTS text');

  const voiceId = String(opts.voiceId || '').trim()
    || await getVoiceIdForLocale(locale);
  const modelId = elevenLabsTtsModel();

  const attempts = [
    { text: raw, model_id: modelId, language_code: locale },
    // Retry without language_code (some voices / models reject it)
    { text: raw, model_id: modelId },
  ];
  if (!opts.skipAccent && raw !== String(text || '').trim()) {
    attempts.push({ text: String(text || '').trim(), model_id: modelId });
  }

  let lastErr;
  let res;
  for (const payload of attempts) {
    try {
      res = await ttsRequest(voiceId, payload);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.warn('[elevenlabs] TTS attempt failed', {
        voiceId,
        modelId,
        status: err.status,
        message: err.message,
        hasLanguage: Boolean(payload.language_code),
      });
      // No point retrying payment / not-found / auth errors
      if ([401, 402, 403, 404].includes(Number(err.status))) break;
    }
  }
  if (!res) throw lastErr || new Error('TTS failed');

  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    audioBase64: buffer.toString('base64'),
    contentType: res.headers.get('content-type') || 'audio/mpeg',
    voiceId,
    modelId,
    language: locale,
  };
}

export async function createRealtimeSttToken() {
  const res = await fetch(`${API_BASE}/single-use-token/realtime_scribe`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(data.detail?.message || data.detail || data.error || `STT token ${res.status}`);
  }
  return data.token;
}

export async function resolvedVoiceMap() {
  const voices = await getVoiceIds({ force: true });
  return voiceMapStatus(voices);
}
