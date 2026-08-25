import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { normalizeLocale } from './locale.js';
import {
  cartesiaApiKey,
  cartesiaTtsModel,
  CARTESIA_API_VERSION,
  stripAudioTags,
  emotionFromText,
  envCartesiaVoiceIdForLocale,
} from './cartesiaVoices.js';
import { getVoiceIdForLocale } from './settingsStore.js';

export const CARTESIA_WS_SAMPLE_RATE = 24000;
export const CARTESIA_WS_ENCODING = 'pcm_s16le';
/** pcm_s16le mono @ 24kHz */
const BYTES_PER_SEC = CARTESIA_WS_SAMPLE_RATE * 2;

function looksLikeCartesiaVoiceId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}

export async function resolveCartesiaVoiceId(locale, preferred) {
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

export function cartesiaTtsWebSocketUrl() {
  const key = cartesiaApiKey();
  const params = new URLSearchParams({
    api_key: key,
    cartesia_version: CARTESIA_API_VERSION,
  });
  return `wss://api.cartesia.ai/tts/websocket?${params}`;
}

/**
 * Open a Cartesia TTS WebSocket.
 * One context per session with continuations — smoother prosody than a fresh
 * context per push. If the context expires (~1s idle), the next push opens a new one.
 */
export function openCartesiaTtsContext({
  locale,
  voiceId,
  onAudio,
  onTimestamps,
  onDone,
  onError,
    maxBufferDelayMs = 800,
}) {
  const lang = normalizeLocale(locale);
  const modelId = cartesiaTtsModel();
  const sessionId = randomUUID();
  const outputFormat = {
    container: 'raw',
    encoding: CARTESIA_WS_ENCODING,
    sample_rate: CARTESIA_WS_SAMPLE_RATE,
  };

  let closed = false;
  let started = false;
  let finishing = false;
  let emotion;
  let timelineSec = 0;
  let contextOpen = false;
  let activeContextId = null;
  /** @type {Map<string, { base: number, maxEnd: number, audioBytes: number }>} */
  const contexts = new Map();

  const ws = new WebSocket(cartesiaTtsWebSocketUrl());

  const fail = (err) => {
    if (closed) return;
    closed = true;
    try { ws.close(); } catch { /* ignore */ }
    onError?.(err instanceof Error ? err : new Error(String(err)));
  };

  const maybeFinish = () => {
    if (closed) return;
    if (finishing && !contextOpen) {
      closed = true;
      try { ws.close(); } catch { /* ignore */ }
      onDone?.();
    }
  };

  const ensureContext = () => {
    if (!activeContextId) {
      activeContextId = randomUUID();
      contexts.set(activeContextId, { base: timelineSec, maxEnd: timelineSec, audioBytes: 0 });
      contextOpen = true;
    }
    return activeContextId;
  };

  const basePayload = (contextId, emo, cont) => ({
    model_id: modelId,
    voice: { mode: 'id', id: voiceId },
    language: lang,
    context_id: contextId,
    output_format: outputFormat,
    max_buffer_delay_ms: maxBufferDelayMs,
    add_timestamps: true,
    continue: cont,
    ...(emo ? { generation_config: { emotion: emo } } : {}),
  });

  ws.on('open', () => {
    started = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const ctxId = String(msg.context_id || '');
    const meta = contexts.get(ctxId);

    if (msg.type === 'chunk' && msg.data) {
      const buf = Buffer.from(String(msg.data), 'base64');
      if (meta) meta.audioBytes += buf.length;
      onAudio?.(msg.data);
      return;
    }

    if (msg.type === 'timestamps' && msg.word_timestamps) {
      const wt = msg.word_timestamps;
      const words = Array.isArray(wt.words) ? wt.words : [];
      const starts = Array.isArray(wt.start) ? wt.start : [];
      const ends = Array.isArray(wt.end) ? wt.end : [];
      const base = meta?.base || 0;
      if (words.length) {
        const absStart = starts.map((s) => Number(s) + base);
        const absEnd = ends.map((e) => Number(e) + base);
        if (meta) {
          meta.maxEnd = Math.max(meta.maxEnd, ...absEnd, base);
        }
        onTimestamps?.({ words, start: absStart, end: absEnd });
      }
      return;
    }

    if (msg.type === 'done') {
      if (meta) {
        const fromAudio = meta.base + (meta.audioBytes / BYTES_PER_SEC);
        const fromWords = meta.maxEnd;
        timelineSec = Math.max(timelineSec, fromAudio, fromWords);
        contexts.delete(ctxId);
      }
      if (ctxId === activeContextId) {
        activeContextId = null;
        contextOpen = false;
      }
      maybeFinish();
      return;
    }

    if (msg.type === 'error') {
      const detail = msg.message || msg.error || msg.title || 'Cartesia TTS error';
      console.error('[cartesia-tts-ws] upstream error', {
        message: detail,
        code: msg.code || msg.status || null,
        type: msg.type,
        raw: msg,
      });
      fail(new Error(detail));
    }
  });

  ws.on('error', (err) => fail(err));
  ws.on('close', () => {
    if (!closed) {
      closed = true;
      onDone?.();
    }
  });

  function sendChunk(transcript, cont) {
    if (closed || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Cartesia TTS WebSocket not open');
    }
    const text = stripAudioTags(String(transcript || ''));
    if (!text && cont) return;

    const next = emotionFromText(transcript);
    if (next) emotion = next;

    const contextId = ensureContext();
    ws.send(JSON.stringify({
      ...basePayload(contextId, emotion, cont),
      transcript: text || ' ',
    }));
  }

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
    sampleRate: CARTESIA_WS_SAMPLE_RATE,
    encoding: CARTESIA_WS_ENCODING,
    modelId,
    language: lang,
    voiceId,
    waitOpen,
    get ready() {
      return started && !closed && ws.readyState === WebSocket.OPEN;
    },
    push(transcript) {
      sendChunk(transcript, true);
    },
    end(lastTranscript = '') {
      if (closed || finishing) return;
      finishing = true;
      const text = stripAudioTags(String(lastTranscript || ''));
      if (text) {
        // One-shot or final chunk — continue:false (never add a trailing space
        // utterance; that used to concatenate after a full push and muddy audio).
        sendChunk(lastTranscript, false);
      } else if (contextOpen && activeContextId) {
        // Finalize without adding spoken content (Cartesia empty-transcript pattern).
        ws.send(JSON.stringify({
          ...basePayload(activeContextId, emotion, false),
          transcript: '',
        }));
      } else {
        contextOpen = false;
      }
      maybeFinish();
    },
    cancel() {
      if (closed) return;
      closed = true;
      if (activeContextId) {
        try {
          ws.send(JSON.stringify({ context_id: activeContextId, cancel: true }));
        } catch { /* ignore */ }
      }
      try { ws.close(); } catch { /* ignore */ }
    },
  };
}
