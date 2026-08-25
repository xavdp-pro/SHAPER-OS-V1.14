import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp, FileText, Loader2, Mic, MicOff, Paperclip, Pause, Play, Square, Volume2, VolumeX, X,
} from 'lucide-react';
import { useLocale } from '../context/LocaleContext.jsx';
import { uploadAttachment } from '../api/client.js';
import { VOICE_SEND_WORD } from '../lib/voiceSendTrigger.js';

const MAX_IMAGES = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DOC_BYTES = 20 * 1024 * 1024;
/** Documents the agent can analyse (deploys its doc pipeline in-workspace). */
const DOC_EXT_RE = /\.(pdf|docx?|xlsx?|csv|txt|md|json|pptx?|odt|ods|rtf)$/i;
const DOC_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.ppt,.pptx,.odt,.ods,.rtf';

function isImageFile(file) {
  return file.type.startsWith('image/');
}
const INPUT_MAX_ROWS = 3;
const MOBILE_MQ = '(max-width: 639px)';
const VOICE_MOBILE_MAX_VH = 0.38;
/** Once the mic is used in this tab session, stop the idle glow invite. */
const MIC_GLOW_USED_KEY = 'kovzu-mic-glow-used';

function readMicGlowUsed() {
  try {
    return sessionStorage.getItem(MIC_GLOW_USED_KEY) === '1';
  } catch {
    return false;
  }
}

function markMicGlowUsed() {
  try {
    sessionStorage.setItem(MIC_GLOW_USED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Discreet placeholder-style hint with a soft fade on the send keyword. */
function VoiceGoHint({ label }) {
  const parts = String(label || '').split('{go}');
  if (parts.length < 2) {
    return <>{label}</>;
  }
  return (
    <>
      {parts[0]}
      <span className="voice-go-fade">{VOICE_SEND_WORD}</span>
      {parts.slice(1).join('{go}')}
    </>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

function readAttachmentFile(file) {
  return new Promise((resolve, reject) => {
    const image = isImageFile(file);
    const isDoc = !image && DOC_EXT_RE.test(file.name || '');
    if (!image && !isDoc) {
      reject(new Error('Type de fichier non pris en charge'));
      return;
    }
    if (image && file.size > MAX_BYTES) {
      reject(new Error('Image trop volumineuse (max 8 Mo)'));
      return;
    }
    if (isDoc && file.size > MAX_DOC_BYTES) {
      reject(new Error('Document trop volumineux (max 20 Mo)'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: crypto.randomUUID(),
      name: file.name || (image ? `image-${Date.now()}.png` : `fichier-${Date.now()}`),
      dataUrl: reader.result,
      kind: image ? 'image' : 'doc',
    });
    reader.onerror = () => reject(new Error('File reading failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Sticky composer in ChatGPT / Claude style:
 * floats above messages (z-index), gradient, safe-area.
 */
export default function ChatInput({
  draft,
  setDraft,
  sending,
  stopping = false,
  activePath,
  onSend,
  onHeightChange,
  onClearDraft,
  voicePlaybackOn = false,
  onToggleVoicePlayback,
  voiceMicLive = false,
  voiceMicPhase = 'off',
  voiceMicArmLeftMs = 0,
  onToggleVoiceMic,
  voiceBusy = false,
  voiceConfigured = false,
  voicePlaying = false,
  voicePaused = false,
  onToggleVoicePause,
  onStopVoice,
  voicePreview = '',
  voiceModeActive = false,
  presentationBlocking = false,
  onStopPresentation,
  agentBusy = false,
  onStop,
}) {
  const { t } = useLocale();
  const micListening = voiceMicLive && voiceMicPhase === 'listening';
  const micArming = voiceMicLive && (voiceMicPhase === 'connecting' || voiceMicPhase === 'arming');
  const armSec = Math.max(1, Math.ceil(voiceMicArmLeftMs / 1000));
  const micStatusLabel = !voiceMicLive
    ? ''
    : voiceMicPhase === 'connecting'
      ? t('chat.mic.connecting')
      : voiceMicPhase === 'arming'
        ? t('chat.mic.armCountdown').replace('{sec}', String(armSec))
        : t('chat.mic.listening');
  const isMobile = useIsMobile();
  const voiceMobileExpanded = isMobile && (voiceMicLive || voiceModeActive);
  const [attachments, setAttachments] = useState([]);
  const [draftExpanded, setDraftExpanded] = useState(false);
  const formRef = useRef(null);
  const dockRef = useRef(null);
  const textareaRef = useRef(null);
  const voiceDraftRef = useRef(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const maxHeight = voiceMobileExpanded
      ? Math.max(lineHeight * INPUT_MAX_ROWS + padding, window.innerHeight * VOICE_MOBILE_MAX_VH)
      : lineHeight * INPUT_MAX_ROWS + padding;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
    if (voiceMicLive) {
      el.scrollTop = el.scrollHeight;
    }
  }, [voiceMicLive, voiceMobileExpanded]);

  useEffect(() => {
    resizeTextarea();
  }, [draft, attachments.length, resizeTextarea]);

  useEffect(() => {
    if (!voiceMicLive || !draft.trim()) return;
    const el = voiceDraftRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [draft, voiceMicLive]);

  useEffect(() => {
    if (!voiceMicLive) setDraftExpanded(false);
  }, [voiceMicLive]);

  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el || !onHeightChange) return undefined;
    let last = 0;
    const report = () => {
      const h = el.offsetHeight || 88;
      if (Math.abs(h - last) < 1) return;
      last = h;
      onHeightChange(h);
    };
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  const fileInputRef = useRef(null);

  const addAttachment = async (file) => {
    if (attachments.length >= MAX_IMAGES) return;
    if (!activePath) return;
    const placeholder = {
      id: crypto.randomUUID(),
      name: file.name || `fichier-${Date.now()}`,
      dataUrl: '',
      kind: isImageFile(file) ? 'image' : 'doc',
      uploadStatus: 'uploading',
    };
    setAttachments((prev) => [...prev, placeholder]);
    let att;
    try {
      att = await readAttachmentFile(file);
    } catch {
      setAttachments((prev) => prev.filter((a) => a.id !== placeholder.id));
      return;
    }
    setAttachments((prev) => prev.map((a) => (
      a.id === placeholder.id
        ? { ...att, id: placeholder.id, uploadStatus: 'uploading' }
        : a
    )));
    const uploadStarted = Date.now();
    const up = await uploadAttachment(att.name, att.dataUrl, {
      uploadId: placeholder.id,
      kind: att.kind,
    });
    const minSpinMs = 450;
    const waitLeft = minSpinMs - (Date.now() - uploadStarted);
    if (waitLeft > 0) await new Promise((r) => setTimeout(r, waitLeft));
    if (up.ok && up.data?.rel) {
      setAttachments((prev) => prev.map((a) => (
        a.id === placeholder.id
          ? {
            ...a,
            uploadStatus: 'ready',
            rel: up.data.rel,
            abs: up.data.abs || '',
          }
          : a
      )));
      return;
    }
    const err = up.data?.error || up.data?.detail || t('toast.uploadFailed');
    setAttachments((prev) => prev.map((a) => (
      a.id === placeholder.id
        ? { ...a, uploadStatus: 'error', uploadError: err }
        : a
    )));
  };

  const handleFilePick = (e) => {
    const files = [...(e.target.files || [])];
    files.forEach((f) => addAttachment(f));
    e.target.value = '';
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const fileItems = [...items].filter((it) => it.kind === 'file');
    if (!fileItems.length) return;
    e.preventDefault();
    fileItems.forEach((item) => {
      const file = item.getAsFile();
      if (file) addAttachment(file);
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if ((!text && !attachments.length) || sending) return;
    onSend(text, attachments);
    setAttachments([]);
  };

  const handleClear = () => {
    setDraft('');
    setAttachments([]);
    onClearDraft?.();
    textareaRef.current?.focus();
  };

  const attachmentsUploading = attachments.some((a) => a.uploadStatus === 'uploading');
  const attachmentsReady = !attachments.length || attachments.every((a) => a.uploadStatus === 'ready');
  const canSend = Boolean(activePath) && !sending && !stopping && !attachmentsUploading
    && attachmentsReady
    && (draft.trim() || attachments.length);
  const canClear = Boolean(draft.trim() || attachments.length);
  const disabled = sending || stopping || !activePath;
  const voiceDisabled = disabled || voiceBusy || voicePlaying;
  const showVoice = Boolean(onToggleVoiceMic || onToggleVoicePlayback);
  const [micGlowPulse, setMicGlowPulse] = useState(false);
  const [micGlowDone, setMicGlowDone] = useState(() => readMicGlowUsed());

  const showStop = Boolean(onStop && agentBusy);

  // First mic use in this session → permanently stop the glow invite.
  useEffect(() => {
    if (!voiceMicLive || micGlowDone) return;
    markMicGlowUsed();
    setMicGlowDone(true);
    setMicGlowPulse(false);
  }, [voiceMicLive, micGlowDone]);

  // Soft glow ripple on the mic every 2–7s (idle only) until used once this session.
  useEffect(() => {
    if (micGlowDone || !showVoice || !voiceConfigured || voiceMicLive || voiceDisabled) {
      setMicGlowPulse(false);
      return undefined;
    }
    let pulseTimer = 0;
    let waitTimer = 0;
    const schedule = () => {
      const delay = 2000 + Math.random() * 5000;
      waitTimer = window.setTimeout(() => {
        setMicGlowPulse(true);
        pulseTimer = window.setTimeout(() => {
          setMicGlowPulse(false);
          schedule();
        }, 1400);
      }, delay);
    };
    schedule();
    return () => {
      window.clearTimeout(waitTimer);
      window.clearTimeout(pulseTimer);
    };
  }, [micGlowDone, showVoice, voiceConfigured, voiceMicLive, voiceDisabled]);
  const composerPadLeft = 'pl-16';
  const composerPadRight = showVoice
    ? (voicePlaying
      ? (canClear ? 'pr-44' : 'pr-36')
      : (canClear ? 'pr-32' : 'pr-24'))
    : (canClear ? 'pr-22' : 'pr-14');

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (showStop || agentBusy) return;
    if (canSend) formRef.current?.requestSubmit();
  };

  return (
    <div
      ref={dockRef}
      className="chat-composer-dock pointer-events-none"
      aria-label={t('chat.composer.region')}
    >
      <div className="chat-composer-fade" aria-hidden="true" />
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="relative pointer-events-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4"
      >
        {attachmentsUploading && (
          <p className="text-[11px] text-amber-300/90 px-1 mb-2 max-w-3xl mx-auto" role="status" aria-live="polite">
            <Loader2 size={12} className="inline animate-spin mr-1.5 -mt-0.5" aria-hidden />
            {t('chat.attach.uploading')}
          </p>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 max-w-3xl mx-auto">
            {attachments.map((att) => (
              <div key={att.id} className="relative group">
                {att.kind === 'doc' ? (
                  <div
                    className={`flex items-center gap-2 h-14 max-w-[12rem] px-3 rounded-lg border bg-white/5 ${
                      att.uploadStatus === 'error'
                        ? 'border-red-400/50'
                        : att.uploadStatus === 'uploading'
                          ? 'border-amber-400/40'
                          : 'border-white/20'
                    }`}
                    title={att.uploadError || att.abs || att.name}
                  >
                    {att.uploadStatus === 'uploading' ? (
                      <Loader2 size={18} className="shrink-0 text-amber-300 animate-spin" />
                    ) : (
                      <FileText size={18} className="shrink-0 text-brand-300" />
                    )}
                    <span className="text-xs text-slate-200 truncate">{att.name}</span>
                  </div>
                ) : (
                  <div className="relative h-14 w-14">
                    {att.dataUrl ? (
                      <img
                        src={att.dataUrl}
                        alt={att.name}
                        className={`h-14 w-14 object-cover rounded-lg border ${
                          att.uploadStatus === 'error'
                            ? 'border-red-400/50'
                            : att.uploadStatus === 'uploading'
                              ? 'border-amber-400/40 opacity-60'
                              : 'border-white/20'
                        }`}
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-lg border border-amber-400/40 bg-white/5" />
                    )}
                    {att.uploadStatus === 'uploading' && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                        <Loader2 size={18} className="text-amber-200 animate-spin" />
                      </div>
                    )}
                  </div>
                )}
                {att.uploadStatus === 'ready' && att.abs && (
                  <span className="sr-only">{t('chat.attach.ready')}</span>
                )}
                {att.uploadStatus === 'error' && (
                  <span className="absolute -bottom-4 left-0 text-[9px] text-red-300 truncate max-w-[12rem]">
                    {att.uploadError || t('toast.uploadFailed')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-red-600 text-white shadow"
                  aria-label={t('chat.image.remove')}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="max-w-3xl mx-auto">
          {presentationBlocking && (
            <div
              className="flex items-center gap-2 px-1 mb-2"
              role="status"
              aria-live="polite"
            >
              <span className="presentation-signal-dot shrink-0" aria-hidden />
              <p className="text-[11px] text-amber-300/90 flex-1 min-w-0">
                {t('chat.presentation.hint')}
              </p>
              {onStopPresentation && (
                <button
                  type="button"
                  onClick={onStopPresentation}
                  className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:bg-red-500/20 hover:text-red-200 hover:border-red-400/30 transition cursor-pointer"
                  title={t('chat.presentation.stop')}
                  aria-label={t('chat.presentation.stop')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          {voiceMicLive && (
            <div
              className="flex items-end gap-2 px-1 mb-2"
              role="status"
              aria-live="polite"
              aria-label={micStatusLabel}
            >
              <div className={`voice-listening-bubble ${micArming ? 'opacity-60' : ''}`}>
                {micArming ? (
                  <Loader2 size={14} className="animate-spin text-amber-300" aria-hidden />
                ) : (
                  <span className="voice-listening-dots" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 pb-0.5">
                <p className={`text-[11px] font-medium ${
                  micListening ? 'text-emerald-300/90' : 'text-amber-300/90'
                }`}>
                  {micStatusLabel}
                </p>
                {micListening && voicePreview && !voiceMobileExpanded ? (
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">
                    {voicePreview}
                  </p>
                ) : null}
              </div>
            </div>
          )}
          {voiceMobileExpanded && draft.trim() && (
            <button
              type="button"
              onClick={() => setDraftExpanded(true)}
              className="mb-2 w-full text-left rounded-xl border border-emerald-500/25 bg-[#0d1320]/95 px-3 py-2.5 shadow-inner focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              aria-label={t('chat.dictated.open')}
            >
              <p className="text-[10px] font-medium text-emerald-300/80 mb-1">
                {t('chat.dictated.expandHint')}
              </p>
              <div
                ref={voiceDraftRef}
                className="max-h-[min(38vh,11rem)] overflow-y-auto text-sm text-slate-100 leading-relaxed whitespace-pre-wrap break-words theme-scrollbar pointer-events-none"
                aria-live="polite"
              >
                {draft}
              </div>
            </button>
          )}
          <div
            data-help-target="help-voice-go"
            className={`relative rounded-2xl border shadow-lg backdrop-blur-xl transition ${
              disabled
                ? 'border-white/5 bg-[#111827]/85 opacity-70'
                : 'border-white/15 bg-[#111827]/92 focus-within:border-brand-500/45 focus-within:ring-2 focus-within:ring-brand-500/15'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={DOC_ACCEPT}
              multiple
              className="hidden"
              onChange={handleFilePick}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || attachments.length >= MAX_IMAGES}
              className="absolute left-2 bottom-2 flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed z-[1]"
              title={t('chat.attach')}
              aria-label={t('chat.attach')}
            >
              <Paperclip size={15} />
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              rows={1}
              className={`w-full bg-transparent border-0 rounded-2xl py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none resize-none theme-scrollbar leading-relaxed ${voiceMobileExpanded ? 'overflow-y-auto' : 'overflow-hidden'} ${composerPadLeft} pr-4 ${composerPadRight}`}
              placeholder={
                presentationBlocking
                  ? t('chat.presentation.placeholder')
                  : micListening
                  ? ''
                  : micArming
                    ? t('chat.mic.waitSignal')
                    : activePath
                      ? t('chat.placeholder')
                      : t('chat.selectConv')
              }
              disabled={disabled}
            />
            {micListening && !draft.trim() && !presentationBlocking && (
              <div
                className="pointer-events-none absolute left-16 top-3 right-16 text-sm text-slate-500 leading-relaxed select-none"
                aria-hidden
              >
                <VoiceGoHint label={t('chat.voiceHint')} />
              </div>
            )}
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              {canClear && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={disabled}
                  className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title={t('chat.clear')}
                  aria-label={t('chat.clear')}
                >
                  <X size={15} />
                </button>
              )}
              {showVoice && (
                <div className="flex items-center gap-1">
                  {voicePlaying && (
                    <>
                      <button
                        type="button"
                        onClick={onToggleVoicePause}
                        className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-600/25 text-emerald-200 hover:bg-emerald-600/40 transition cursor-pointer"
                        title={voicePaused ? t('chat.tts.resume') : t('chat.tts.pauseHint')}
                        aria-label={voicePaused ? t('timeline.resume') : t('timeline.pause')}
                      >
                        {voicePaused ? <Play size={15} className="fill-current" /> : <Pause size={15} />}
                      </button>
                      <button
                        type="button"
                        onClick={onStopVoice}
                        className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-600/30 text-red-200 hover:bg-red-600/45 transition cursor-pointer"
                        title={t('chat.tts.stop')}
                        aria-label={t('chat.tts.stopAria')}
                      >
                        <Square size={13} className="fill-current" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={onToggleVoiceMic}
                    disabled={voiceDisabled || !voiceConfigured}
                    data-help-target="help-voice-mic"
                    className={`relative flex items-center justify-center w-10 h-10 rounded-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-visible ${
                      voiceMicLive
                        ? micListening
                          ? 'bg-red-600/80 text-white hover:bg-red-500'
                          : 'bg-amber-600/70 text-white hover:bg-amber-500'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
                    }${micGlowPulse ? ' mic-glow-ripple' : ''}`}
                    title={
                      !voiceConfigured
                        ? t('chat.mic.notConfigured')
                        : micListening
                          ? t('chat.mic.activeHint')
                          : micArming
                            ? t('chat.mic.armingHint')
                            : t('chat.mic.start')
                    }
                    aria-label={t('chat.mic.label')}
                    aria-pressed={voiceMicLive}
                  >
                    {micGlowPulse && (
                      <>
                        <span className="mic-glow-ripple__ring" aria-hidden />
                        <span className="mic-glow-ripple__ring mic-glow-ripple__ring--delay" aria-hidden />
                      </>
                    )}
                    <span className="relative z-[1]">
                      {voiceBusy || micArming ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : voiceMicLive ? (
                        <MicOff size={15} />
                      ) : (
                        <Mic size={15} />
                      )}
                    </span>
                    {micListening && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 z-[1]" />
                    )}
                    {micArming && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse z-[1]" />
                    )}
                  </button>
                </div>
              )}
              {showVoice && onToggleVoicePlayback && (
                <button
                  type="button"
                  onClick={onToggleVoicePlayback}
                  disabled={!voiceConfigured}
                  data-help-target="help-voice-audio"
                  className={`flex items-center justify-center w-10 h-10 rounded-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    voicePlaybackOn
                      ? 'bg-brand-600/25 text-brand-300 hover:bg-brand-600/35'
                      : 'bg-white/5 text-slate-500 hover:bg-white/10'
                  }`}
                  title={
                    !voiceConfigured
                      ? t('chat.playback.notConfigured')
                      : voicePlaybackOn
                        ? t('chat.playback.onHint')
                        : t('chat.playback.offHint')
                  }
                  aria-label={voicePlaybackOn ? t('chat.playback.disable') : t('chat.playback.enable')}
                  aria-pressed={voicePlaybackOn}
                >
                  {voicePlaybackOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
                </button>
              )}
              {showStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  disabled={stopping}
                  data-help-target="help-voice-send"
                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-600 hover:bg-red-500 text-white transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  title={t('chat.stop.title')}
                  aria-label={t('chat.stop')}
                >
                  {stopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={14} className="fill-current" />}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  data-help-target="help-voice-send"
                  className={`flex items-center justify-center w-10 h-10 rounded-xl transition cursor-pointer ${
                    canSend
                      ? 'bg-brand-600 hover:bg-brand-500 text-white'
                      : 'bg-white/5 text-slate-600'
                  } disabled:cursor-not-allowed`}
                  title={t('chat.send.title')}
                  aria-label={t('chat.send')}
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>

      {draftExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col pointer-events-auto sm:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label={t('help.close')}
            onClick={() => setDraftExpanded(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('chat.dictated.title')}
            className="relative mt-auto flex max-h-[min(88vh,100%)] flex-col rounded-t-2xl border border-white/10 bg-[#0f172a] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
              <p className="text-sm font-medium text-white">{t('chat.dictated.title')}</p>
              <button
                type="button"
                onClick={() => setDraftExpanded(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:bg-white/10"
                aria-label={t('help.close')}
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[40vh] flex-1 resize-none bg-transparent px-4 py-3 text-base text-white leading-relaxed focus:outline-none theme-scrollbar"
              aria-label={t('chat.dictated.edit')}
            />
            <div className="flex gap-2 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => setDraftExpanded(false)}
                className="btn-secondary flex-1 py-2.5 text-sm"
              >
                {t('help.close')}
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={() => {
                  setDraftExpanded(false);
                  formRef.current?.requestSubmit();
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40"
              >
                <ArrowUp size={16} />
                {t('chat.send')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
