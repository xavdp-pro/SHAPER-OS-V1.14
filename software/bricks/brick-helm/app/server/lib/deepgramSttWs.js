import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { normalizeLocale } from './locale.js';
import { deepgramApiKey } from './deepgramVoices.js';

/** Legacy PCM path (fallback if MediaRecorder unavailable). */
export const DEEPGRAM_STT_SAMPLE_RATE = 16000;
export const DEEPGRAM_STT_ENCODING = 'linear16';
/** Preferred browser path — Deepgram auto-detects from WebM header. */
export const DEEPGRAM_STT_CONTAINER = 'webm';

/** Domain + send boosts (Nova-3 keyterm — up to ~100 useful terms). */
const STT_KEYTERMS = [
  'go',
  'vasy',
  'vas-y',
  'clear',
  'claire',
  'clair',
  'efface',
  'effacer',
  'CPU',
  'GPU',
  'RAM',
  'SSD',
  'espace disque',
  'fréquence',
  'Composer',
  'KovZu',
  'Helm',
  'Cursor',
  'Docker',
  'serveur',
  'mémoire',
  'processeur',
  'terminal',
  'fichier',
  'dossier',
];

/** Conversational FR — slightly longer pause before cutting a phrase. */
/** Docs: code-switching uses endpointing=100 so a short « go » is not swallowed. */
const ENDPOINTING_MS = Number(process.env.DEEPGRAM_STT_ENDPOINTING_MS || 150);
const UTTERANCE_END_MS = Number(process.env.DEEPGRAM_STT_UTTERANCE_END_MS || 1600);
const KEEP_ALIVE_MS = 3000;

export function deepgramSttModel() {
  return process.env.DEEPGRAM_STT_MODEL?.trim() || 'nova-3';
}

/**
 * Live listen URL — params aligned with Deepgram streaming docs:
 * https://developers.deepgram.com/docs/understand-endpointing-interim-results
 * https://developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio
 *
 * Raw PCM (default): encoding + sample_rate required.
 * Containerized webm: omit encoding + sample_rate.
 */
export function deepgramListenWebSocketUrl(locale, { containerized = false, extraKeyterms = [] } = {}) {
  // Nova-3 monolingual `language=fr` drops English command words (« go », « clear »).
  // Official code-switching: language=multi + faster endpointing.
  // https://developers.deepgram.com/docs/multilingual-code-switching
  // https://developers.deepgram.com/docs/keyterm
  // https://developers.deepgram.com/docs/find-and-replace
  const params = new URLSearchParams({
    model: deepgramSttModel(),
    language: 'multi',
    interim_results: 'true',
    endpointing: String(Math.max(10, ENDPOINTING_MS)),
    utterance_end_ms: String(Math.max(1000, UTTERANCE_END_MS)),
    smart_format: 'true',
    punctuate: 'true',
    vad_events: 'true',
    numerals: 'true',
  });
  if (!containerized) {
    params.set('encoding', DEEPGRAM_STT_ENCODING);
    params.set('sample_rate', String(DEEPGRAM_STT_SAMPLE_RATE));
    params.set('channels', '1');
  }
  const seen = new Set();
  for (const term of [...STT_KEYTERMS, ...extraKeyterms]) {
    const kt = String(term || '').trim();
    if (!kt || seen.has(kt.toLowerCase())) continue;
    seen.add(kt.toLowerCase());
    params.append('keyterm', kt);
    if (seen.size >= 95) break;
  }
  // Find-and-replace: map what FR audio produces onto the command word « go ».
  for (const pair of ['vasy:go', 'vas-y:go', 'vas y:go']) {
    params.append('replace', pair);
  }
  return `wss://api.deepgram.com/v1/listen?${params}`;
}

function lastTokenLooksLikeCommand(text) {
  const n = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const parts = n.replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const last = parts[parts.length - 1];
  const lastTwo = parts.length >= 2 ? `${parts[parts.length - 2]} ${last}` : '';
  return ['go', 'vasy', 'gros', 'gout', 'clear', 'claire', 'clair', 'efface', 'effacer'].includes(last)
    || lastTwo === 'vas y';
}

function transcriptFromResult(msg) {
  const alts = Array.isArray(msg?.channel?.alternatives) ? msg.channel.alternatives : [];
  const texts = alts.map((a) => String(a?.transcript || '').trim()).filter(Boolean);
  const command = texts.find(lastTokenLooksLikeCommand);
  return command || texts[0] || '';
}

/**
 * Upstream Deepgram live listen.
 *
 * Preferred: browser MediaRecorder webm/opus (containerized).
 * Fallback: linear16 PCM @ 16 kHz.
 *
 * Accumulation (official Deepgram pattern):
 *   - is_final=false → replace interim (partial)
 *   - is_final=true  → append segment to finalized buffer
 *   - speech_final   → end of utterance (pause)
 */
export function openDeepgramSttContext({
  locale,
  containerized = false,
  extraKeyterms = [],
  onPartial,
  onCommitted,
  onSpeechFinal,
  onDone,
  onError,
}) {
  const sessionId = randomUUID();
  const lang = normalizeLocale(locale);
  let closed = false;
  let started = false;
  let finishing = false;
  let keepAliveTimer = null;

  const ws = new WebSocket(deepgramListenWebSocketUrl(lang, { containerized, extraKeyterms }), {
    headers: {
      Authorization: `Token ${deepgramApiKey()}`,
    },
  });

  const stopKeepAlive = () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  };

  const fail = (err) => {
    if (closed) return;
    closed = true;
    stopKeepAlive();
    try { ws.close(); } catch { /* ignore */ }
    onError?.(err instanceof Error ? err : new Error(String(err)));
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    stopKeepAlive();
    try { ws.close(); } catch { /* ignore */ }
    onDone?.();
  };

  ws.on('open', () => {
    started = true;
    // Prevent NET-0001 idle timeout when mic is muted / silent (docs: every 3–5s).
    keepAliveTimer = setInterval(() => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: 'KeepAlive' }));
      } catch { /* ignore */ }
    }, KEEP_ALIVE_MS);
  });

  ws.on('message', (raw) => {
    if (closed) return;
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    const type = String(msg.type || '');
    if (type === 'Results') {
      const text = transcriptFromResult(msg);
      if (!text) return;
      if (msg.is_final) {
        onCommitted?.(text, { speechFinal: Boolean(msg.speech_final) });
        if (msg.speech_final) onSpeechFinal?.(text);
      } else {
        onPartial?.(text);
      }
      return;
    }
    if (type === 'UtteranceEnd') {
      onPartial?.('');
      return;
    }
    if (type === 'Metadata' || type === 'SpeechStarted') return;
    if (type === 'error' || type === 'Error') {
      fail(new Error(msg.message || msg.description || msg.err_msg || 'Deepgram STT error'));
    }
  });

  ws.on('error', (err) => fail(err));
  ws.on('close', () => {
    if (!closed) finish();
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
    sampleRate: containerized ? null : DEEPGRAM_STT_SAMPLE_RATE,
    encoding: containerized ? DEEPGRAM_STT_CONTAINER : DEEPGRAM_STT_ENCODING,
    containerized: Boolean(containerized),
    modelId: deepgramSttModel(),
    language: lang,
    waitOpen,
    get ready() {
      return started && !closed && ws.readyState === WebSocket.OPEN;
    },
    pushAudio(chunk) {
      if (closed || !chunk?.length || ws.readyState !== WebSocket.OPEN) return;
      ws.send(chunk);
    },
    end() {
      if (closed || finishing) return;
      finishing = true;
      stopKeepAlive();
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
      } catch { /* ignore */ }
      setTimeout(() => finish(), 120);
    },
    cancel() {
      if (closed) return;
      closed = true;
      stopKeepAlive();
      try { ws.close(); } catch { /* ignore */ }
    },
  };
}
