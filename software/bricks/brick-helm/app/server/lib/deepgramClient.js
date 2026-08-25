import { normalizeLocale } from './locale.js';
import { formatTextForTts } from './ttsFormat.js';
import {
  deepgramConfigured,
  deepgramApiKey,
  deepgramTtsModelFamily,
  deepgramTtsSpeed,
  deepgramSttModel,
  envDeepgramVoiceIdForLocale,
  looksLikeDeepgramVoiceId,
  stripDeepgramTags,
  deepgramVoiceMapStatus,
  listDeepgramVoiceCatalog,
} from './deepgramVoices.js';
import { getVoiceIdForLocale } from './settingsStore.js';

const API_BASE = 'https://api.deepgram.com/v1';

export {
  deepgramConfigured,
  deepgramTtsModelFamily,
  deepgramSttModel,
  envDeepgramVoiceIdForLocale,
  deepgramVoiceMapStatus,
  listDeepgramVoiceCatalog,
};

async function resolveDeepgramVoiceId(locale, preferred) {
  const direct = String(preferred || '').trim();
  if (looksLikeDeepgramVoiceId(direct)) return direct.toLowerCase();
  try {
    const stored = await getVoiceIdForLocale(locale);
    if (looksLikeDeepgramVoiceId(stored)) return stored.toLowerCase();
  } catch {
    /* settings optional */
  }
  return envDeepgramVoiceIdForLocale(locale);
}

function deepgramErrorMessage(data, status) {
  if (typeof data?.err_msg === 'string' && data.err_msg.trim()) return data.err_msg.trim();
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  if (typeof data?.err_code === 'string' && data.err_code.trim()) {
    return `${data.err_code}${data.err_msg ? `: ${data.err_msg}` : ''}`;
  }
  return `Deepgram TTS ${status}`;
}

/**
 * List Aura voices for Helm locales (static official catalog).
 * @param {{ language?: string }} [opts]
 */
export async function listDeepgramVoices(opts = {}) {
  return listDeepgramVoiceCatalog(opts);
}

/**
 * Synthesize speech via Deepgram /v1/speak (buffered for Helm HTTP TTS path).
 * @param {string} text
 * @param {string} lang
 * @param {{ voiceId?: string }} [opts]
 */
export async function synthesizeDeepgramSpeech(text, lang, opts = {}) {
  const locale = normalizeLocale(lang);
  const transcript = formatTextForTts(text, locale);
  if (!transcript) throw new Error('Empty TTS text');

  const voiceId = await resolveDeepgramVoiceId(locale, opts.voiceId);
  const modelFamily = deepgramTtsModelFamily();
  const speed = opts.speed || deepgramTtsSpeed();

  // WAV/linear16 — browsers play this reliably; Deepgram MP3 is raw ADTS and often stalls <audio>
  const params = new URLSearchParams({
    model: voiceId,
    encoding: 'linear16',
    container: 'wav',
    sample_rate: '24000',
  });

  const res = await fetch(`${API_BASE}/speak?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${deepgramApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: transcript }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(deepgramErrorMessage(data, res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const headerType = String(res.headers.get('content-type') || '').split(';')[0].trim();
  return {
    audioBase64: buffer.toString('base64'),
    contentType: headerType.startsWith('audio/') ? headerType : 'audio/wav',
    voiceId,
    modelId: modelFamily,
    language: locale,
    provider: 'deepgram',
  };
}

export async function resolvedDeepgramVoiceMap() {
  return deepgramVoiceMapStatus();
}

/**
 * Transcribe audio buffer via Deepgram /v1/listen (batch).
 * @param {Buffer} buffer
 * @param {string} [mimeType]
 * @param {string} [lang]
 */
export async function transcribeDeepgramAudio(buffer, mimeType = 'audio/webm', lang) {
  const locale = normalizeLocale(lang);
  const params = new URLSearchParams({
    model: deepgramSttModel(),
    language: locale,
    smart_format: 'true',
    punctuate: 'true',
  });

  const res = await fetch(`${API_BASE}/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${deepgramApiKey()}`,
      'Content-Type': mimeType || 'application/octet-stream',
    },
    body: buffer,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(deepgramErrorMessage(data, res.status));
    err.status = res.status;
    throw err;
  }

  const text = String(
    data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
  ).trim();
  const language = data?.results?.channels?.[0]?.detected_language
    || data?.metadata?.language
    || locale;
  return { text, language };
}

let deepgramBalanceCache = { at: 0, value: null };

/** Remaining Deepgram project balance in USD. */
export async function fetchDeepgramBalance() {
  const now = Date.now();
  if (deepgramBalanceCache.value && now - deepgramBalanceCache.at < 45_000) {
    return deepgramBalanceCache.value;
  }
  if (!deepgramConfigured()) {
    const value = { configured: false, ok: false, usd: null };
    deepgramBalanceCache = { at: now, value };
    return value;
  }
  try {
    const headers = { Authorization: `Token ${deepgramApiKey()}` };
    const projectsRes = await fetch(`${API_BASE}/projects`, { headers });
    const projectsData = await projectsRes.json().catch(() => ({}));
    const projectId = projectsData?.projects?.[0]?.project_id;
    if (!projectsRes.ok || !projectId) {
      const value = {
        configured: true,
        ok: false,
        usd: null,
        message: deepgramErrorMessage(projectsData, projectsRes.status),
      };
      deepgramBalanceCache = { at: now, value };
      return value;
    }
    const balRes = await fetch(`${API_BASE}/projects/${projectId}/balances`, { headers });
    const balData = await balRes.json().catch(() => ({}));
    if (!balRes.ok) {
      const value = {
        configured: true,
        ok: false,
        usd: null,
        message: deepgramErrorMessage(balData, balRes.status),
      };
      deepgramBalanceCache = { at: now, value };
      return value;
    }
    const usd = (balData.balances || [])
      .filter((b) => String(b.units || '').toLowerCase() === 'usd')
      .reduce((sum, b) => sum + Number(b.amount || 0), 0);
    const value = { configured: true, ok: true, usd, projectId };
    deepgramBalanceCache = { at: now, value };
    return value;
  } catch (err) {
    const value = {
      configured: true,
      ok: false,
      usd: null,
      message: err instanceof Error ? err.message : String(err),
    };
    deepgramBalanceCache = { at: now, value };
    return value;
  }
}
