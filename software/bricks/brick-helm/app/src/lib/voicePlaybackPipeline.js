/**
 * Browser autoplay: unlock on the tap, then play HTMLAudio WAVs (iOS ignores
 * WebAudio oscillators after getUserMedia / await).
 */
/** UI beeps only. Never attach getUserMedia here — AEC would mute the speakers. */
import { debugLog } from './clientDebugLog.js';

let sharedCtx = null;

/**
 * Creates a valid mono 16-bit PCM WAV base64 string from floating-point samples [-1, 1].
 */
function createPcmWavBase64(sampleRate, samples) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk
  view.setUint32(0, 0x52494646, false); // 'RIFF'
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // 'WAVE'
  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // 'fmt '
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data chunk
  view.setUint32(36, 0x64617461, false); // 'data'
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

/**
 * Generates short, elegant, snappy UI sounds (50ms - 110ms) without telephone-like artifacts.
 */
function buildShortUiSounds() {
  const sr = 22050;

  // 1. GO / Send: Crisp high rising pip (880Hz -> 1320Hz, 60ms)
  const goLen = Math.floor(sr * 0.06);
  const goSamples = new Float32Array(goLen);
  for (let i = 0; i < goLen; i++) {
    const t = i / sr;
    const p = i / goLen;
    const freq = 880 + 440 * p;
    const env = Math.sin(Math.PI * p) ** 0.8;
    goSamples[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.45;
  }

  // 2. CLEAR: Soft downward double-tick (420Hz -> 240Hz, 70ms)
  const clearLen = Math.floor(sr * 0.07);
  const clearSamples = new Float32Array(clearLen);
  for (let i = 0; i < clearLen; i++) {
    const t = i / sr;
    const p = i / clearLen;
    const freq = 420 - 180 * p;
    const env = Math.sin(Math.PI * p) ** 1.2;
    clearSamples[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.35;
  }

  // 3. MIC / Mic Ready: 3 fast rising crystal notes (659Hz, 880Hz, 1318Hz, total 100ms)
  const micLen = Math.floor(sr * 0.10);
  const micSamples = new Float32Array(micLen);
  const notes = [
    { f: 659.25, at: 0, d: 0.04 },
    { f: 880.00, at: 0.028, d: 0.04 },
    { f: 1318.5, at: 0.055, d: 0.045 },
  ];
  for (const n of notes) {
    const start = Math.floor(n.at * sr);
    const len = Math.floor(n.d * sr);
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= micLen) break;
      const t = i / sr;
      const p = i / len;
      const env = Math.sin(Math.PI * p);
      micSamples[idx] += Math.sin(2 * Math.PI * n.f * t) * env * 0.38;
    }
  }

  // 4. MIC OFF: 2 gentle falling tones (880Hz -> 440Hz, 75ms)
  const micOffLen = Math.floor(sr * 0.075);
  const micOffSamples = new Float32Array(micOffLen);
  const offNotes = [
    { f: 880.00, at: 0, d: 0.038 },
    { f: 440.00, at: 0.032, d: 0.042 },
  ];
  for (const n of offNotes) {
    const start = Math.floor(n.at * sr);
    const len = Math.floor(n.d * sr);
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= micOffLen) break;
      const t = i / sr;
      const p = i / len;
      const env = Math.sin(Math.PI * p);
      micOffSamples[idx] += Math.sin(2 * Math.PI * n.f * t) * env * 0.35;
    }
  }

  // 5. STOP / INTERRUPTED: 2 crisp descending tones (580Hz -> 330Hz, 85ms)
  const stopLen = Math.floor(sr * 0.085);
  const stopSamples = new Float32Array(stopLen);
  const stopNotes = [
    { f: 587.33, at: 0, d: 0.04 },
    { f: 329.63, at: 0.035, d: 0.05 },
  ];
  for (const n of stopNotes) {
    const start = Math.floor(n.at * sr);
    const len = Math.floor(n.d * sr);
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= stopLen) break;
      const t = i / sr;
      const p = i / len;
      const env = Math.sin(Math.PI * p) ** 1.3;
      stopSamples[idx] += Math.sin(2 * Math.PI * n.f * t) * env * 0.40;
    }
  }

  return {
    go: createPcmWavBase64(sr, goSamples),
    clear: createPcmWavBase64(sr, clearSamples),
    mic: createPcmWavBase64(sr, micSamples),
    mic_off: createPcmWavBase64(sr, micOffSamples),
    stop: createPcmWavBase64(sr, stopSamples),
  };
}

const WAV = buildShortUiSounds();

/**
 * Cache decoded AudioBuffers for zero-latency, reliable playback.
 */
const decodedChimes = {};
const decodingChimes = {};

function wavArrayBuffer(key) {
  const binary = atob(WAV[key]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function decodeChime(ctx, key) {
  if (decodedChimes[key]) return Promise.resolve(decodedChimes[key]);
  if (!decodingChimes[key]) {
    // decodeAudioData detaches the buffer, so hand it a fresh copy every time.
    decodingChimes[key] = ctx.decodeAudioData(wavArrayBuffer(key)).then((buf) => {
      decodedChimes[key] = buf;
      delete decodingChimes[key];
      return buf;
    }).catch((err) => {
      delete decodingChimes[key];
      throw err;
    });
  }
  return decodingChimes[key];
}

async function playChimeBuffer(key, ctx) {
  const target = ctx || audioCtx();
  if (!target) throw new Error('no AudioContext');
  if (target.state === 'suspended') {
    try { await target.resume(); } catch { /* play anyway — it may still start */ }
  }
  const buffer = await decodeChime(target, key);
  const src = target.createBufferSource();
  const gain = target.createGain();
  gain.gain.value = 1;
  src.buffer = buffer;
  src.connect(gain);
  gain.connect(target.destination);
  src.start();
  return buffer.duration;
}

/** Warm the decode cache so the first chime is not delayed by decoding. */
export function preloadChimes() {
  const ctx = audioCtx();
  if (!ctx) return;
  for (const key of Object.keys(WAV)) {
    void decodeChime(ctx, key).catch(() => {});
  }
}

let keepAliveOsc = null;
let keepAliveGain = null;

function startOutputKeepAlive() {
  const ctx = audioCtx();
  if (!ctx) return;
  if (keepAliveOsc && ctx.state === 'running') return;
  try {
    if (keepAliveOsc) {
      try { keepAliveOsc.stop(); } catch { /* ignore */ }
      try { keepAliveOsc.disconnect(); } catch { /* ignore */ }
    }
    keepAliveGain = ctx.createGain();
    keepAliveGain.gain.value = 0.00003;
    keepAliveOsc = ctx.createOscillator();
    keepAliveOsc.frequency.value = 18;
    keepAliveOsc.connect(keepAliveGain);
    keepAliveGain.connect(ctx.destination);
    keepAliveOsc.start();
  } catch {
    keepAliveOsc = null;
    keepAliveGain = null;
  }
}

export function getSharedAudioContext() {
  const ctx = audioCtx();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function audioCtx() {
  if (typeof window === 'undefined') return null;
  if (!sharedCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) sharedCtx = new AudioContextClass();
  }
  return sharedCtx;
}

/**
 * Unlocks the WebAudio context from a user gesture so subsequent chimes can play.
 */
export async function unlockAudioPlayback() {
  const ctx = audioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      /* ignore */
    }
  }
  startOutputKeepAlive();
}

/**
 * Fallback tone playback using oscillators.
 */
function playTones(steps) {
  const ctx = audioCtx();
  if (!ctx) return;
  const run = () => {
    const t0 = ctx.currentTime + 0.01;
    for (const step of steps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(step.freq, t0 + step.at);
      const peak = step.peak ?? 0.35;
      const dur = step.dur ?? 0.06;
      gain.gain.setValueAtTime(0.0001, t0 + step.at);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + step.at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + step.at + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + step.at);
      osc.stop(t0 + step.at + dur + 0.015);
    }
  };
  if (ctx.state === 'suspended') {
    ctx.resume().then(run).catch(() => {});
    return;
  }
  run();
}

function playNamedChime(key, toneFallback) {
  startOutputKeepAlive();
  void playChimeBuffer(key, null).catch((err) => {
    debugLog('audio', 'chime buffer failed', { key, err: err?.name || String(err) });
    toneFallback();
  });
}

const TOAST_TONES = {
  success: [
    { freq: 880, at: 0, dur: 0.045, peak: 0.35 },
    { freq: 1320, at: 0.04, dur: 0.06, peak: 0.4 },
  ],
  error: [
    { freq: 360, at: 0, dur: 0.05, peak: 0.35 },
    { freq: 240, at: 0.045, dur: 0.065, peak: 0.35 },
  ],
  info: [{ freq: 988, at: 0, dur: 0.04, peak: 0.3 }],
};

/**
 * Notification sound, fired from the toast dispatcher so every alert is audible.
 * @param {'success'|'error'|'info'|'mic'} kind
 */
export function playToastSound(kind = 'info') {
  if (kind === 'mic') {
    void playMicReadyChime().then((how) => debugLog('audio', 'toast mic sound', { how }));
    return;
  }
  const ctx = audioCtx();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
  startOutputKeepAlive();
  debugLog('audio', 'toast sound', { kind, ctx: ctx ? ctx.state : 'none' });
  playTones(TOAST_TONES[kind] || TOAST_TONES.info);
}

/** 1 high crisp pip — « go » / Send accepted (60ms). */
export function playGoConfirmBeep() {
  playNamedChime('go', () => playTones([{ freq: 1100, at: 0, dur: 0.06, peak: 0.4 }]));
}

/** 2 soft low pips — « clear » / Effacer accepted (70ms). */
export function playClearConfirmBeep() {
  playNamedChime('clear', () => playTones([
    { freq: 380, at: 0, dur: 0.04, peak: 0.35 },
    { freq: 240, at: 0.035, dur: 0.05, peak: 0.35 },
  ]));
}

/** 2 crisp descending tones — « stop » / Interrompu (85ms). */
export function playStopConfirmBeep() {
  playNamedChime('stop', () => playTones([
    { freq: 587, at: 0, dur: 0.04, peak: 0.4 },
    { freq: 330, at: 0.035, dur: 0.05, peak: 0.4 },
  ]));
}

/** 3 rising crystal pips — microphone is live (100ms). */
const MIC_READY_TONES = [
  { freq: 659, at: 0, dur: 0.04, peak: 0.38 },
  { freq: 880, at: 0.028, dur: 0.04, peak: 0.38 },
  { freq: 1318, at: 0.055, dur: 0.05, peak: 0.42 },
];

export function playTonesOnContext(ctx, steps) {
  if (!ctx) {
    playTones(steps);
    return;
  }
  const run = () => {
    const t0 = ctx.currentTime + 0.01;
    for (const step of steps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(step.freq, t0 + step.at);
      const peak = step.peak ?? 0.38;
      const dur = step.dur ?? 0.05;
      gain.gain.setValueAtTime(0.0001, t0 + step.at);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + step.at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + step.at + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + step.at);
      osc.stop(t0 + step.at + dur + 0.015);
    }
  };
  if (ctx.state === 'suspended') {
    ctx.resume().then(run).catch(() => playTones(steps));
    return;
  }
  run();
}

/** Call in the mic tap (user gesture): resume the context and pre-decode. */
export function primeMicReadyChime() {
  const ctx = audioCtx();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
  startOutputKeepAlive();
  preloadChimes();
}

/**
 * Single playback path: decoded short WAV through AudioContext, oscillators as fallback.
 */
export async function playMicReadyChime(ctx = null) {
  const target = ctx || audioCtx();
  startOutputKeepAlive();
  try {
    const dur = await playChimeBuffer('mic', target);
    const how = `buffer ${dur.toFixed(2)}s ctx=${target ? target.state : 'none'}`;
    debugLog('audio', 'mic chime played', { how });
    return how;
  } catch (err) {
    playTonesOnContext(target, MIC_READY_TONES);
    const how = `tones(${target ? target.state : 'no-ctx'}) err=${err?.name || String(err)}`;
    debugLog('audio', 'mic chime fell back to tones', { how });
    return how;
  }
}

const MIC_OFF_TONES = [
  { freq: 880, at: 0, dur: 0.038, peak: 0.35 },
  { freq: 440, at: 0.032, dur: 0.045, peak: 0.35 },
];

/** Mic turned off — short 75ms falling sound. */
export function playMicOffBeep() {
  playNamedChime('mic_off', () => playTones(MIC_OFF_TONES));
}

/** Speaker / TTS output enabled (75ms). */
export function playSpeakerOnBeep() {
  playTones([
    { freq: 640, at: 0, dur: 0.04, peak: 0.35 },
    { freq: 960, at: 0.035, dur: 0.05, peak: 0.38 },
  ]);
}

/** Speaker / TTS output disabled (75ms). */
export function playSpeakerOffBeep() {
  playTones([
    { freq: 960, at: 0, dur: 0.035, peak: 0.38 },
    { freq: 480, at: 0.035, dur: 0.05, peak: 0.35 },
  ]);
}

export function playBase64Audio(audioBase64, contentType = 'audio/mpeg', { signal } = {}) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const mime = contentType || 'audio/mpeg';
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.preload = 'auto';
  audio.loop = false;
  audio.src = url;

  // Rough upper bound so a stuck duration/onended never leaves UI on "Lecture…"
  const safetyMs = Math.min(120_000, Math.max(8_000, Math.ceil(bytes.length / 6) + 4_000));

  return new Promise((resolve, reject) => {
    let settled = false;
    let pollId = 0;
    let safetyId = 0;

    const cleanup = () => {
      if (pollId) window.clearInterval(pollId);
      if (safetyId) window.clearTimeout(safetyId);
      signal?.removeEventListener('abort', onAbort);
      try { audio.pause(); } catch { /* ignore */ }
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    };

    const finish = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };

    const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));

    const maybeDone = () => {
      const d = audio.duration;
      const t = audio.currentTime;
      if (Number.isFinite(d) && d > 0 && t >= d - 0.08) {
        finish();
      }
    };

    audio.onended = () => {
      // Some browsers fire onended a bit early on blob mp3 — verify position
      const d = audio.duration;
      const t = audio.currentTime;
      if (!Number.isFinite(d) || d <= 0 || t >= d - 0.25) finish();
      else {
        // wait out the remainder
        const leftMs = Math.max(50, (d - t) * 1000 + 80);
        window.setTimeout(() => finish(), leftMs);
      }
    };
    audio.onerror = () => finish(new Error('Lecture audio échouée'));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    pollId = window.setInterval(maybeDone, 200);
    safetyId = window.setTimeout(() => finish(), safetyMs);

    void audio.play().catch((err) => finish(err));
  });
}

/** Merge short TTS pieces into neighbors. */
export function mergeTinySpeechChunks(chunks, minChars = 80) {
  const out = [];
  let buf = '';
  for (const c of chunks) {
    const piece = String(c || '').trim();
    if (!piece) continue;
    buf = buf ? `${buf} ${piece}` : piece;
    if (buf.length >= minChars) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) {
    if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${buf}`;
    else out.push(buf);
  }
  return out;
}

/**
 * Under this size, prefer a single TTS call (complete take, no mid-cut).
 * Must stay under server MAX_TTS_CHARS (2000).
 */
export const SINGLE_SHOT_TTS_MAX = 1800;

/**
 * Stream-like TTS: prefetch while playing. Use for long texts only.
 */
export async function playSpeechChunkPipeline(chunks, fetchChunk, opts = {}) {
  const list = Array.isArray(chunks) ? chunks.filter(Boolean) : [];
  if (!list.length) return;
  const signal = opts.signal;
  const prefetch = Math.max(1, opts.prefetch ?? 2);
  const onProgress = opts.onProgress;

  await unlockAudioPlayback();

  /** @type {Array<Promise<{ audioBase64: string, contentType?: string }>|null>} */
  const jobs = list.map(() => null);

  const ensure = (i) => {
    if (!jobs[i]) {
      jobs[i] = Promise.resolve().then(() => fetchChunk(list[i], i));
    }
    return jobs[i];
  };

  for (let i = 0; i < Math.min(prefetch, list.length); i++) ensure(i);

  for (let i = 0; i < list.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress?.(i + 1, list.length);
    const ahead = i + prefetch;
    if (ahead < list.length) ensure(ahead);

    const payload = await ensure(i);
    if (!payload?.audioBase64) throw new Error('Speech synthesis failed');
    await playBase64Audio(payload.audioBase64, payload.contentType || 'audio/mpeg', { signal });
  }
}

/**
 * Universal browser Web Speech synthesis fallback (works offline / with zero cloud keys).
 */
export function speakViaBrowserSpeechSynthesis(text, { lang = 'fr-FR', signal } = {}) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve(false);
      return;
    }
    window.speechSynthesis.cancel();
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      resolve(false);
      return;
    }
    const utter = new SpeechSynthesisUtterance(cleanText);
    const l = String(lang || 'fr').toLowerCase();
    utter.lang = l.startsWith('en') ? 'en-US' : (l.startsWith('es') ? 'es-ES' : 'fr-FR');
    utter.rate = 1.0;
    utter.pitch = 1.0;

    let settled = false;
    const finish = (result = true) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    utter.onend = () => finish(true);
    utter.onerror = () => finish(false);

    if (signal) {
      signal.addEventListener('abort', () => {
        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
        finish(false);
      }, { once: true });
    }

    try {
      window.speechSynthesis.speak(utter);
    } catch {
      finish(false);
    }
  });
}
