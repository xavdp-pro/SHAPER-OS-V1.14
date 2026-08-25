import { getActiveLocale, getAuthToken } from '../api/client.js';
import { createPcmStreamPlayer } from './pcmStreamPlayer.js';

function voiceTtsStreamUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getAuthToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${proto}//${window.location.host}/api/voice/tts-stream${q}`;
}

/**
 * Browser client for Helm TTS WebSocket proxy (Cartesia or Deepgram).
 * Protocol is provider-agnostic; karaoke timestamps only when server sends them.
 *
 * @param {{
 *   lang?: string,
 *   voiceId?: string,
 *   signal?: AbortSignal,
 *   onError?: (err: Error) => void,
 *   onTimestamps?: (batch: { words: string[], start: number[], end: number[] }) => void,
 *   onPlaybackClock?: (getSeconds: () => number, hasStarted: () => boolean) => void,
 *   onDuration?: (seconds: number) => void,
 * }} [opts]
 */
export function createVoiceTtsStreamSession({
  lang,
  voiceId,
  signal,
  onError,
  onTimestamps,
  onPlaybackClock,
  onDuration,
} = {}) {
  const locale = lang || getActiveLocale();
  const ws = new WebSocket(voiceTtsStreamUrl());
  const player = createPcmStreamPlayer({ sampleRate: 24000, signal, prefetchSec: 0.32, minPlaySec: 0.1 });

  onPlaybackClock?.(
    () => player.getPlaybackSeconds(),
    () => player.hasStarted(),
  );

  let readyResolve;
  let readyReject;
  let readySettled = false;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  let doneResolve;
  const donePromise = new Promise((resolve) => {
    doneResolve = resolve;
  });

  let closed = false;
  let ending = false;
  let finishingPlayback = false;
  let playChain = Promise.resolve();

  const fail = (err) => {
    if (!readySettled) {
      readySettled = true;
      readyReject(err);
    }
    onError?.(err);
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    doneResolve?.();
  };

  const finishAfterPlayback = () => {
    if (finishingPlayback || closed) return;
    finishingPlayback = true;
    ending = true;
    player.flushPrefetch?.();
    void playChain
      .then(() => player.waitUntilIdle())
      .catch(() => {})
      .finally(() => {
        try { player.stop(); } catch { /* ignore */ }
        try { ws.close(); } catch { /* ignore */ }
        finish();
      });
  };

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      type: 'start',
      lang: locale,
      voiceId: voiceId || undefined,
    }));
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      if (!readySettled) {
        readySettled = true;
        readyResolve(msg);
      }
      return;
    }
    if (msg.type === 'timestamps') {
      onTimestamps?.({
        words: msg.words || [],
        start: msg.start || [],
        end: msg.end || [],
      });
      return;
    }
    if (msg.type === 'audio' && msg.data) {
      // Ignore late frames after we already decided to end (prevents one extra replay).
      if (closed || finishingPlayback) return;
      // Order chunks without awaiting decode — playback coalesces in pcmStreamPlayer.
      playChain = playChain.then(() => {
        if (closed || finishingPlayback) return;
        return player.enqueueBase64(msg.data)?.then(() => {
          onDuration?.(player.getDurationSeconds());
        });
      }).catch((err) => {
        if (err?.name === 'AbortError') return;
        fail(err instanceof Error ? err : new Error(String(err)));
      });
      return;
    }
    if (msg.type === 'done') {
      finishAfterPlayback();
      return;
    }
    if (msg.type === 'error') {
      fail(new Error(msg.error || 'TTS stream error'));
      try { ws.close(); } catch { /* ignore */ }
      finish();
    }
  });

  ws.addEventListener('error', () => {
    fail(new Error('Connexion TTS WebSocket échouée'));
    finishAfterPlayback();
  });

  ws.addEventListener('close', () => {
    if (!readySettled) {
      readySettled = true;
      readyReject(new Error('TTS WebSocket fermé avant ready'));
    }
    // Wait for queued PCM — do not cut karaoke/audio early
    finishAfterPlayback();
  });

  if (signal) {
    const onAbort = () => {
      cancel();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  function send(payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function push(transcript) {
    const text = String(transcript || '').trim();
    if (!text || closed || ending) return;
    send({ type: 'push', transcript: text });
  }

  function end(lastTranscript = '') {
    if (closed) return donePromise;
    ending = true;
    send({ type: 'end', transcript: lastTranscript || undefined });
    return donePromise;
  }

  function cancel() {
    ending = true;
    player.stop();
    if (ws.readyState === WebSocket.OPEN) {
      try { send({ type: 'cancel' }); } catch { /* ignore */ }
    }
    try { ws.close(); } catch { /* ignore */ }
    finish();
  }

  return {
    ready: readyPromise,
    done: donePromise,
    push,
    end,
    cancel,
    pause: () => player.pause(),
    resume: () => player.resume(),
    isPaused: () => player.isPaused(),
    getPlaybackSeconds: () => player.getPlaybackSeconds(),
    getDurationSeconds: () => player.getDurationSeconds(),
  };
}
