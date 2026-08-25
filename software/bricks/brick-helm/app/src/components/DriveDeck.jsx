import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Eraser, Loader2, Mic, MicOff, Square, Volume2, VolumeX, ShieldAlert, Sparkles } from 'lucide-react';
import { useLocale } from '../context/LocaleContext.jsx';
import { playGoConfirmBeep, playClearConfirmBeep, playStopConfirmBeep, unlockAudioPlayback, primeMicReadyChime } from '../lib/voicePlaybackPipeline.js';
import {
  splitVoiceSendCommand,
  splitVoiceClearCommand,
  splitVoiceRebornCommand,
  hasVoiceRebornKeyword,
} from '../lib/voiceSendTrigger.js';

/**
 * Driver / walker / remote deck: dictation, big Send, then mic + speaker side by side.
 * Text area is always editable so Android/iOS IME can correct acronyms.
 */
export default function DriveDeck({
  dictation = '',
  draft = '',
  mode = 'route',
  micLive = false,
  micPhase = 'off',
  playbackOn = false,
  playing = false,
  agentBusy = false,
  preparing = false,
  sending = false,
  onToggleMic,
  onTogglePlayback,
  onStop,
  onSend,
  onClear,
  onReborn,
  onDraftChange,
  onDraftFocus,
  onDraftBlur,
}) {
  const { t } = useLocale();
  const text = String(draft || '');
  // A spinner alone cannot be told from a frozen UI — the elapsed counter is
  // the proof that the run is still alive.
  const [busySeconds, setBusySeconds] = useState(0);
  const busyStartRef = useRef(0);
  const [interrupted, setInterrupted] = useState(false);
  const interruptedTimerRef = useRef(0);
  // Driving: the deck is used without looking, so state is carried by size and
  // colour rather than text, and every target stays thumb-sized.
  const busy = Boolean(agentBusy || sending || playing || preparing);

  useEffect(() => {
    if (!busy) {
      busyStartRef.current = 0;
      setBusySeconds(0);
      return undefined;
    }
    setInterrupted(false);
    busyStartRef.current = Date.now();
    setBusySeconds(0);
    const id = setInterval(() => {
      setBusySeconds(Math.floor((Date.now() - busyStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [busy]);
  const trimmed = text.trim();
  const micReady = micPhase === 'listening' || micLive;
  const micBusy = micPhase === 'connecting' || micPhase === 'arming';
  const canSend = Boolean(trimmed) && !sending && !agentBusy;
  const placeholder = `${mode === 'remote' ? t('mode.remoteBody') : t('mode.routeBody')} ${t('mode.driveHintGo')}`;

  const handleSend = () => {
    if (!canSend) return;
    const split = splitVoiceSendCommand(trimmed);
    const payload = String((split.triggered ? split.message : trimmed) || '').trim();
    if (!payload) return;
    playGoConfirmBeep();
    onSend?.(payload, []);
    onClear?.();
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className={`h-1/2 min-h-[6rem] shrink-0 rounded-2xl border px-3 py-2 flex flex-col transition-colors ${
        preparing ? 'border-amber-400/60 bg-amber-950/30' : 'border-white/10 bg-black/40'
      }`}>
        {preparing ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-center" role="status" aria-live="polite">
            <Loader2 size={40} className="animate-spin text-amber-300" />
            <span className="text-xl font-bold text-amber-100">{t('mode.drivePreparing')}</span>
            <span className="tabular-nums text-2xl font-bold text-amber-200">{busySeconds}s</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 pb-1 border-b border-white/5 mb-1 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {busy ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0 animate-ping" />
                    <span>En action · {busySeconds}s</span>
                  </span>
                ) : interrupted ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/25 text-red-200 border border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.3)]">
                    <ShieldAlert size={12} className="shrink-0 text-red-400" />
                    <span>Interrompu · En attente</span>
                  </span>
                ) : micReady ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                    <span>À l’écoute · Dites « go » pour envoyer</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/5 text-slate-400 border border-white/10">
                    <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                    <span>En attente · Prêt</span>
                  </span>
                )}
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => {
                const next = e.target.value;
                const wiped = splitVoiceClearCommand(next);
                if (wiped.triggered) {
                  playClearConfirmBeep();
                  onClear?.();
                  return;
                }
                if (hasVoiceRebornKeyword(next) || splitVoiceRebornCommand(next).triggered) {
                  playClearConfirmBeep();
                  onClear?.();
                  onReborn?.();
                  return;
                }
                const sent = splitVoiceSendCommand(next);
                if (sent.triggered) {
                  const payload = String(sent.message || '').trim();
                  if (payload) {
                    playGoConfirmBeep();
                    onSend?.(payload, []);
                    onClear?.();
                  }
                  return;
                }
                onDraftChange?.(next);
              }}
              onFocus={() => onDraftFocus?.()}
              onBlur={() => onDraftBlur?.()}
              inputMode="text"
              enterKeyHint="done"
              autoCapitalize="sentences"
              autoCorrect="on"
              autoComplete="off"
              spellCheck
              rows={4}
              aria-label={t('mode.driveDictation')}
              placeholder={placeholder}
              className="flex-1 min-h-0 w-full resize-none bg-transparent border-0 text-[18px] leading-snug text-white font-medium placeholder:text-slate-500 placeholder:font-normal placeholder:text-base focus:outline-none focus:ring-0 theme-scrollbar whitespace-pre-wrap break-words"
              style={{ fontSize: '18px' }}
            />
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex-1 min-h-[4.5rem] grid grid-cols-3 gap-2">
      <button
        type="button"
        onClick={() => {
          playClearConfirmBeep();
          onClear?.();
        }}
        disabled={!trimmed}
        className={`flex-1 min-h-[4.5rem] rounded-3xl border-2 text-2xl font-bold inline-flex items-center justify-center gap-3 active:scale-[0.99] transition ${
          trimmed
            ? 'border-amber-400/50 bg-amber-950/70 text-amber-100'
            : 'border-white/10 bg-[#1a2233] text-slate-600'
        }`}
        aria-label={t('mode.driveEraseHint')}
        title={t('mode.driveErase')}
      >
        <Eraser size={40} />
      </button>

      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        className={`col-span-2 flex-1 min-h-[4.5rem] rounded-3xl border-2 text-2xl font-bold inline-flex items-center justify-center gap-3 px-3 active:scale-[0.99] transition ${
          canSend
            ? 'border-violet-300 bg-violet-600 text-white shadow-[0_0_36px_rgba(124,58,237,0.4)]'
            : 'border-white/10 bg-[#1a2233] text-slate-500'
        }`}
        aria-label={t('chat.send')}
      >
        <ArrowUp size={36} strokeWidth={2.6} className="shrink-0" />
        <span className="min-w-0 truncate">{t('chat.send')}</span>
      </button>
      </div>

      <div className="flex-1 min-h-[4.5rem] grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            void unlockAudioPlayback();
            primeMicReadyChime();
            onToggleMic?.();
          }}
          className={`flex flex-row items-center justify-center gap-2 rounded-3xl border-2 h-full active:scale-[0.98] transition ${
            micReady
              ? 'border-emerald-400 bg-emerald-600 text-white shadow-[0_0_40px_rgba(16,185,129,0.35)]'
              : micBusy
                ? 'border-amber-400/50 bg-amber-900/40 text-amber-100'
                : 'border-white/15 bg-[#121a2b] text-slate-200'
          }`}
          aria-pressed={micReady}
          aria-label={micReady ? t('chat.mic.activeHint') : t('chat.mic.start')}
        >
          {micReady
            ? <Mic size={34} strokeWidth={2.2} className="shrink-0" />
            : <MicOff size={34} strokeWidth={2.2} className="shrink-0" />}
          <span className="min-w-0 truncate text-lg font-bold tracking-wide">{t('chat.mic.label')}</span>
        </button>

        <button
          type="button"
          onClick={() => { void unlockAudioPlayback(); onTogglePlayback?.(); }}
          className={`flex flex-row items-center justify-center gap-2 rounded-3xl border-2 h-full active:scale-[0.98] transition ${
            playbackOn
              ? 'border-sky-400 bg-sky-600 text-white shadow-[0_0_40px_rgba(14,165,233,0.35)]'
              : 'border-white/15 bg-[#121a2b] text-slate-200'
          }`}
          aria-pressed={playbackOn}
          aria-label={playbackOn ? t('chat.playback.disable') : t('chat.playback.enable')}
        >
          {playbackOn
            ? <Volume2 size={34} strokeWidth={2.2} className="shrink-0" />
            : <VolumeX size={34} strokeWidth={2.2} className="shrink-0" />}
          <span className="min-w-0 truncate text-lg font-bold tracking-wide">{t('mode.driveSpeak')}</span>
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          playStopConfirmBeep();
          onStop?.();
          setInterrupted(true);
          if (interruptedTimerRef.current) clearTimeout(interruptedTimerRef.current);
          interruptedTimerRef.current = setTimeout(() => setInterrupted(false), 5000);
        }}
        className={`h-[4.5rem] rounded-3xl border-2 text-2xl font-bold inline-flex items-center justify-center gap-3 active:scale-[0.99] transition ${
          busy
            ? 'border-red-300 bg-red-600 text-white shadow-[0_0_40px_rgba(220,38,38,0.5)]'
            : 'border-white/15 bg-[#1a2233] text-slate-400'
        }`}
        aria-label={t('options.stop')}
      >
        {busy ? (
          <span className="relative flex h-4 w-4 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-200 opacity-70 animate-ping" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-white" />
          </span>
        ) : (
          <Square size={28} fill="currentColor" />
        )}
        <span className="min-w-0 truncate">{t('options.stop')}</span>
        {busy ? (
          <span className="shrink-0 tabular-nums text-2xl font-bold text-red-50">
            {busySeconds >= 60
              ? `${Math.floor(busySeconds / 60)}:${String(busySeconds % 60).padStart(2, '0')}`
              : `${busySeconds}s`}
          </span>
        ) : null}
      </button>
      </div>
    </div>
  );
}
