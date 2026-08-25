import { VOICE_SEND_KEYTERMS } from './voiceSendTrigger.js';
import { debugLog } from './clientDebugLog.js';
import { getActiveLocale, getAuthToken } from '../api/client.js';

const TARGET_SAMPLE_RATE = 16000;
/** ~85 ms @ 48 kHz — Deepgram recommends continuous small PCM frames. */
const PROCESSOR_BUFFER = 4096;
/** Fail fast so the UI can auto-retry instead of hanging on “Connecting…”. */
const READY_TIMEOUT_MS = 8000;
const MIC_PERMISSION_TIMEOUT_MS = 10000;

export async function acquireMicMediaStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone API unavailable');
  }
  // AEC stays on — it keeps the TTS out of the transcript. It also puts Android
  // in "communication" audio mode, which silences our chimes, so the ready chime
  // is played before this call rather than after (see onBeforeMic).
  const mediaPromise = navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      channelCount: 1,
    },
  });
  const timed = new Promise((_, reject) => {
    window.setTimeout(
      () => reject(new Error('Microphone permission timeout')),
      MIC_PERMISSION_TIMEOUT_MS,
    );
  });
  const stream = await Promise.race([mediaPromise, timed]);
  // Report what the OS actually granted — constraints are advisory on Android.
  try {
    const st = stream.getAudioTracks()[0]?.getSettings?.() || {};
    debugLog('voice', 'mic stream acquired', {
      echoCancellation: st.echoCancellation ?? null,
      noiseSuppression: st.noiseSuppression ?? null,
      autoGainControl: st.autoGainControl ?? null,
      sampleRate: st.sampleRate ?? null,
    });
  } catch { /* ignore */ }
  return stream;
}

function voiceSttStreamUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getAuthToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${proto}//${window.location.host}/api/voice/stt-stream${q}`;
}

function normalizeForCompare(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip Deepgram re-emit of previous phrase start in the next interim. */
function stripOverlap(committed, incoming) {
  const piece = String(incoming || '').trim();
  const base = String(committed || '').trim();
  if (!piece) return '';
  if (!base) return piece;

  const c = normalizeForCompare(base);
  const p = normalizeForCompare(piece);
  if (!c || !p) return piece;

  if (p.startsWith(c)) {
    let i = 0;
    let j = 0;
    while (i < piece.length && j < c.length) {
      const ch = piece[i];
      if (/[\s.,;:!?…'"«»-]/.test(ch)) {
        i += 1;
        continue;
      }
      i += 1;
      j += 1;
    }
    return piece.slice(i).replace(/^[\s.,;:!?…]+/, '').trim();
  }

  const max = Math.min(c.length, p.length);
  for (let len = max; len >= 12; len -= 1) {
    if (!p.startsWith(c.slice(-len))) continue;
    let i = 0;
    let seen = 0;
    while (i < piece.length && seen < len) {
      const ch = piece[i];
      i += 1;
      if (!/[\s.,;:!?…'"«»-]/.test(ch)) seen += 1;
    }
    return piece.slice(i).replace(/^[\s.,;:!?…]+/, '').trim();
  }
  return piece;
}

function joinDraft(base, committed, partial) {
  const cleanPartial = stripOverlap(committed, partial);
  const parts = [base, committed, cleanPartial].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.join(parts.length > 1 ? ' ' : '');
}

function shouldSkipCommit(committed, piece) {
  const c = normalizeForCompare(committed);
  const p = normalizeForCompare(piece);
  if (!p) return true;
  if (!c) return false;
  if (c === p) return true;
  if (c.endsWith(p) && p.length >= 8) return true;
  if (p.startsWith(c) && p.length - c.length < 3) return true;
  return false;
}

/** Linear interpolation downsample — better consonants than nearest-neighbor. */
function downsampleBuffer(buffer, inputRate, outputRate) {
  if (outputRate === inputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.max(1, Math.round(buffer.length / ratio));
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, buffer.length - 1);
    const t = src - i0;
    result[i] = buffer[i0] * (1 - t) + buffer[i1] * t;
  }
  return result;
}

function floatTo16BitPCM(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Realtime STT via Helm ↔ Deepgram.
 * Uses raw PCM linear16 @ 16 kHz (Deepgram docs — most reliable live path).
 * Always signals onError on handshake/permission failure.
 * @see https://developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio
 */
export function createRealtimeSttSession({
  lang = 'fr',
  /** Pre-acquired mic stream (preferred — avoids “Connecting…” during getUserMedia). */
  mediaStream = null,
  /** Shared unlocked AudioContext — do not close on stop (keeps ready-chime working). */
  audioContext = null,
  onDraft,
  onLivePreview,
  onCommitted: onCommittedCb,
  /** Awaited after the STT handshake, before the mic opens — the ready chime
   *  goes here: once getUserMedia is live, Android mutes our own playback. */
  onBeforeMic,
  onReady,
  onError,
} = {}) {
  const ws = new WebSocket(voiceSttStreamUrl());
  ws.binaryType = 'arraybuffer';

  let baseDraft = '';
  let committedVoice = '';
  let partialVoice = '';
  let micStream = null;
  let audioCtx = null;
  let ownAudioCtx = false;
  let processor = null;
  let micSource = null;
  let silentGain = null;
  let muted = true; // muted until armListening() — avoids eating words during WS/mic warmup
  let closed = false;
  let started = false;
  let readyNotified = false;
  let failed = false;
  let readyTimer = 0;
  let listening = false;

  const clearReadyTimer = () => {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = 0;
    }
  };

  const pushDraft = (partial = partialVoice) => {
    const text = joinDraft(baseDraft, committedVoice, partial);
    onDraft?.(text);
    onLivePreview?.(stripOverlap(committedVoice, partial));
  };

  const handlePartial = (text) => {
    partialVoice = String(text || '').trim();
    pushDraft(partialVoice);
  };

  const handleCommitted = (text) => {
    const raw = String(text || '').trim();
    partialVoice = '';
    if (!raw) {
      pushDraft('');
      return;
    }
    const piece = stripOverlap(committedVoice, raw) || raw;
    if (shouldSkipCommit(committedVoice, piece)) {
      pushDraft('');
      return;
    }
    committedVoice = committedVoice ? `${committedVoice} ${piece}` : piece;
    pushDraft('');
    onCommittedCb?.(joinDraft(baseDraft, committedVoice, ''));
  };

  const teardownMedia = () => {
    try { processor?.disconnect(); } catch { /* ignore */ }
    try { micSource?.disconnect(); } catch { /* ignore */ }
    try { silentGain?.disconnect(); } catch { /* ignore */ }
    processor = null;
    micSource = null;
    silentGain = null;
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    if (ownAudioCtx) {
      void audioCtx?.close().catch(() => {});
    }
    audioCtx = null;
  };

  const stop = () => {
    if (closed) return;
    closed = true;
    listening = false;
    clearReadyTimer();
    teardownMedia();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'cancel' }));
        }
      } catch { /* ignore */ }
      try { ws.close(); } catch { /* ignore */ }
    }
  };

  const fail = (err) => {
    if (failed) return;
    failed = true;
    clearReadyTimer();
    const error = err instanceof Error ? err : new Error(String(err));
    try { onError?.(error); } catch { /* ignore */ }
    stop();
  };

  async function startMicrophone() {
    if (mediaStream && mediaStream.active) {
      micStream = mediaStream;
    } else {
      micStream = await acquireMicMediaStream();
    }

    if (audioContext && audioContext.state !== 'closed') {
      audioCtx = audioContext;
      ownAudioCtx = false;
    } else {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      try {
        audioCtx = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: 'interactive' });
      } catch {
        audioCtx = new AudioCtx({ latencyHint: 'interactive' });
      }
      ownAudioCtx = true;
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    micSource = audioCtx.createMediaStreamSource(micStream);
    processor = audioCtx.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    const inputRate = audioCtx.sampleRate;

    processor.onaudioprocess = (ev) => {
      if (closed || muted || ws.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      const down = downsampleBuffer(input, inputRate, TARGET_SAMPLE_RATE);
      const pcm = floatTo16BitPCM(down);
      ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    };

    micSource.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioCtx.destination);
  }

  ws.addEventListener('open', () => {
    if (closed || failed) return;
    // PCM raw — Deepgram requires encoding + sample_rate (docs).
    try {
      ws.send(JSON.stringify({
        type: 'start',
        lang,
        container: 'pcm',
        keyterms: VOICE_SEND_KEYTERMS,
      }));
    } catch (err) {
      fail(err);
      return;
    }
    clearReadyTimer();
    readyTimer = window.setTimeout(() => {
      if (!started && !closed && !failed) {
        fail(new Error('STT ready timeout'));
      }
    }, READY_TIMEOUT_MS);
  });

  ws.addEventListener('message', (ev) => {
    if (closed || failed) return;
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      clearReadyTimer();
      started = true;
      void (async () => {
        if (onBeforeMic) await onBeforeMic();
        if (closed || failed) return;
        await startMicrophone();
        if (closed || failed || readyNotified) return;
        readyNotified = true;
        onReady?.();
      })().catch((err) => fail(err));
      return;
    }
    if (msg.type === 'partial') {
      handlePartial(msg.text);
      return;
    }
    if (msg.type === 'committed') {
      handleCommitted(msg.text);
      return;
    }
    if (msg.type === 'error') {
      fail(new Error(msg.error || 'Deepgram transcription error'));
    }
  });

  ws.addEventListener('error', () => {
    if (!started) fail(new Error('STT WebSocket failed'));
  });

  ws.addEventListener('close', () => {
    closed = true;
    listening = false;
    clearReadyTimer();
    teardownMedia();
  });

  return {
    setBaseDraft(text) {
      baseDraft = String(text || '');
      committedVoice = '';
      partialVoice = '';
      pushDraft('');
    },
    clearVoiceBuffer() {
      committedVoice = '';
      partialVoice = '';
      pushDraft('');
    },
    mute() {
      muted = true;
    },
    unmute() {
      if (!listening) return;
      muted = false;
    },
    /** Open the STT gate after UI countdown — call once when user may speak. */
    armListening() {
      if (closed || listening) return;
      listening = true;
      muted = false;
      committedVoice = '';
      partialVoice = '';
      pushDraft('');
    },
    stop,
    get started() { return started; },
    get listening() { return listening; },
    get keyterms() { return VOICE_SEND_KEYTERMS; },
  };
}
