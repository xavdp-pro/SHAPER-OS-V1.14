const SILENCE_MS = 1400;
const MIN_SPEECH_MS = 400;
const VOLUME_THRESHOLD = 0.018;
const TICK_MS = 120;

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

/**
 * Mic session: detects end of phrase (silence) → callback(audioBlob, mimeType).
 */
export function createVoiceMicSession({ onUtterance, onError }) {
  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let recorder = null;
  let chunks = [];
  let rafId = null;
  let active = false;
  let speaking = false;
  let speechStartedAt = 0;
  let silenceStartedAt = 0;
  const mimeType = pickMimeType();

  function cleanupRecorder() {
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignore */ }
    }
    recorder = null;
    chunks = [];
  }

  async function flushRecording() {
    if (!recorder || recorder.state === 'inactive') return;
    const rec = recorder;
    const done = new Promise((resolve) => {
      rec.onstop = () => resolve();
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    chunks = [];
    recorder = null;
    if (blob.size > 0) {
      await onUtterance(blob, mimeType || 'audio/webm');
    }
  }

  function tick() {
    if (!active || !analyser) return;

    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    const now = Date.now();

    if (rms >= VOLUME_THRESHOLD) {
      if (!speaking) {
        speaking = true;
        speechStartedAt = now;
        silenceStartedAt = 0;
        chunks = [];
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => {
          if (e.data?.size) chunks.push(e.data);
        };
        recorder.start();
      } else {
        silenceStartedAt = 0;
      }
    } else if (speaking) {
      if (!silenceStartedAt) silenceStartedAt = now;
      const spokeMs = now - speechStartedAt;
      const silentMs = now - silenceStartedAt;
      if (silentMs >= SILENCE_MS && spokeMs >= MIN_SPEECH_MS) {
        speaking = false;
        silenceStartedAt = 0;
        void flushRecording();
      }
    }

    rafId = window.setTimeout(tick, TICK_MS);
  }

  async function start() {
    if (active) return;
    if (!mimeType && typeof MediaRecorder !== 'undefined') {
      throw new Error('Audio format not supported by this browser');
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    active = true;
    tick();
  }

  async function stop() {
    active = false;
    if (rafId) {
      clearTimeout(rafId);
      rafId = null;
    }
    if (speaking) {
      speaking = false;
      await flushRecording();
    } else {
      cleanupRecorder();
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    await audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyser = null;
  }

  return {
    start,
    stop,
    get active() { return active; },
  };
}

export async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * @param {string} base64
 * @param {string} [contentType]
 * @param {{ signal?: AbortSignal }} [opts]
 */
/**
 * @param {string} base64
 * @param {string} [contentType]
 * @param {{ signal?: AbortSignal, audioRef?: { current: HTMLAudioElement|null } }} [opts]
 */
export async function playBase64Audio(base64, contentType = 'audio/mpeg', opts = {}) {
  const signal = opts.signal;
  const audioRef = opts.audioRef;
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const mime = contentType || 'audio/mpeg';
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.preload = 'auto';
  audio.loop = false;
  audio.src = url;
  if (audioRef) audioRef.current = audio;

  // WAV ~48kB/s @ 24kHz mono; MP3 much less — keep generous upper bound
  const safetyMs = Math.min(180_000, Math.max(12_000, Math.ceil(bytes.length / 24) + 6_000));

  await new Promise((resolve, reject) => {
    let settled = false;
    let pollId = 0;
    let safetyId = 0;

    const cleanup = () => {
      if (pollId) window.clearInterval(pollId);
      if (safetyId) window.clearTimeout(safetyId);
      signal?.removeEventListener('abort', onAbort);
      if (audioRef && audioRef.current === audio) audioRef.current = null;
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
      if (audio.paused && audioRef?.current === audio && !signal?.aborted) return;
      const d = audio.duration;
      const t = audio.currentTime;
      if (Number.isFinite(d) && d > 0 && t >= d - 0.08) finish();
    };

    audio.onended = () => {
      const d = audio.duration;
      const t = audio.currentTime;
      if (!Number.isFinite(d) || d <= 0 || t >= d - 0.25) finish();
      else window.setTimeout(() => finish(), Math.max(50, (d - t) * 1000 + 80));
    };
    audio.onerror = () => finish(new Error('Audio playback failed'));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    pollId = window.setInterval(maybeDone, 200);
    safetyId = window.setTimeout(() => finish(), safetyMs);

    void audio.play().catch((err) => finish(err));
  });
}
