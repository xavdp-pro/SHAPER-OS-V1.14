import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceStatus, voiceAck, voiceTts, voiceAckSpeak, voiceNormalize } from '../api/client.js';
import {
  extractCursorStreamSpeech,
  speechTextFromAssistant,
  takeSpeakableChunks,
  undoubleSpeechText,
  VOICE_TTS_CHUNK_MAX,
} from '../lib/voiceCursorLoop.js';
import { stripLeadingVoiceAckForTts } from '../lib/voiceAckStrip.js';
import { playBase64Audio } from '../lib/voiceMic.js';
import { unlockAudioPlayback, primeMicReadyChime, playGoConfirmBeep, playClearConfirmBeep, playStopConfirmBeep, playMicOffBeep, playSpeakerOnBeep, playSpeakerOffBeep, getSharedAudioContext, speakViaBrowserSpeechSynthesis } from '../lib/voicePlaybackPipeline.js';
import { mergeTinySpeechChunks } from '../lib/voicePlaybackPipeline.js';
import { createRealtimeSttSession } from '../lib/voiceRealtimeStt.js';
import { debugLog } from '../lib/clientDebugLog.js';
import { loadVoicePlaybackEnabled, saveVoicePlaybackEnabled, loadKaraokeEnabled, saveKaraokeEnabled, loadMicWanted, saveMicWanted } from '../lib/voicePrefs.js';
import {
  splitVoiceSendCommand,
  splitVoiceClearCommand,
  splitVoiceRebornCommand,
  hasVoiceStopKeyword,
  hasVoiceRebornKeyword,
} from '../lib/voiceSendTrigger.js';
import { createVoiceTtsStreamSession } from '../lib/voiceTtsStream.js';
import {
  estimateKaraokeWords,
  estimateKaraokeSentences,
  estimatedSpeechDuration,
  rescaleKaraokeUnits,
  karaokeIndexAt,
} from '../lib/karaokeTiming.js';
import { getActiveLocale } from '../api/client.js';
import { pauseAllPcmPlayers, resumeAllPcmPlayers, stopAllPcmPlayers } from '../lib/pcmStreamPlayer.js';
import { useLocale } from '../context/LocaleContext.jsx';

const TTS_MUTE_COOLDOWN_MS = 900;
/** Ready chime length + margin — the mic opens only once it has finished. */
const MIC_CHIME_MS = 700;

function isAbortError(err) {
  return err?.name === 'AbortError'
    || (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError');
}

export function useChatVoice({
  onSend,
  onBeginVoiceSend,
  onFinishVoiceSend,
  onAbortVoiceSend,
  /** Interrupt the running agent — wired to the same action as the Stop button. */
  onVoiceStop,
  /** Trigger session reborn by voice command (« reborn », « reboot »). */
  onVoiceReborn,
  onVoiceResponseGate,
  onVoiceAck,
  setDraft,
  getDraft,
  canSend,
  getAgentBusy,
  getPresentationActive,
  pushToast,
  cursorPure = false,
  interactionMode = 'view',
  desktopLayout = false,
}) {
  const { locale, t } = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  /** Ignore late STT echoes (e.g. lone « go ») after a voice send. */
  const ignoreDraftUntilRef = useRef(0);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onBeginVoiceSendRef = useRef(onBeginVoiceSend);
  onBeginVoiceSendRef.current = onBeginVoiceSend;
  const onFinishVoiceSendRef = useRef(onFinishVoiceSend);
  onFinishVoiceSendRef.current = onFinishVoiceSend;
  const onAbortVoiceSendRef = useRef(onAbortVoiceSend);
  onAbortVoiceSendRef.current = onAbortVoiceSend;
  const onVoiceStopRef = useRef(onVoiceStop);
  onVoiceStopRef.current = onVoiceStop;
  const onVoiceRebornRef = useRef(onVoiceReborn);
  onVoiceRebornRef.current = onVoiceReborn;
  const onVoiceResponseGateRef = useRef(onVoiceResponseGate);
  onVoiceResponseGateRef.current = onVoiceResponseGate;
  const onVoiceAckRef = useRef(onVoiceAck);
  onVoiceAckRef.current = onVoiceAck;
  const setDraftRef = useRef(setDraft);
  setDraftRef.current = setDraft;
  const getDraftRef = useRef(getDraft || (() => ''));
  getDraftRef.current = getDraft || (() => '');
  const canSendRef = useRef(canSend || (() => true));
  canSendRef.current = canSend || (() => true);
  const getAgentBusyRef = useRef(getAgentBusy || (() => false));
  getAgentBusyRef.current = getAgentBusy || (() => false);
  const getPresentationActiveRef = useRef(getPresentationActive || (() => false));
  getPresentationActiveRef.current = getPresentationActive || (() => false);
  /** Prime/briefing text already fed to live TTS during SSE — skip batch replaySpeech. */
  const primeLiveTtsRef = useRef(false);
  /** Presentation with voice autoplay — live lane only, never batch replay at end. */
  const presentationLiveTtsRef = useRef(false);
  /** True once live TTS actually queued audio for this presentation. */
  const primeTtsSpokeRef = useRef(false);
  const cursorPureRef = useRef(cursorPure);
  cursorPureRef.current = cursorPure;

  const markPresentationTts = useCallback(() => {
    if (!presentationLiveTtsRef.current && !getPresentationActiveRef.current()) return;
    primeTtsSpokeRef.current = true;
    primeLiveTtsRef.current = true;
  }, []);

  const interactionModeRef = useRef(interactionMode);
  const desktopLayoutRef = useRef(desktopLayout);
  interactionModeRef.current = interactionMode;
  desktopLayoutRef.current = desktopLayout;

  const voiceAutoplayEnabled = useCallback(() => playbackOnRef.current, []);

  const armRouteVoice = useCallback(() => {
    void unlockAudioPlayback();
  }, []);

  const [playbackOn, setPlaybackOn] = useState(() => loadVoicePlaybackEnabled());
  const [karaokeOn, setKaraokeOn] = useState(() => loadKaraokeEnabled());
  const [micLive, setMicLive] = useState(false);
  /** off | connecting | arming | listening */
  const [micPhase, setMicPhase] = useState('off');
  const [micArmLeftMs, setMicArmLeftMs] = useState(0);
  const [configured, setConfigured] = useState(false);
  /** null until /voice/status resolves — avoids HTTP+WS double speak on cold boot. */
  const [ttsStream, setTtsStream] = useState(/** @type {boolean|null} */ (null));
  /** @type {[string|null, function]} */
  const [ttsProviderName, setTtsProviderName] = useState(null);
  const [groqAck, setGroqAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [voicePreview, setVoicePreview] = useState('');
  const [karaokeWords, setKaraokeWords] = useState(/** @type {Array<{word:string,start:number,end:number,wordStart?:number,wordEnd?:number}>} */ ([]));
  const [karaokeIndex, setKaraokeIndex] = useState(-1);
  const [karaokeGrain, setKaraokeGrain] = useState(/** @type {'word'|'sentence'} */ ('word'));
  const [activeReplayId, setActiveReplayId] = useState('');

  const sttRef = useRef(null);
  const playingRef = useRef(false);
  const busyRef = useRef(false);
  const micLiveRef = useRef(false);
  const muteUntilRef = useRef(0);
  const micMutedRef = useRef(false);
  const playbackOnRef = useRef(playbackOn);
  const ttsStreamRef = useRef(/** @type {boolean|null} */ (null));
  const ttsProviderRef = useRef(/** @type {string|null} */ (null));
  const groqAckRef = useRef(false);
  /** Groq ack lane — HTTP one-shot TTS, never shares Composer WS stream. */
  const ackPlayingRef = useRef(false);
  const ackPlaybackPromiseRef = useRef(/** @type {Promise<void>|null} */ (null));
  const ackAbortRef = useRef(/** @type {AbortController|null} */ (null));
  /** Bumps on each manual replay so a previous loop cannot keep speaking. */
  const replayGenRef = useRef(0);
  /** Voice turns: strip Composer leading ack from TTS (Groq already spoke it). */
  const stripComposerAckRef = useRef(false);
  /** Exact Groq ack text already spoken — skip re-TTS of the same phrase. */
  const spokenAckRef = useRef('');
  /** Karaoke timestamps exist only for Cartesia Sonic WS. */
  const streamSessionRef = useRef(null);
  const streamPushChainRef = useRef(Promise.resolve());
  const htmlAudioRef = useRef(/** @type {HTMLAudioElement|null} */ (null));
  const ackAudioRef = useRef(/** @type {HTMLAudioElement|null} */ (null));
  const karaokeWordsRef = useRef(/** @type {Array<{word:string,start:number,end:number,wordStart?:number,wordEnd?:number}>} */ ([]));
  const karaokeGrainRef = useRef(/** @type {'word'|'sentence'} */ ('word'));
  const sentenceMetaRef = useRef({ text: '', estimated: 0, applied: 0 });
  const getPlaybackSecRef = useRef(() => 0);
  /** Cumulative seconds already played on the HTTP lane (estimated karaoke offset). */
  const httpKaraokeBaseRef = useRef(0);
  const karaokeRafRef = useRef(0);
  const spokenGuardRef = useRef({ key: '', text: '', at: 0 });
  /** Hold final speech until /voice/status resolves (avoid HTTP start before Cartesia WS). */
  const pendingFinalSpeakRef = useRef(/** @type {{ text: string, runKey: string }|null} */ (null));
  /** Bumped to cancel an in-flight HTTP drain (must not finish after Cartesia WS starts). */
  const httpDrainGenRef = useRef(0);
  /** True once Cartesia WS delivered audio/timestamps for the current speak attempt. */
  const streamAudioReceivedRef = useRef(false);
  /** Bumped on every composer speak/stop — stale WS/HTTP tasks must no-op. */
  const speakGenRef = useRef(0);
  const streamRef = useRef({
    runKey: '',
    queuedLen: 0,
    lastSpeech: '',
    queue: [],
    draining: false,
    abort: null,
    speechComplete: false,
    composerAckGated: false,
    composerFinalized: false,
    /** Sync guard: final end already requested (before async WS close). */
    composerEndRequested: false,
  });

  const karaokeOnRef = useRef(karaokeOn);
  const activeReplayIdRef = useRef('');
  activeReplayIdRef.current = activeReplayId;

  playbackOnRef.current = playbackOn;
  busyRef.current = busy;
  micLiveRef.current = micLive;
  ttsStreamRef.current = ttsStream;
  ttsProviderRef.current = ttsProviderName;
  groqAckRef.current = groqAck;
  // Karaoke: Cartesia = word timestamps; Deepgram = current sentence from PCM clock.
  const karaokeSupported = Boolean(ttsProviderName);
  const karaokeActive = Boolean(karaokeOn && karaokeSupported);
  karaokeOnRef.current = karaokeActive;

  const pipelineActive = useCallback(() => {
    const s = streamRef.current;
    return playingRef.current
      || ackPlayingRef.current
      || s.draining
      || s.queue.length > 0
      || Boolean(streamSessionRef.current);
  }, []);

  /** True while the agent runs: transcripts are dropped unless they say « stop ». */
  const stopOnlyRef = useRef(false);
  /** Deepgram repeats the keyword across interim frames — fire the stop once. */
  const stopCooldownRef = useRef(0);
  /** When the ready chime fired — measures the gap until the mic is truly open. */
  const chimeAtRef = useRef(0);

  const shouldMuteMicCapture = useCallback(() => (
    playingRef.current
    || ackPlayingRef.current
    || Boolean(streamSessionRef.current)
    || getAgentBusyRef.current()
  ), []);

  const shouldBlockVoiceInput = useCallback(() => (
    shouldMuteMicCapture()
    || Date.now() < muteUntilRef.current
  ), [shouldMuteMicCapture]);

  const syncMicMute = useCallback(() => {
    const session = sttRef.current;
    if (!session || !micLiveRef.current) return;
    const block = shouldMuteMicCapture();
    if (block) {
      // Keep capturing while the agent runs, otherwise « stop » could never be
      // heard. Everything transcribed in this window is discarded except the
      // stop keyword — see stopOnlyRef in the draft/committed handlers.
      stopOnlyRef.current = session.listening;
      if (stopOnlyRef.current) {
        if (micMutedRef.current) {
          session.unmute();
          micMutedRef.current = false;
        }
      } else if (!micMutedRef.current) {
        session.mute();
        micMutedRef.current = true;
      }
      return;
    }
    stopOnlyRef.current = false;
    // Stay muted until armListening() — warmup must not capture speech.
    if (!session.listening) {
      micMutedRef.current = true;
      session.mute();
      return;
    }
    if (micMutedRef.current) {
      session.unmute();
      micMutedRef.current = false;
    }
  }, [shouldMuteMicCapture]);

  const clearKaraoke = useCallback(() => {
    if (karaokeRafRef.current) {
      cancelAnimationFrame(karaokeRafRef.current);
      karaokeRafRef.current = 0;
    }
    karaokeWordsRef.current = [];
    setKaraokeWords([]);
    setKaraokeIndex(-1);
    karaokeGrainRef.current = 'word';
    setKaraokeGrain('word');
    sentenceMetaRef.current = { text: '', estimated: 0, applied: 0 };
    getPlaybackSecRef.current = () => 0;
    httpKaraokeBaseRef.current = 0;
  }, []);

  const applyWordUnits = useCallback((text, durationSec, baseSec = 0) => {
    const units = estimateKaraokeWords(text, durationSec, baseSec);
    karaokeGrainRef.current = 'word';
    setKaraokeGrain('word');
    karaokeWordsRef.current = units;
    setKaraokeWords(units);
    sentenceMetaRef.current = {
      text: String(text || ''),
      estimated: Number(durationSec) || estimatedSpeechDuration(text),
      applied: Number(durationSec) || 0,
    };
  }, []);

  const applySentenceUnits = applyWordUnits;

  const maybeRescaleWords = useCallback((actualSec) => {
    const meta = sentenceMetaRef.current;
    if (!meta.text) return;
    const actual = Number(actualSec);
    if (!Number.isFinite(actual) || actual < 0.45) return;
    const estimated = meta.estimated || estimatedSpeechDuration(meta.text);
    if (actual < estimated * 0.88) return;
    if (Math.abs(actual - meta.applied) < 0.12) return;
    const next = rescaleKaraokeUnits(karaokeWordsRef.current, actual);
    if (!next.length) return;
    karaokeWordsRef.current = next;
    setKaraokeWords(next);
    sentenceMetaRef.current = { ...meta, applied: actual };
  }, []);

  const maybeRescaleSentences = maybeRescaleWords;

  const appendKaraokeWords = useCallback((words) => {
    if (!words?.length) return;
    const next = karaokeWordsRef.current.concat(words);
    karaokeWordsRef.current = next;
    setKaraokeWords(next);
  }, []);

  const appendKaraokeTimestamps = useCallback((batch) => {
    const words = batch?.words || [];
    if (!words.length) return;
    karaokeGrainRef.current = 'word';
    setKaraokeGrain('word');
    const starts = batch.start || [];
    const ends = batch.end || [];
    const next = karaokeWordsRef.current.slice();
    for (let i = 0; i < words.length; i++) {
      next.push({
        word: String(words[i] || ''),
        start: Number(starts[i]) || 0,
        end: Number(ends[i]) || Number(starts[i]) || 0,
      });
    }
    karaokeWordsRef.current = next;
    setKaraokeWords(next);
  }, []);

  const startKaraokeClock = useCallback(() => {
    if (karaokeRafRef.current) return;
    const tick = () => {
      const list = karaokeWordsRef.current;
      const t = getPlaybackSecRef.current();
      const actual = streamSessionRef.current?.getDurationSeconds?.() || 0;
      if (actual > 0) {
        maybeRescaleWords(actual);
      }
      const idx = karaokeIndexAt(list, t);
      setKaraokeIndex((prev) => (prev === idx ? prev : idx));
      karaokeRafRef.current = requestAnimationFrame(tick);
    };
    karaokeRafRef.current = requestAnimationFrame(tick);
  }, [maybeRescaleWords]);

  const armKaraokeForWsReady = useCallback((ready, speech) => {
    if (!karaokeOnRef.current || !String(speech || '').trim()) return;
    if (ready?.timestamps) {
      karaokeGrainRef.current = 'word';
      setKaraokeGrain('word');
      return;
    }
    applyWordUnits(speech, estimatedSpeechDuration(speech));
    startKaraokeClock();
  }, [applyWordUnits, startKaraokeClock]);

  const stopAckPlayback = useCallback(() => {
    ackAbortRef.current?.abort();
    ackAbortRef.current = null;
    try { ackAudioRef.current?.pause(); } catch { /* ignore */ }
    ackAudioRef.current = null;
    ackPlayingRef.current = false;
  }, []);

  const stopComposerPlayback = useCallback(() => {
    const s = streamRef.current;
    speakGenRef.current += 1;
    httpDrainGenRef.current += 1;
    s.abort?.abort();
    s.abort = null;
    s.queue = [];
    s.draining = false;
    s.queuedLen = 0;
    s.lastSpeech = '';
    s.runKey = '';
    s.speechComplete = false;
    s.composerAckGated = false;
    s.composerFinalized = false;
    s.composerEndRequested = false;
    spokenGuardRef.current = { key: '', text: '', at: 0 };
    pendingFinalSpeakRef.current = null;
    streamAudioReceivedRef.current = false;
    try { streamSessionRef.current?.cancel(); } catch { /* ignore */ }
    streamSessionRef.current = null;
    streamPushChainRef.current = Promise.resolve();
    // Kill orphan PCM contexts (locale switch / double session).
    stopAllPcmPlayers();
    try { htmlAudioRef.current?.pause(); } catch { /* ignore */ }
    htmlAudioRef.current = null;
    playingRef.current = false;
    setPlaying(false);
    setPaused(false);
    setActiveReplayId('');
    activeReplayIdRef.current = '';
    pendingFinalSpeakRef.current = null;
    clearKaraoke();
  }, [clearKaraoke]);

  const stopPlaybackPipeline = useCallback(() => {
    stopAckPlayback();
    stopComposerPlayback();
    muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
    syncMicMute();
  }, [syncMicMute, stopAckPlayback, stopComposerPlayback]);

  // Changing UI language must cut every TTS lane (FR orphan under ES karaoke).
  const localeBootRef = useRef(true);
  useEffect(() => {
    if (localeBootRef.current) {
      localeBootRef.current = false;
      return;
    }
    stopPlaybackPipeline();
  }, [locale, stopPlaybackPipeline]);

  /**
   * Karaoke on the HTTP lane: providers without word timings get estimated ones,
   * clocked on the <audio> element so highlighting follows the real playback.
   */
  const primeHttpKaraoke = useCallback(async (text, baseSec) => {
    if (!karaokeOnRef.current || !String(text || '').trim()) return 0;

    let audio = null;
    for (let i = 0; i < 40; i++) {
      audio = htmlAudioRef.current;
      if (audio && Number.isFinite(audio.duration) && audio.duration > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
      audio = null;
    }
    if (!audio) return 0;

    const duration = audio.duration;
    getPlaybackSecRef.current = () => {
      const el = htmlAudioRef.current;
      return baseSec + (el && Number.isFinite(el.currentTime) ? el.currentTime : duration);
    };
    karaokeGrainRef.current = 'word';
    setKaraokeGrain('word');
    appendKaraokeWords(estimateKaraokeWords(text, duration, baseSec));
    startKaraokeClock();
    return duration;
  }, [appendKaraokeWords, startKaraokeClock]);

  const drainPlaybackQueue = useCallback(async () => {
    const s = streamRef.current;
    if (s.draining) return;

    if (!s.composerAckGated) {
      const ackWait = ackPlaybackPromiseRef.current;
      if (ackWait) {
        try { await ackWait; } catch { /* ignore */ }
      }
      try { ackAudioRef.current?.pause(); } catch { /* ignore */ }
      ackAudioRef.current = null;
      ackPlayingRef.current = false;
      s.composerAckGated = true;
    }

    s.draining = true;
    const drainGen = httpDrainGenRef.current;

    while (s.queue.length && voiceAutoplayEnabled() && drainGen === httpDrainGenRef.current) {
      // Stream WS took over — never finish this HTTP item.
      if (ttsStreamRef.current === true || streamSessionRef.current) {
        s.queue = [];
        break;
      }
      const item = s.queue.shift();
      let payload = null;
      try {
        payload = await item.ready;
      } catch (err) {
        if (!isAbortError(err)) {
          pushToast(err instanceof Error ? err.message : tRef.current('voice.toast.ttsFailed'), { type: 'error' });
        }
        continue;
      }
      if (drainGen !== httpDrainGenRef.current) break;
      if (ttsStreamRef.current === true || streamSessionRef.current) break;
      if (!payload?.audioBase64 || !voiceAutoplayEnabled()) continue;

      if (!s.abort || s.abort.signal.aborted) {
        s.abort = new AbortController();
      }
      muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
      sttRef.current?.mute();
      sttRef.current?.clearVoiceBuffer?.();
      micMutedRef.current = true;
      playingRef.current = true;
      setPlaying(true);
      const karaokeBase = httpKaraokeBaseRef.current;
      let karaokeDuration = 0;
      const karaokeReady = primeHttpKaraoke(item.text, karaokeBase)
        .then((d) => { karaokeDuration = d; })
        .catch(() => { /* karaoke is best-effort */ });
      try {
        await playBase64Audio(payload.audioBase64, payload.contentType, {
          signal: s.abort.signal,
          audioRef: htmlAudioRef,
        });
      } catch (err) {
        if (isAbortError(err)) break;
        pushToast(err instanceof Error ? err.message : tRef.current('voice.toast.playbackFailed'), { type: 'error' });
      } finally {
        await karaokeReady;
        if (drainGen === httpDrainGenRef.current) {
          httpKaraokeBaseRef.current = karaokeBase + karaokeDuration;
        }
      }
    }

    if (drainGen === httpDrainGenRef.current) {
      s.draining = false;
      playingRef.current = false;
      setPlaying(false);
      if (presentationLiveTtsRef.current) presentationLiveTtsRef.current = false;
      muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
      syncMicMute();
    }
  }, [pushToast, syncMicMute, primeHttpKaraoke]);

  /** HTTP = fallback only when stream TTS is OFF. Never while Cartesia WS is preferred. */
  const enqueueSpeechChunksHttp = useCallback((chunks) => {
    if (!chunks.length || !voiceAutoplayEnabled()) return;
    if (ttsStreamRef.current !== false) return;
    if (streamSessionRef.current) return;
    const s = streamRef.current;
    muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
    sttRef.current?.mute();
    micMutedRef.current = true;

    // Merge short sentences so greetings are not chopped at every period.
    const merged = mergeTinySpeechChunks(chunks, 220);
    for (const text of merged) {
      const ready = voiceTts(text).then(({ ok, data }) => {
        if (!ok || !data?.audioBase64) {
          throw new Error(data?.error || 'Speech synthesis failed');
        }
        return { audioBase64: data.audioBase64, contentType: data.contentType };
      });
      s.queue.push({ text, ready });
    }
    void drainPlaybackQueue();
  }, [drainPlaybackQueue]);

  const killHttpComposerLane = useCallback(() => {
    const s = streamRef.current;
    httpDrainGenRef.current += 1;
    s.queue = [];
    s.draining = false;
    httpKaraokeBaseRef.current = 0;
    try { htmlAudioRef.current?.pause(); } catch { /* ignore */ }
    htmlAudioRef.current = null;
    try { s.abort?.abort(); } catch { /* ignore */ }
    s.abort = null;
  }, []);

  /**
   * ONE composer utterance via Cartesia/Deepgram WS.
   * Hard mutex: kills HTTP + any prior WS, then a single end(text). Never both lanes.
   */
  const speakComposerOnceViaWs = useCallback((text) => {
    const speech = String(text || '').trim();
    if (!speech || !voiceAutoplayEnabled()) return;
    if (ttsStreamRef.current !== true) return;

    const gen = ++speakGenRef.current;
    const s = streamRef.current;

    // Hard stop every other lane before opening WS (the double-voice root cause).
    httpDrainGenRef.current += 1;
    s.queue = [];
    s.draining = false;
    try { htmlAudioRef.current?.pause(); } catch { /* ignore */ }
    htmlAudioRef.current = null;
    try { streamSessionRef.current?.cancel(); } catch { /* ignore */ }
    streamSessionRef.current = null;
    stopAllPcmPlayers();
    try { s.abort?.abort(); } catch { /* ignore */ }
    s.abort = new AbortController();
    streamAudioReceivedRef.current = false;
    clearKaraoke();

    streamPushChainRef.current = Promise.resolve().then(async () => {
      if (gen !== speakGenRef.current || !voiceAutoplayEnabled()) return;

      // Wait for Groq ack lane if any
      if (!s.composerAckGated) {
        const ackWait = ackPlaybackPromiseRef.current;
        if (ackWait) {
          try { await ackWait; } catch { /* ignore */ }
        }
        try { ackAudioRef.current?.pause(); } catch { /* ignore */ }
        ackAudioRef.current = null;
        ackPlayingRef.current = false;
        s.composerAckGated = true;
      }
      if (gen !== speakGenRef.current) return;

      muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
      sttRef.current?.mute();
      micMutedRef.current = true;

      try {
        const session = createVoiceTtsStreamSession({
          lang: getActiveLocale(),
          signal: s.abort.signal,
          onTimestamps: (batch) => {
            if (gen !== speakGenRef.current) return;
            streamAudioReceivedRef.current = true;
            if (!karaokeOnRef.current) return;
            appendKaraokeTimestamps(batch);
            startKaraokeClock();
          },
          onPlaybackClock: (getSeconds, hasStarted) => {
            getPlaybackSecRef.current = getSeconds;
            if (hasStarted?.()) streamAudioReceivedRef.current = true;
          },
          onDuration: (sec) => {
            if (gen !== speakGenRef.current) return;
            maybeRescaleSentences(sec);
          },
          onError: (err) => {
            if (!isAbortError(err)) {
              pushToast(err.message || tRef.current('voice.toast.streamFailed'), { type: 'error' });
            }
          },
        });
        if (gen !== speakGenRef.current) {
          try { session.cancel(); } catch { /* ignore */ }
          return;
        }
        streamSessionRef.current = session;
        playingRef.current = true;
        setPlaying(true);
        setPaused(false);
        markPresentationTts();
        const ready = await session.ready;
        if (gen !== speakGenRef.current) {
          try { session.cancel(); } catch { /* ignore */ }
          return;
        }
        armKaraokeForWsReady(ready, speech);

        // Single end() when possible — never open a second session for the same reply.
        if (speech.length <= VOICE_TTS_CHUNK_MAX) {
          await session.end(speech);
        } else {
          const parts = takeSpeakableChunks(speech, { final: true }).chunks;
          if (!parts.length) {
            await session.end(speech.slice(0, VOICE_TTS_CHUNK_MAX));
          } else if (parts.length === 1) {
            await session.end(parts[0]);
          } else {
            for (let i = 0; i < parts.length - 1; i++) {
              if (gen !== speakGenRef.current) {
                try { session.cancel(); } catch { /* ignore */ }
                return;
              }
              session.push(parts[i]);
            }
            await session.end(parts[parts.length - 1]);
          }
        }

        if (gen !== speakGenRef.current) return;
        if (streamSessionRef.current === session) streamSessionRef.current = null;
        playingRef.current = false;
        setPlaying(false);
        setPaused(false);
        const last = karaokeWordsRef.current.at(-1);
        const remainMs = last
          ? Math.max(400, Math.round((last.end - getPlaybackSecRef.current()) * 1000) + 350)
          : 600;
        setTimeout(() => {
          if (gen === speakGenRef.current && !streamSessionRef.current) clearKaraoke();
        }, remainMs);
        muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
        syncMicMute();
        if (presentationLiveTtsRef.current) presentationLiveTtsRef.current = false;
      } catch (err) {
        if (gen !== speakGenRef.current) return;
        try { streamSessionRef.current?.cancel(); } catch { /* ignore */ }
        streamSessionRef.current = null;
        playingRef.current = false;
        setPlaying(false);
        clearKaraoke();
        if (!isAbortError(err)) {
          pushToast(err instanceof Error ? err.message : tRef.current('voice.toast.streamFailed'), { type: 'error' });
        }
        syncMicMute();
      }
    }).catch(() => { /* chain must not break */ });
  }, [
    pushToast,
    syncMicMute,
    clearKaraoke,
    appendKaraokeTimestamps,
    startKaraokeClock,
    armKaraokeForWsReady,
    maybeRescaleSentences,
    voiceAutoplayEnabled,
    markPresentationTts,
  ]);

  const enqueueSpeechChunksStream = useCallback((chunks, { final = false } = {}) => {
    // Stream lane: only one-shot speak at final. Incremental push disabled (double audio).
    if (!final || !voiceAutoplayEnabled()) return;
    const joined = mergeTinySpeechChunks(chunks, 220).join(' ').trim();
    if (!joined) return;
    speakComposerOnceViaWs(joined);
  }, [voiceAutoplayEnabled, speakComposerOnceViaWs]);

  const enqueueSpeechChunks = useCallback((chunks, opts = {}) => {
    // Prefer Cartesia/Deepgram WS. HTTP only when stream is known unavailable.
    // Never start both — that is the "normal + karaoke" double voice.
    if (ttsStreamRef.current === true) {
      enqueueSpeechChunksStream(chunks, opts);
      return;
    }
    if (ttsStreamRef.current === false) {
      // Extra safety: abort any orphan WS before HTTP composer speak.
      try { streamSessionRef.current?.cancel(); } catch { /* ignore */ }
      streamSessionRef.current = null;
      stopAllPcmPlayers();
      enqueueSpeechChunksHttp(chunks);
    }
    // ttsStream still null (status loading) — feedStreamSpeech buffers until ready.
  }, [enqueueSpeechChunksHttp, enqueueSpeechChunksStream]);

  const flushSpeechTail = useCallback((final = false) => {
    const s = streamRef.current;
    if (final && (s.composerFinalized || s.composerEndRequested)) {
      if (s.composerFinalized) return;
      // Stream lane: response_complete already queued speak — never spawn a second WS session.
      if (ttsStreamRef.current === true) return;
    }

    if (!s.lastSpeech || s.queuedLen >= s.lastSpeech.length) {
      return;
    }
    const pending = s.lastSpeech.slice(s.queuedLen);
    const { chunks, consumed } = takeSpeakableChunks(pending, { final: true });
    if (consumed > 0) s.queuedLen += consumed;
    if (final) s.composerEndRequested = true;
    enqueueSpeechChunks(chunks, { final });
  }, [enqueueSpeechChunks, enqueueSpeechChunksStream]);

  const feedStreamSpeech = useCallback((rawText, {
    final = false,
    runKey = '',
    lifecycleOnly = false,
  } = {}) => {
    if (!voiceAutoplayEnabled()) return;
    const s = streamRef.current;

    // run_complete is only a safety net — never speak from it.
    // Speaking here + again on response_complete = double voice (superimposed).
    if (lifecycleOnly) {
      if (s.composerFinalized) return;
      if (ttsStreamRef.current !== false) {
        // Stream lane (or status pending): only response_complete may push/end.
        return;
      }
      // HTTP lane: if response_complete already queued speech, just drain/finish.
      if (s.speechComplete || s.composerEndRequested) flushSpeechTail(true);
      return;
    }

    // Reply already fully spoken — ignore duplicate response_complete / late deltas
    // (HTTP path must also set composerFinalized, or late `response` events re-speak.)
    if (s.composerFinalized) return;
    if (s.composerEndRequested && !final) return;
    if (final && s.composerEndRequested) return;

    if (runKey && s.runKey && runKey !== s.runKey) {
      stopComposerPlayback();
    }
    if (runKey) s.runKey = runKey;

    const rawForSpeech = stripComposerAckRef.current
      ? stripLeadingVoiceAckForTts(rawText, spokenAckRef.current)
      : rawText;
    const speechRaw = speechTextFromAssistant(rawForSpeech, { streaming: !final, locale: getActiveLocale() });
    const speech = undoubleSpeechText(speechRaw, s.lastSpeech);

    if (!speech) {
      if (final) {
        s.speechComplete = true;
        s.composerEndRequested = true;
        flushSpeechTail(true);
        if (ttsStreamRef.current !== true) s.composerFinalized = true;
        stripComposerAckRef.current = false;
        spokenAckRef.current = '';
        if (presentationLiveTtsRef.current) presentationLiveTtsRef.current = false;
      }
      return;
    }

    const isPresentationLane = presentationLiveTtsRef.current || getPresentationActiveRef.current();

    // WS TTS (Cartesia karaoke): buffer until response_complete — never push on deltas.
    // Also buffer while status is unknown (null) so HTTP fallback cannot start first.
    if (ttsStreamRef.current !== false && !final) {
      if (runKey && s.runKey && runKey !== s.runKey) {
        stopComposerPlayback();
        if (voiceAutoplayEnabled()) presentationLiveTtsRef.current = true;
        primeTtsSpokeRef.current = false;
        primeLiveTtsRef.current = false;
      }
      if (runKey) s.runKey = runKey;
      s.lastSpeech = speech;
      return;
    }

    if (ttsStreamRef.current === true && final) {
      s.queuedLen = 0;
      if (isPresentationLane) markPresentationTts();
    }

    // Status not loaded yet — remember final text; flush when status arrives.
    if (ttsStreamRef.current === null) {
      s.lastSpeech = speech;
      if (final) {
        pendingFinalSpeakRef.current = { text: speech, runKey: runKey || s.runKey };
      }
      return;
    }

    if (s.queuedLen > speech.length) {
      s.queuedLen = speech.length;
    }
    const already = s.lastSpeech.slice(0, s.queuedLen);
    if (s.queuedLen > 0 && !speech.startsWith(already)) {
      let common = 0;
      const prev = s.lastSpeech;
      const n = Math.min(prev.length, speech.length, s.queuedLen);
      while (common < n && prev[common] === speech[common]) common += 1;
      s.queuedLen = common;
    }

    const pending = speech.slice(s.queuedLen);
    // On final: take remaining once, then close the Composer lane in the same enqueue.
    const { chunks, consumed } = takeSpeakableChunks(pending, {
      final,
      firstChunk: s.queuedLen === 0,
    });
    if (consumed > 0) s.queuedLen += consumed;
    s.lastSpeech = speech;

    if (final) {
      const guard = spokenGuardRef.current;
      const now = Date.now();
      if (guard.text === speech && now - guard.at < 30000) {
        s.composerFinalized = true;
        s.composerEndRequested = true;
        return;
      }
      spokenGuardRef.current = { key: runKey, text: speech, at: now };

      s.speechComplete = true;
      s.composerEndRequested = true;
      s.composerFinalized = true;
      pendingFinalSpeakRef.current = null;
      // Stream (Cartesia): one WS end() only. HTTP: chunk queue when stream unavailable.
      if (ttsStreamRef.current === true) {
        speakComposerOnceViaWs(speech);
      } else {
        enqueueSpeechChunks(chunks, { final: true });
      }
      stripComposerAckRef.current = false;
      spokenAckRef.current = '';
      s.runKey = '';
      return;
    }

    enqueueSpeechChunks(chunks, { final: false });
  }, [enqueueSpeechChunks, flushSpeechTail, stopComposerPlayback, voiceAutoplayEnabled, markPresentationTts, speakComposerOnceViaWs]);

  const prepareForPresentation = useCallback(() => {
    presentationLiveTtsRef.current = voiceAutoplayEnabled();
    primeTtsSpokeRef.current = false;
    primeLiveTtsRef.current = false;
    stopComposerPlayback();
  }, [stopComposerPlayback, voiceAutoplayEnabled]);

  const playVoiceAckPhrase = useCallback(async (payload) => {
    const text = String(payload?.text || payload || '').trim();
    const audioBase64 = payload?.audioBase64;
    if (!text && !audioBase64) return;
    if (!playbackOnRef.current) return;

    // Ack lane only — never touch Composer stream / htmlAudioRef.
    stopAckPlayback();
    muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
    sttRef.current?.mute();
    micMutedRef.current = true;

    const abort = new AbortController();
    ackAbortRef.current = abort;
    ackPlayingRef.current = true;
    // UI "playing" for ack alone (Composer uses the same flag later, after ack ends).
    if (!streamSessionRef.current) {
      setPlaying(true);
      setPaused(false);
    }

    try {
      let base64 = audioBase64;
      let contentType = payload?.contentType || 'audio/mpeg';
      if (!base64) {
        const { ok, data } = await voiceTts(text);
        if (!ok || !data?.audioBase64) return;
        base64 = data.audioBase64;
        contentType = data.contentType || contentType;
      }
      await playBase64Audio(base64, contentType, {
        signal: abort.signal,
        audioRef: ackAudioRef,
      });
    } catch (err) {
      if (!isAbortError(err)) {
        console.warn('[voice] ack TTS', err?.message || err);
      }
    } finally {
      if (ackAbortRef.current === abort) ackAbortRef.current = null;
      ackPlayingRef.current = false;
      try { ackAudioRef.current?.pause(); } catch { /* ignore */ }
      ackAudioRef.current = null;
      if (!playingRef.current && !streamSessionRef.current) {
        setPlaying(false);
      }
      muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
      syncMicMute();
    }
  }, [syncMicMute, stopAckPlayback]);

  const runVoiceTurn = useCallback((message) => {
    let trimmed = String(message || '').trim();
    if (!trimmed || busyRef.current) return false;

    if (cursorPureRef.current) {
      busyRef.current = true;
      setBusy(true);
      setDraftRef.current('');
      void (async () => {
        try {
          const began = onBeginVoiceSendRef.current
            ? Boolean(onBeginVoiceSendRef.current(trimmed))
            : false;
          if (!began) throw new Error('Envoi indisponible');
          if (onFinishVoiceSendRef.current) {
            await onFinishVoiceSendRef.current(trimmed, {});
          } else {
            await onSendRef.current(trimmed, []);
          }
        } catch (err) {
          pushToast(err instanceof Error ? err.message : tRef.current('voice.toast.sendFailed'), { type: 'error' });
          setDraftRef.current(trimmed);
        } finally {
          busyRef.current = false;
          setBusy(false);
        }
      })();
      return true;
    }

    busyRef.current = true;
    setBusy(true);
    ignoreDraftUntilRef.current = Date.now() + 3000;
    setDraftRef.current('');
    sttRef.current?.setBaseDraft('');
    sttRef.current?.clearVoiceBuffer?.();
    setVoicePreview('');
    sttRef.current?.mute();
    micMutedRef.current = true;
    // Reopen capture right away in stop-only mode: an emergency « stop » has to
    // be heard while the agent runs, which is exactly when we just muted.
    syncMicMute();
    stopPlaybackPipeline();
    streamRef.current.composerAckGated = false;
    streamRef.current.composerFinalized = false;
    streamRef.current.composerEndRequested = false;
    streamRef.current.speechComplete = false;
    streamRef.current.queuedLen = 0;
    streamRef.current.lastSpeech = '';
    streamRef.current.runKey = '';
    stripComposerAckRef.current = true;
    spokenAckRef.current = '';

    let resolveAckLane = () => {};
    const ackLane = new Promise((resolve) => {
      resolveAckLane = resolve;
    });
    ackPlaybackPromiseRef.current = ackLane;

    const showAckBubble = (ackText) => {
      const t = String(ackText || '').trim();
      if (!t) return;
      onVoiceAckRef.current?.(t);
    };

    // Strict order: human → Groq ack (bubble + audio) → Composer inject.
    // Composer must not start until the ack lane finishes, even if it would be ready sooner.
    void (async () => {
      let began = false;
      let finished = false;
      try {
        // Normalizes infra names phonetically captured by STT ("cas zéro" → gbs-k0)
        // before display, acknowledgment, and CLI injection.
        let resolvedEntities = [];
        try {
          const norm = await voiceNormalize(trimmed, getActiveLocale());
          if (norm.ok && norm.data?.text) {
            trimmed = String(norm.data.text).trim() || trimmed;
            resolvedEntities = (norm.data.replacements || []).map((r) => r.to);
          }
        } catch { /* normalisation best effort */ }

        began = onBeginVoiceSendRef.current
          ? Boolean(onBeginVoiceSendRef.current(trimmed))
          : false;

        if (!began) {
          throw new Error('Voice turn unavailable: Composer waiting for Groq acknowledgment');
        }

        showAckBubble('…');

        const lang = getActiveLocale();
        const { ok, data } = await voiceAck(trimmed, lang, resolvedEntities);
        let spokenAck = ok ? String(data?.text || '').trim() : '';
        let ackAudio = null;

        if (spokenAck) {
          showAckBubble(spokenAck);
        } else {
          const speak = await voiceAckSpeak(trimmed, lang);
          const fallback = speak.ok ? String(speak.data?.text || '').trim() : '';
          if (fallback) {
            spokenAck = fallback;
            ackAudio = speak.data;
            showAckBubble(fallback);
          }
        }

        if (!spokenAck) {
          throw new Error('Groq acknowledgment unavailable');
        }
        spokenAckRef.current = spokenAck;

        // Composer works in parallel with the spoken ack, but its stream stays
        // hidden and its TTS stays queued until this acknowledgment ends.
        onVoiceResponseGateRef.current?.(false);
        let ackPlayback = Promise.resolve();
        if (playbackOnRef.current) {
          if (ackAudio?.audioBase64) {
            ackPlayback = playVoiceAckPhrase(ackAudio);
          } else {
            ackPlayback = voiceTts(spokenAck).then(({ ok: ttsOk, data: ttsData }) => {
              if (!ttsOk || !ttsData?.audioBase64) return undefined;
              return playVoiceAckPhrase({
                text: spokenAck,
                audioBase64: ttsData.audioBase64,
                contentType: ttsData.contentType,
              });
            });
          }
          ackPlayback = ackPlayback.catch((err) => {
            console.warn('[voice] ack TTS', err?.message || err);
          });
        }

        if (onFinishVoiceSendRef.current) {
          await onFinishVoiceSendRef.current(trimmed, { ackText: spokenAck });
          finished = true;
        } else {
          await onSendRef.current(trimmed, []);
        }

        await ackPlayback;
        onVoiceResponseGateRef.current?.(true);
        resolveAckLane();
        if (ackPlaybackPromiseRef.current === ackLane) {
          ackPlaybackPromiseRef.current = null;
        }
      } catch (err) {
        pushToast(err instanceof Error ? err.message : tRef.current('voice.toast.sendFailed'), { type: 'error' });
        setDraftRef.current(trimmed);
        sttRef.current?.setBaseDraft(trimmed);
        onVoiceResponseGateRef.current?.(true);
        resolveAckLane();
        if (ackPlaybackPromiseRef.current === ackLane) {
          ackPlaybackPromiseRef.current = null;
        }
      } finally {
        if (began && !finished) {
          onAbortVoiceSendRef.current?.();
        }
        busyRef.current = false;
        setBusy(false);
        syncMicMute();
      }
    })();
    return true;
  }, [pushToast, syncMicMute, stopPlaybackPipeline, playVoiceAckPhrase]);

  const goDebounceRef = useRef(0);
  const clearDebounceRef = useRef(0);
  const typingDraftRef = useRef(false);

  const acceptClear = useCallback(() => {
    playClearConfirmBeep();
    ignoreDraftUntilRef.current = Date.now() + 1500;
    if (goDebounceRef.current) {
      window.clearTimeout(goDebounceRef.current);
      goDebounceRef.current = 0;
    }
    if (clearDebounceRef.current) {
      window.clearTimeout(clearDebounceRef.current);
      clearDebounceRef.current = 0;
    }
    setDraftRef.current('');
    sttRef.current?.setBaseDraft('');
    sttRef.current?.clearVoiceBuffer?.();
    setVoicePreview('');
  }, []);

  const acceptGoAndSend = useCallback((message) => {
    const trimmed = String(message || '').trim();
    // « go » was heard, so never fail silently — the user has no other feedback.
    if (!trimmed) {
      pushToast(tRef.current('toast.goEmptyMessage'), { type: 'error', duration: 2500 });
      return false;
    }
    if (busyRef.current) {
      debugLog('voice', 'go refused — busy');
      pushToast(tRef.current('toast.goBusy'), { type: 'error', duration: 2500 });
      return false;
    }
    debugLog('voice', 'go accepted', { len: trimmed.length });
    playGoConfirmBeep();
    ignoreDraftUntilRef.current = Date.now() + 4000;
    if (goDebounceRef.current) {
      window.clearTimeout(goDebounceRef.current);
      goDebounceRef.current = 0;
    }
    setDraftRef.current('');
    sttRef.current?.setBaseDraft('');
    sttRef.current?.clearVoiceBuffer?.();
    setVoicePreview('');
    return runVoiceTurn(trimmed);
  }, [runVoiceTurn]);

  /**
   * « stop » outranks every other gate: it is the only command that must fire
   * while the agent is busy, which is exactly when the other guards bail out.
   */
  const acceptStop = useCallback(async () => {
    if (Date.now() < stopCooldownRef.current) return true;
    stopCooldownRef.current = Date.now() + 2500;
    debugLog('voice', 'stop keyword accepted');
    playStopConfirmBeep();
    stopPlaybackPipeline();
    setVoicePreview('');
    sttRef.current?.setBaseDraft('');
    sttRef.current?.clearVoiceBuffer?.();
    setDraftRef.current('');
    onVoiceStopRef.current?.();
    const stoppedToast = tRef.current('toast.streamStopped') || 'Interrompu';
    pushToast(stoppedToast, { type: 'info', duration: 2500 });

    if (playbackOnRef.current || interactionModeRef.current === 'route') {
      const stopSpeech = locale === 'en'
        ? 'Stopped.'
        : locale === 'es'
          ? 'Interrumpido.'
          : 'Interrompu.';
      try {
        const { ok, data } = await voiceAckSpeak(stopSpeech, locale);
        if (ok && data?.audio) {
          void playBase64Audio(data.audio, data.mime || 'audio/mp3').catch(() => {});
        }
      } catch { /* ignore fallback */ }
    }
    return true;
  }, [locale, pushToast, stopPlaybackPipeline]);

  const rebornCooldownRef = useRef(0);
  const acceptReborn = useCallback(() => {
    if (Date.now() < rebornCooldownRef.current) return true;
    rebornCooldownRef.current = Date.now() + 4000;
    debugLog('voice', 'reborn keyword accepted');
    playClearConfirmBeep();
    stopPlaybackPipeline();
    setVoicePreview('');
    sttRef.current?.setBaseDraft('');
    sttRef.current?.clearVoiceBuffer?.();
    setDraftRef.current('');
    pushToast(tRef.current('options.clear') || 'Reborn...', { type: 'info', duration: 3000 });
    onVoiceRebornRef.current?.();
    return true;
  }, [pushToast, stopPlaybackPipeline]);

  const trySendOnKeyword = useCallback((text) => {
    const { triggered, message } = splitVoiceSendCommand(text);
    if (!triggered) return;
    const toSend = String(message || getDraftRef.current() || '').trim();
    if (!toSend) return;
    acceptGoAndSend(toSend);
  }, [acceptGoAndSend]);

  const submitVoiceMessage = useCallback((text) => runVoiceTurn(text), [runVoiceTurn]);

  /** Strip « go » from the live draft; debounce-send so a lone « go » still fires like Send. */
  const handleVoiceDraft = useCallback((text) => {
    if (typingDraftRef.current) return;
    // Before every guard: the agent being busy is precisely when stop is needed.
    if (hasVoiceStopKeyword(text)) {
      acceptStop();
      return;
    }
    if (hasVoiceRebornKeyword(text) || splitVoiceRebornCommand(text).triggered) {
      acceptReborn();
      return;
    }
    if (stopOnlyRef.current) return;
    if (!micLiveRef.current && shouldBlockVoiceInput()) return;
    if (Date.now() < ignoreDraftUntilRef.current) return;
    if (busyRef.current) return;
    // Empty interim frames must not wipe the draft or cancel a pending go/clear.
    if (!String(text || '').trim()) return;

    if (goDebounceRef.current) {
      window.clearTimeout(goDebounceRef.current);
      goDebounceRef.current = 0;
    }
    if (clearDebounceRef.current) {
      window.clearTimeout(clearDebounceRef.current);
      clearDebounceRef.current = 0;
    }

    const cleared = splitVoiceClearCommand(text);
    if (cleared.triggered) {
      acceptClear();
      return;
    }

    const { triggered, message, keywordOnly } = splitVoiceSendCommand(text);

    if (!triggered) {
      setDraftRef.current(text);
      return;
    }

    const toSend = String(message || getDraftRef.current() || '').trim();
    acceptGoAndSend(toSend);
  }, [shouldBlockVoiceInput, acceptGoAndSend, acceptClear, acceptStop, acceptReborn]);

  /** Final STT: send immediately (same as the Send button). */
  const handleVoiceCommitted = useCallback((text) => {
    if (typingDraftRef.current) return;
    if (hasVoiceStopKeyword(text)) {
      acceptStop();
      return;
    }
    if (hasVoiceRebornKeyword(text) || splitVoiceRebornCommand(text).triggered) {
      acceptReborn();
      return;
    }
    if (stopOnlyRef.current) return;
    if (!micLiveRef.current && shouldBlockVoiceInput()) return;
    if (Date.now() < ignoreDraftUntilRef.current) return;
    if (busyRef.current) return;
    if (splitVoiceClearCommand(text).triggered) {
      acceptClear();
      return;
    }
    const { triggered, message, keywordOnly } = splitVoiceSendCommand(text);
    if (!triggered) {
      setDraftRef.current(text);
      return;
    }
    const toSend = String(message || getDraftRef.current() || '').trim();
    if (keywordOnly && !toSend) return;
    if (!toSend) {
      setDraftRef.current(message);
      return;
    }
    acceptGoAndSend(toSend);
  }, [shouldBlockVoiceInput, acceptGoAndSend, acceptClear, acceptStop, acceptReborn]);

  useEffect(() => {
    if (!cursorPure) return;
    setGroqAck(false);
  }, [cursorPure]);

  useEffect(() => {
    (async () => {
      const { ok, data } = await getVoiceStatus();
      setConfigured(Boolean(ok && (data?.configured || data?.ttsProvider)));
      const streamOn = Boolean(ok && data?.ttsStream);
      setTtsStream(streamOn);
      ttsStreamRef.current = streamOn;
      setTtsProviderName(ok ? (data?.ttsProvider || null) : null);
      setGroqAck(Boolean(ok && data?.groqAck && !cursorPureRef.current));
    })();
  }, []);

  // Flush speech held while waiting for /voice/status (Cartesia vs HTTP).
  useEffect(() => {
    if (ttsStream === null) return;
    const pending = pendingFinalSpeakRef.current;
    if (!pending?.text || !playbackOnRef.current) return;
    const s = streamRef.current;
    if (s.composerFinalized || s.composerEndRequested) {
      pendingFinalSpeakRef.current = null;
      return;
    }
    pendingFinalSpeakRef.current = null;
    feedStreamSpeech(pending.text, { final: true, runKey: pending.runKey });
  }, [ttsStream, feedStreamSpeech]);

  const armTimerRef = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));
  const armTickRef = useRef(/** @type {ReturnType<typeof setInterval>|null} */ (null));
  const chimeTimerRef = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));

  const clearArmTimers = useCallback(() => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    if (chimeTimerRef.current) {
      clearTimeout(chimeTimerRef.current);
      chimeTimerRef.current = null;
    }
    if (armTickRef.current) {
      clearInterval(armTickRef.current);
      armTickRef.current = null;
    }
    setMicArmLeftMs(0);
  }, []);

  const stopMic = useCallback((opts = {}) => {
    const persist = opts.persist !== false;
    const beep = opts.beep !== false;
    const wasLive = micLiveRef.current;
    clearArmTimers();
    // Beep before tearing down capture — Android routes audio differently once tracks stop.
    if (beep && wasLive) {
      void unlockAudioPlayback().then(() => playMicOffBeep());
    }
    setMicPhase('off');
    setMicLive(false);
    micLiveRef.current = false;
    micMutedRef.current = false;
    muteUntilRef.current = 0;
    setVoicePreview('');
    sttRef.current?.stop();
    sttRef.current = null;
    if (persist) saveMicWanted(false);
  }, [clearArmTimers]);

  const startMic = useCallback(async () => {
    void unlockAudioPlayback();
    primeMicReadyChime();
    if (getAgentBusyRef.current()) {
      pushToast(tRef.current('voice.toast.agentBusy'), { type: 'info' });
      return;
    }

    // After refresh, status may not be loaded yet — re-check before connecting.
    let voiceOk = configured;
    if (!voiceOk) {
      try {
        const { ok, data } = await getVoiceStatus();
        voiceOk = Boolean(ok && (data?.configured || data?.ttsProvider));
        setConfigured(voiceOk);
        const streamOn = Boolean(ok && data?.ttsStream);
        setTtsStream(streamOn);
        ttsStreamRef.current = streamOn;
        setTtsProviderName(ok ? (data?.ttsProvider || null) : null);
        setGroqAck(Boolean(ok && data?.groqAck && !cursorPureRef.current));
      } catch {
        voiceOk = false;
      }
    }
    if (!voiceOk) {
      pushToast(tRef.current('voice.toast.notConfigured'), { type: 'error' });
      return;
    }

    saveMicWanted(true);

    try {
      setBusy(true);
      clearArmTimers();
      setMicPhase('connecting');
      setMicLive(true);
      micLiveRef.current = true;
      micMutedRef.current = true;
      await unlockAudioPlayback();
      muteUntilRef.current = 0;

      sttRef.current?.stop();
      sttRef.current = null;

      const session = createRealtimeSttSession({
        lang: getActiveLocale(),
        // Share the unlocked context: capture on a second one leaves the chime
        // context suspended by Android once the mic is live.
        audioContext: getSharedAudioContext(),
        onDraft: handleVoiceDraft,
        onCommitted: handleVoiceCommitted,
        onLivePreview: (preview) => {
          if (Date.now() < ignoreDraftUntilRef.current) return;
          if (busyRef.current) return;
          setVoicePreview(preview);
        },
        // Deepgram is up but the mic is still closed: the only window where our
        // own chime is audible on Android. The mic opens as soon as it ends, so
        // the beep still marks the moment the user may speak.
        onBeforeMic: async () => {
          if (!micLiveRef.current) return;
          clearArmTimers();
          setMicPhase('arming');
          chimeAtRef.current = Date.now();
          pushToast(tRef.current('voice.toast.micReady'), { type: 'success', duration: 1800, sound: 'mic' });
          debugLog('voice', 'ready chime — mic still closed');
          await new Promise((resolve) => {
            chimeTimerRef.current = setTimeout(() => {
              chimeTimerRef.current = null;
              resolve();
            }, MIC_CHIME_MS);
          });
        },
        onReady: () => {
          if (!micLiveRef.current || sttRef.current !== session) return;
          clearArmTimers();
          session.armListening();
          micMutedRef.current = false;
          setMicPhase('listening');
          syncMicMute();
          debugLog('voice', 'mic open — listening', {
            afterChimeMs: chimeAtRef.current ? Date.now() - chimeAtRef.current : null,
          });
        },
        onError: (e) => {
          pushToast(
            e?.message || tRef.current('voice.toast.micDenied'),
            { type: 'error' },
          );
          stopMic({ beep: false });
        },
      });

      session.setBaseDraft(getDraftRef.current());
      sttRef.current = session;
      session.mute();
      syncMicMute();
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : tRef.current('voice.toast.micDenied'),
        { type: 'error' },
      );
      stopMic({ beep: false });
    } finally {
      setBusy(false);
    }
  }, [
    configured,
    pushToast,
    handleVoiceDraft,
    handleVoiceCommitted,
    syncMicMute,
    clearArmTimers,
    stopMic,
  ]);

  const toggleMic = useCallback(() => {
    void unlockAudioPlayback();
    if (micLive) {
      stopMic({ persist: true, beep: true });
      return;
    }
    primeMicReadyChime();
    void startMic();
  }, [micLive, startMic, stopMic]);

  const micRestoreTriedRef = useRef(false);
  useEffect(() => {
    if (micRestoreTriedRef.current) return;
    if (!loadMicWanted()) {
      micRestoreTriedRef.current = true;
      return;
    }
    micRestoreTriedRef.current = true;
    void startMic();
  }, [startMic]);

  const togglePlayback = useCallback(() => {
    void unlockAudioPlayback();
    setPlaybackOn((prev) => {
      const next = !prev;
      saveVoicePlaybackEnabled(next);
      if (!next) {
        stopPlaybackPipeline();
        playSpeakerOffBeep();
      } else {
        playSpeakerOnBeep();
      }
      return next;
    });
  }, [stopPlaybackPipeline]);

  const toggleKaraoke = useCallback(() => {
    setKaraokeOn((prev) => {
      const next = !prev;
      saveKaraokeEnabled(next);
      if (!next) clearKaraoke();
      return next;
    });
  }, [clearKaraoke]);

  const pausePlayback = useCallback(async () => {
    // Pause EVERY lane — Cartesia karaoke + orphan PCM + HTTP ack/composer.
    // Early-return on stream only left a French HTML/PCM voice speaking Spanish.
    await pauseAllPcmPlayers();
    const session = streamSessionRef.current;
    if (session?.pause) {
      try { await session.pause(); } catch { /* ignore */ }
    }
    const html = htmlAudioRef.current;
    if (html && !html.paused) {
      try { html.pause(); } catch { /* ignore */ }
    }
    const ack = ackAudioRef.current;
    if (ack && !ack.paused) {
      try { ack.pause(); } catch { /* ignore */ }
    }
    setPaused(true);
  }, []);

  const resumePlayback = useCallback(async () => {
    await resumeAllPcmPlayers();
    const session = streamSessionRef.current;
    if (session?.resume) {
      try { await session.resume(); } catch { /* ignore */ }
    }
    const html = htmlAudioRef.current;
    if (html && html.paused) {
      try { await html.play(); } catch (err) {
        pushToast(err instanceof Error ? err.message : tRef.current('voice.toast.resumeFailed'), { type: 'error' });
      }
    }
    const ack = ackAudioRef.current;
    if (ack && ack.paused) {
      try { await ack.play(); } catch { /* ignore */ }
    }
    setPaused(false);
  }, [pushToast]);

  const togglePause = useCallback(() => {
    if (paused) void resumePlayback();
    else void pausePlayback();
  }, [paused, pausePlayback, resumePlayback]);

  const stopPlayback = useCallback(() => {
    stopPlaybackPipeline();
  }, [stopPlaybackPipeline]);

  /**
   * Replay assistant text — Cartesia WS (+ karaoke) when ttsStream, else HTTP TTS (Deepgram / ElevenLabs).
   * @param {string} text
   * @param {{ id?: string }} [opts]
   */
  const replaySpeech = useCallback(async (text, opts = {}) => {
    const raw = undoubleSpeechText(String(text || '').trim());
    if (!raw) return;

    const id = String(opts.id || '');
    // Manual play while live autoplay is already speaking → pause (don't restart = "plays twice")
    if (id && playingRef.current && !activeReplayIdRef.current) {
      togglePause();
      return;
    }
    // Same block replay → pause/resume
    if (id && activeReplayIdRef.current === id && playingRef.current) {
      togglePause();
      return;
    }

    const gen = ++replayGenRef.current;
    stopPlaybackPipeline();

    const speech = speechTextFromAssistant(raw, { streaming: false, locale: getActiveLocale() });
    if (!speech) return;

    // One TTS payload when possible — sentence-splitting a short reply can sound like a double read.
    const chunks = speech.length <= VOICE_TTS_CHUNK_MAX
      ? [speech]
      : takeSpeakableChunks(speech, { final: true }).chunks;
    if (!chunks.length) return;

    const s = streamRef.current;
    s.abort = new AbortController();
    s.speechComplete = true;
    s.composerFinalized = true;
    s.composerEndRequested = true;
    clearKaraoke();
    setActiveReplayId(id);
    activeReplayIdRef.current = id;
          setPaused(false);

    // Deepgram / ElevenLabs / HTTP fallback: no Cartesia WS
    if (ttsStreamRef.current !== true) {
      muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
      sttRef.current?.mute();
      micMutedRef.current = true;
      playingRef.current = true;
      setPlaying(true);
      try {
        for (const chunk of chunks) {
          if (replayGenRef.current !== gen || s.abort.signal.aborted) break;
          let played = false;
          try {
            const { ok, data } = await voiceTts(chunk);
            if (ok && data?.audioBase64) {
              if (replayGenRef.current !== gen || s.abort.signal.aborted) break;
              const karaokeBase = httpKaraokeBaseRef.current;
              let karaokeDuration = 0;
              const karaokeReady = primeHttpKaraoke(chunk, karaokeBase)
                .then((d) => { karaokeDuration = d; })
                .catch(() => { /* karaoke is best-effort */ });
              try {
                await playBase64Audio(data.audioBase64, data.contentType || 'audio/mpeg', {
                  signal: s.abort.signal,
                  audioRef: htmlAudioRef,
                });
                played = true;
              } finally {
                await karaokeReady;
                httpKaraokeBaseRef.current = karaokeBase + karaokeDuration;
              }
            }
          } catch (cloudErr) {
            console.warn('[TTS] Cloud synthesis failed, falling back to browser synthesis:', cloudErr.message);
            pushToast?.(`Synthèse vocale cloud : ${cloudErr.message || 'Erreur'}, repli sur la voix locale`, { type: 'error', duration: 4000 });
          }

          if (!played && !s.abort.signal.aborted && replayGenRef.current === gen) {
            await speakViaBrowserSpeechSynthesis(chunk, {
              lang: getActiveLocale(),
              signal: s.abort.signal,
            });
          }
        }
      } catch (err) {
        if (!isAbortError(err)) {
          // Fallback to browser speech synthesis
          await speakViaBrowserSpeechSynthesis(speech, {
            lang: getActiveLocale(),
            signal: s.abort.signal,
          });
        }
      } finally {
        if (replayGenRef.current === gen) {
          playingRef.current = false;
          setPlaying(false);
          setPaused(false);
          if (activeReplayIdRef.current === id) {
            setActiveReplayId('');
            activeReplayIdRef.current = '';
          }
          muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
          syncMicMute();
        }
      }
      return;
    }

    try {
      const session = createVoiceTtsStreamSession({
        lang: getActiveLocale(),
        signal: s.abort.signal,
        onTimestamps: (batch) => {
          if (!karaokeOnRef.current) return;
          appendKaraokeTimestamps(batch);
          startKaraokeClock();
        },
        onPlaybackClock: (getSeconds) => {
          getPlaybackSecRef.current = getSeconds;
        },
        onDuration: (sec) => {
          if (replayGenRef.current !== gen) return;
          maybeRescaleSentences(sec);
        },
        onError: (err) => {
          console.warn('[TTS WS] Stream error:', err.message);
        },
      });
      streamSessionRef.current = session;
      playingRef.current = true;
      setPlaying(true);
      const ready = await session.ready;
      if (replayGenRef.current !== gen || s.abort.signal.aborted) {
        try { session.cancel(); } catch { /* ignore */ }
        return;
      }
      armKaraokeForWsReady(ready, speech);
      // One end() when possible — push+end split caused double read with karaoke.
      const merged = chunks.length === 1 ? chunks[0] : chunks.join(' ').trim();
      if (merged && merged.length <= VOICE_TTS_CHUNK_MAX) {
        await session.end(merged);
      } else if (chunks.length > 1) {
        for (let i = 0; i < chunks.length - 1; i++) session.push(chunks[i]);
        await session.end(chunks[chunks.length - 1] || '');
      } else if (merged) {
        await session.end(merged);
      } else {
        await session.end();
      }
      if (streamSessionRef.current === session) streamSessionRef.current = null;
      if (replayGenRef.current !== gen) return;
      playingRef.current = false;
      setPlaying(false);
      setPaused(false);
      if (activeReplayIdRef.current === id) {
        setActiveReplayId('');
        activeReplayIdRef.current = '';
      }
      const last = karaokeWordsRef.current.at(-1);
      const remainMs = last
        ? Math.max(400, Math.round((last.end - getPlaybackSecRef.current()) * 1000) + 350)
        : 500;
      setTimeout(() => {
        if (replayGenRef.current === gen && !streamSessionRef.current) clearKaraoke();
      }, remainMs);
    } catch (err) {
      if (streamSessionRef.current) {
        try { streamSessionRef.current.cancel(); } catch { /* ignore */ }
        streamSessionRef.current = null;
      }
      if (!isAbortError(err) && replayGenRef.current === gen && !s.abort.signal.aborted) {
        // Stream failed or key invalid -> fallback to browser speech synthesis
        await speakViaBrowserSpeechSynthesis(speech, {
          lang: getActiveLocale(),
          signal: s.abort.signal,
        });
      }
      if (replayGenRef.current === gen) {
        playingRef.current = false;
        setPlaying(false);
        setPaused(false);
        setActiveReplayId('');
        activeReplayIdRef.current = '';
        clearKaraoke();
        if (!isAbortError(err)) {
          pushToast(err instanceof Error ? err.message : tRef.current('voice.toast.replayFailed'), { type: 'error' });
        }
      }
    } finally {
      if (replayGenRef.current === gen) {
        muteUntilRef.current = Date.now() + TTS_MUTE_COOLDOWN_MS;
        syncMicMute();
      }
    }
  }, [
    stopPlaybackPipeline,
    togglePause,
    clearKaraoke,
    appendKaraokeTimestamps,
    startKaraokeClock,
    armKaraokeForWsReady,
    maybeRescaleSentences,
    primeHttpKaraoke,
    pushToast,
    syncMicMute,
  ]);

  const handleVoiceEvent = useCallback((event) => {
    if (event?.type === 'run_aborted') {
      stopPlaybackPipeline();
      return;
    }
    if (event?.type === 'inject') {
      if (getPresentationActiveRef.current()) {
        stopComposerPlayback();
      } else {
        stopPlaybackPipeline();
      }
      return;
    }
    if (!voiceAutoplayEnabled()) return;
    const extracted = extractCursorStreamSpeech(event);
    let { text, final, runKey, lifecycleOnly } = extracted;

    if (final && text) {
      text = undoubleSpeechText(text, streamRef.current.lastSpeech);
    }

    if (!text && !final) return;
    setActiveReplayId('');
    activeReplayIdRef.current = '';
    feedStreamSpeech(text, { final, runKey, lifecycleOnly: Boolean(lifecycleOnly) });
  }, [feedStreamSpeech, stopPlaybackPipeline, stopComposerPlayback, voiceAutoplayEnabled]);

  useEffect(() => {
    if (!micLive) return undefined;
    const id = setInterval(syncMicMute, 120);
    return () => clearInterval(id);
  }, [micLive, playing, syncMicMute]);

  useEffect(() => () => {
    sttRef.current?.stop();
    streamRef.current.abort?.abort();
    try { streamSessionRef.current?.cancel(); } catch { /* ignore */ }
    if (karaokeRafRef.current) cancelAnimationFrame(karaokeRafRef.current);
  }, []);

  const clearComposerDraft = useCallback(() => {
    setDraftRef.current('');
    sttRef.current?.setBaseDraft('');
    sttRef.current?.clearVoiceBuffer?.();
    setVoicePreview('');
  }, []);

  const applyComposerDraft = useCallback((text) => {
    const next = String(text || '');
    setDraftRef.current(next);
    sttRef.current?.setBaseDraft(next);
  }, []);

  const beginTypedEdit = useCallback(() => {
    typingDraftRef.current = true;
  }, []);

  const endTypedEdit = useCallback(() => {
    typingDraftRef.current = false;
    const current = String(getDraftRef.current() || '');
    sttRef.current?.setBaseDraft(current);
  }, []);

  return {
    playbackOn,
    togglePlayback,
    karaokeOn: karaokeActive,
    karaokeSupported,
    toggleKaraoke,
    micLive,
    micPhase,
    micArmLeftMs,
    toggleMic,
    configured,
    groqAck,
    submitVoiceMessage,
    busy,
    playing,
    paused,
    voicePreview,
    karaokeWords,
    karaokeIndex,
    karaokeGrain,
    activeReplayId,
    replaySpeech,
    pausePlayback,
    resumePlayback,
    togglePause,
    stopPlayback,
    clearComposerDraft,
    applyComposerDraft,
    beginTypedEdit,
    endTypedEdit,
    prepareForPresentation,
    handleVoiceEvent,
    armRouteVoice,
    primeLiveTtsRef,
    presentationLiveTtsRef,
    primeTtsSpokeRef,
  };
}
