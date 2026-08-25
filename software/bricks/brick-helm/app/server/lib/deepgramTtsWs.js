import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { normalizeLocale } from './locale.js';
import { formatTextForTts } from './ttsFormat.js';
import {
  deepgramApiKey,
  deepgramTtsModelFamily,
  deepgramTtsSpeed,
  envDeepgramVoiceIdForLocale,
  looksLikeDeepgramVoiceId,
  stripDeepgramTags,
} from './deepgramVoices.js';
import { getVoiceIdForLocale } from './settingsStore.js';

/** Match Cartesia / browser PCM player. */
export const DEEPGRAM_WS_SAMPLE_RATE = 24000;
export const DEEPGRAM_WS_ENCODING = 'pcm_s16le';

export async function resolveDeepgramVoiceId(locale, preferred) {
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

export function deepgramTtsWebSocketUrl(voiceId) {
  const params = new URLSearchParams({
    model: voiceId,
    encoding: 'linear16',
    sample_rate: String(DEEPGRAM_WS_SAMPLE_RATE),
  });
  return `wss://api.deepgram.com/v1/speak?${params}`;
}

/**
 * Open a Deepgram Aura TTS WebSocket (Speak → Flush → binary PCM).
 * Same session surface as Cartesia for the Helm browser proxy.
 *
 * @see https://developers.deepgram.com/docs/streaming-text-to-speech
 */
export function openDeepgramTtsContext({
  locale,
  voiceId,
  onAudio,
  onTimestamps,
  onDone,
  onError,
}) {
  const lang = normalizeLocale(locale);
  const modelId = deepgramTtsModelFamily();
  const sessionId = randomUUID();

  let closed = false;
  let started = false;
  let finishing = false;
  let pendingFlushes = 0;
  let flushTimer = null;
  let spokenSinceFlush = false;

  const ws = new WebSocket(deepgramTtsWebSocketUrl(voiceId), {
    headers: {
      Authorization: `Token ${deepgramApiKey()}`,
    },
  });

  const fail = (err) => {
    if (closed) return;
    closed = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    try { ws.close(); } catch { /* ignore */ }
    onError?.(err instanceof Error ? err : new Error(String(err)));
  };

  const maybeFinish = () => {
    if (closed) return;
    if (finishing && pendingFlushes <= 0 && !spokenSinceFlush) {
      closed = true;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'Close' }));
        }
      } catch { /* ignore */ }
      try { ws.close(); } catch { /* ignore */ }
      onDone?.();
    }
  };

  const flushNow = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (closed || ws.readyState !== WebSocket.OPEN || !spokenSinceFlush) {
      maybeFinish();
      return;
    }
    spokenSinceFlush = false;
    pendingFlushes += 1;
    ws.send(JSON.stringify({ type: 'Flush' }));
  };

  /** Deepgram limits ~20 Flush / 60s — batch Speak; long debounce avoids period chops. */
  const FLUSH_DEBOUNCE_MS = 2200;
  const scheduleFlush = () => {
    if (finishing) {
      flushNow();
      return;
    }
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushNow();
    }, FLUSH_DEBOUNCE_MS);
  };

  const speak = (transcript) => {
    if (closed || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Deepgram TTS WebSocket not open');
    }
    const text = formatTextForTts(String(transcript || ''), locale);
    if (!text) return;
    // Trailing space keeps word boundaries when multiple Speak land before one Flush.
    ws.send(JSON.stringify({ type: 'Speak', text: `${text} ` }));
    spokenSinceFlush = true;
  };

  ws.on('open', () => {
    started = true;
  });

  ws.on('message', (raw, isBinary) => {
    if (closed) return;

    const asBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    // `ws` often delivers JSON as Buffer too — only treat true binary as PCM
    const looksJson = !isBinary && asBuf.length > 0 && asBuf[0] === 0x7b; // '{'
    if (isBinary || (!looksJson && asBuf.length > 0 && asBuf[0] !== 0x7b)) {
      if (asBuf.length) onAudio?.(asBuf.toString('base64'));
      return;
    }

    let msg;
    try {
      msg = JSON.parse(asBuf.toString('utf8'));
    } catch {
      // Misclassified PCM starting with '{' is vanishingly rare; ignore
      return;
    }

    const type = String(msg.type || '');
    if (type === 'Metadata') {
      return;
    }
    if (type === 'Flushed') {
      pendingFlushes = Math.max(0, pendingFlushes - 1);
      maybeFinish();
      return;
    }
    if (type === 'Warning') {
      console.warn('[deepgram-tts-ws]', msg.description || msg.message || type);
      return;
    }
    if (type === 'Error') {
      fail(new Error(msg.description || msg.message || msg.error || 'Deepgram TTS error'));
      return;
    }
    if (type === 'Close') {
      pendingFlushes = 0;
      maybeFinish();
    }
  });

  ws.on('error', (err) => fail(err));
  ws.on('close', () => {
    if (!closed) {
      closed = true;
      onDone?.();
    }
  });

  async function waitOpen() {
    if (ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onErr = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('error', onErr);
      };
      ws.on('open', onOpen);
      ws.on('error', onErr);
    });
  }

  return {
    contextId: sessionId,
    sampleRate: DEEPGRAM_WS_SAMPLE_RATE,
    encoding: DEEPGRAM_WS_ENCODING,
    modelId,
    language: lang,
    voiceId,
    timestamps: false,
    waitOpen,
    get ready() {
      return started && !closed && ws.readyState === WebSocket.OPEN;
    },
    push(transcript) {
      speak(transcript);
      scheduleFlush();
    },
    end(lastTranscript = '') {
      if (closed || finishing) return;
      finishing = true;
      // Never re-Speak on end — text was already pushed. Extra Speak = one loop at the end.
      const text = stripDeepgramTags(String(lastTranscript || ''));
      if (text && !spokenSinceFlush) speak(lastTranscript);
      flushNow();
      maybeFinish();
    },
    cancel() {
      if (closed) return;
      closed = true;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'Close' }));
        }
      } catch { /* ignore */ }
      try { ws.close(); } catch { /* ignore */ }
    },
  };
}
