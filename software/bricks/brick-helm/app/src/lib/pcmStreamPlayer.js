/**
 * Gapless PCM s16le playback with prefetch + chunk coalescing
 * so Cartesia/Deepgram streams do not sound choppy between WS frames.
 *
 * Each session owns an AudioContext. A registry lets pause/stop hit
 * every live player (orphans after locale switch / double session).
 */

/** @type {Set<ReturnType<typeof createPcmStreamPlayer>>} */
const activePlayers = new Set();

export async function pauseAllPcmPlayers() {
  await Promise.all([...activePlayers].map((p) => p.pause().catch(() => {})));
}

export async function resumeAllPcmPlayers() {
  await Promise.all([...activePlayers].map((p) => p.resume().catch(() => {})));
}

export function stopAllPcmPlayers() {
  for (const p of [...activePlayers]) {
    try { p.stop(); } catch { /* ignore */ }
  }
  activePlayers.clear();
}

export function createPcmStreamPlayer({
  sampleRate = 24000,
  signal,
  prefetchSec = 0.45,
  minPlaySec = 0.14,
} = {}) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('Web Audio API indisponible');

  const ctx = new AudioCtx({ sampleRate });
  const minPlaySamples = Math.max(512, Math.floor(sampleRate * minPlaySec));
  let nextTime = 0;
  /** @type {number|null} */
  let originCtxTime = null;
  let pausedAtCtx = null;
  let closed = false;
  let started = false;
  let bufferedSec = 0;
  /** @type {Float32Array} */
  let pending = new Float32Array(0);
  /** @type {AudioBuffer[]} */
  const queue = [];

  const api = {
    enqueueBase64,
    flushPrefetch,
    waitUntilIdle,
    getPlaybackSeconds,
    getDurationSeconds,
    hasStarted,
    pause,
    resume,
    isPaused,
    stop,
    get closed() { return closed; },
  };
  activePlayers.add(api);

  const onAbort = () => {
    stop();
  };
  if (signal) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    signal.addEventListener('abort', onAbort, { once: true });
  }

  function ensureRunning() {
    // Do not auto-resume while user-paused — otherwise a late PCM frame
    // restarts the "orphan" French voice under a paused karaoke session.
    if (ctx.state === 'suspended' && pausedAtCtx == null) return ctx.resume();
    return Promise.resolve();
  }

  function appendPending(float32) {
    if (!float32.length) return;
    const merged = new Float32Array(pending.length + float32.length);
    merged.set(pending, 0);
    merged.set(float32, pending.length);
    pending = merged;
  }

  function takePending(minSamples = minPlaySamples) {
    if (pending.length < minSamples) return null;
    const chunk = pending.slice(0, minSamples);
    pending = pending.slice(minSamples);
    return chunk;
  }

  // Master output chain: dynamics compressor for punch + gain boost for loud, clear voice
  let outputNode = ctx.destination;
  try {
    const compressor = ctx.createDynamicsCompressor ? ctx.createDynamicsCompressor() : null;
    const gainNode = ctx.createGain ? ctx.createGain() : null;
    if (compressor && gainNode) {
      compressor.threshold.value = -20;
      compressor.knee.value = 30;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      gainNode.gain.value = 1.35; // +35% volume boost for clear presence
      compressor.connect(gainNode);
      gainNode.connect(ctx.destination);
      outputNode = compressor;
    } else if (gainNode) {
      gainNode.gain.value = 1.35;
      gainNode.connect(ctx.destination);
      outputNode = gainNode;
    }
  } catch {
    outputNode = ctx.destination;
  }

  function scheduleBuffer(buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(outputNode);

    const now = ctx.currentTime;
    // Underrun: shift origin so karaoke waits (timestamps stay aligned with content)
    if (nextTime < now + 0.03) {
      const slip = (now + 0.03) - nextTime;
      nextTime = now + 0.03;
      if (originCtxTime != null) originCtxTime += slip;
    }
    if (originCtxTime == null) originCtxTime = nextTime;
    src.start(nextTime);
    nextTime += buf.duration;
  }

  function scheduleFloat32(float32) {
    if (!float32.length) return;
    const buf = ctx.createBuffer(1, float32.length, sampleRate);
    buf.copyToChannel(float32, 0);
    scheduleBuffer(buf);
  }

  function drainPending(force = false) {
    if (force && pending.length > 0 && pending.length < minPlaySamples) {
      scheduleFloat32(pending);
      pending = new Float32Array(0);
      return;
    }
    while (pending.length >= minPlaySamples) {
      const chunk = takePending(minPlaySamples);
      if (!chunk?.length) break;
      scheduleFloat32(chunk);
    }
  }

  function flushQueue() {
    while (queue.length) {
      scheduleBuffer(queue.shift());
    }
    drainPending(true);
  }

  /**
   * @param {string} base64 — pcm_s16le mono
   */
  async function enqueueBase64(base64) {
    if (closed || signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (pausedAtCtx != null) {
      // Buffer while paused; do not schedule into a suspended ctx race.
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const even = bytes.byteLength - (bytes.byteLength % 2);
      if (even < 2) return;
      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, even / 2);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
      appendPending(float32);
      return;
    }
    await ensureRunning();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const even = bytes.byteLength - (bytes.byteLength % 2);
    if (even < 2) return;

    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, even / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    appendPending(float32);

    if (!started) {
      bufferedSec = pending.length / sampleRate;
      if (bufferedSec >= prefetchSec) {
        started = true;
        while (pending.length >= minPlaySamples) {
          const chunk = takePending(minPlaySamples);
          if (!chunk) break;
          const buf = ctx.createBuffer(1, chunk.length, sampleRate);
          buf.copyToChannel(chunk, 0);
          queue.push(buf);
        }
        flushQueue();
      }
      return;
    }

    drainPending(false);
  }

  /** Flush remaining prefetch if stream ends before threshold. */
  function flushPrefetch() {
    if (closed || pausedAtCtx != null) return;
    if (!started) {
      if (!pending.length) return;
      started = true;
      void ensureRunning().then(() => flushQueue());
      return;
    }
    drainPending(true);
  }

  function getPlaybackSeconds() {
    if (originCtxTime == null || closed) return 0;
    const t = pausedAtCtx != null ? pausedAtCtx : ctx.currentTime;
    // Don't advance karaoke before first sample actually plays
    return Math.max(0, t - originCtxTime);
  }

  /** Scheduled + pending PCM length (seconds), independent of playhead. */
  function getDurationSeconds() {
    if (closed) return 0;
    let queued = 0;
    for (const buf of queue) queued += buf.duration;
    const pendingSec = pending.length / sampleRate;
    if (originCtxTime == null) return queued + pendingSec;
    return Math.max(0, nextTime - originCtxTime) + pendingSec;
  }

  function hasStarted() {
    return started && originCtxTime != null && !closed;
  }

  async function pause() {
    if (closed || ctx.state === 'suspended') return;
    pausedAtCtx = ctx.currentTime;
    await ctx.suspend();
  }

  async function resume() {
    if (closed) return;
    pausedAtCtx = null;
    if (ctx.state === 'suspended') await ctx.resume();
    // Schedule anything buffered while paused
    if (pending.length) {
      if (!started) {
        started = true;
        flushQueue();
      } else {
        drainPending(true);
      }
    }
  }

  function isPaused() {
    return pausedAtCtx != null || ctx.state === 'suspended';
  }

  async function waitUntilIdle() {
    flushPrefetch();
    if (closed) return;
    while (!closed) {
      if (ctx.state === 'suspended') {
        await new Promise((r) => setTimeout(r, 120));
        continue;
      }
      if (!started) {
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      const remaining = Math.max(0, (nextTime - ctx.currentTime) * 1000);
      if (remaining <= 0 && !pending.length) return;
      await new Promise((r) => setTimeout(r, Math.min(remaining + 40, 250)));
    }
  }

  function stop() {
    if (closed) return;
    closed = true;
    activePlayers.delete(api);
    signal?.removeEventListener('abort', onAbort);
    queue.length = 0;
    pending = new Float32Array(0);
    nextTime = 0;
    originCtxTime = null;
    pausedAtCtx = null;
    started = false;
    bufferedSec = 0;
    void ctx.close().catch(() => {});
  }

  return api;
}
