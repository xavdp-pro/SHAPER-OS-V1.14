import { memo, useEffect, useRef, useState } from 'react';
import {
  Bot, Brain, ChevronDown, ChevronUp, FileText, Pause, Pencil, Play, ScrollText, Square, Terminal, Wrench, X, Check,
} from 'lucide-react';
import StreamingMarkdown from './StreamingMarkdown.jsx';
import { CodePanel } from './MarkdownContent.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import TerminalView from './TerminalView.jsx';
import CopyCodeButton from './CopyCodeButton.jsx';
import { stripEmotionTagsForDisplay } from '../lib/emotionTags.js';
import { isRunActive, isEmptyRunShell, resolveLiveKaraokeBlockId } from '../lib/runStream.js';
import { stripLeadingVoiceAck } from '../lib/voiceAckStrip.js';
import {
  normalizeToolName, parseToolInput, toolCommand, toolCwd, toolHeaderPreview,
  isShellTool, formatToolResultForDisplay,
} from '../lib/toolFormat.js';
import { DEFAULT_VIEW_FILTERS } from '../lib/viewFilters.js';
import {
  RECENT_EXCHANGES_LIMIT,
  loadTimelineShowAll,
  saveTimelineShowAll,
  sliceRecentExchanges,
} from '../lib/timelineLimit.js';
import { looksLikeRichMarkdown } from '../lib/richContent.js';
import { useLocale } from '../context/LocaleContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';

const TOOL_ICONS = { shell: Terminal, edit: Wrench, grep: Terminal, read: Terminal };

function runHasAssistantText(blocks) {
  return (blocks || []).some((b) => b.type === 'assistant' && String(b.text || '').trim());
}

/** Closed run outcome — explain abort / empty outcome clearly. */
function RunOutcomeHint({ run, blocks, t }) {
  const closed = run.status === 'done' || run.status === 'aborted';
  if (!closed) return null;
  const hasAssistant = runHasAssistantText(blocks);
  const toolCount = (blocks || []).filter((b) => b.type === 'tool').length;
  const hasThinking = (blocks || []).some((b) => b.type === 'thinking' && String(b.text || '').trim());

  if (run.status === 'aborted') {
    const parts = [t('timeline.outcome.aborted') || 'Réponse interrompue'];
    if (!hasAssistant && (hasThinking || toolCount)) {
      const detail = [];
      if (hasThinking) detail.push(t('timeline.outcome.thinking') || 'réflexion');
      if (toolCount) detail.push((t('timeline.outcome.tools') || '{count} outil(s)').replace('{count}', String(toolCount)));
      parts.push(`(${detail.join(', ')})`);
    }
    return (
      <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-1.5 text-xs text-red-200" role="status">
        <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" aria-hidden />
        <span className="font-semibold">{parts.join(' ')}</span>
        <span className="text-red-300/70">· Arrêté, prêt pour votre commande</span>
      </div>
    );
  }

  if (hasAssistant) return null;
  if (!(blocks || []).length) return null;
  return (
    <p className="text-xs text-slate-500 px-1" role="status">
      {t('timeline.outcome.noReply')}
    </p>
  );
}

/** Compact status when a filter hides content but work is still in progress / just finished. */
function ActivityHint({ icon: Icon, label, tone = 'thinking', live = true }) {
  const tones = {
    thinking: 'border-violet-500/30 text-violet-300/90',
    tool: 'border-amber-500/30 text-amber-300/90',
    terminal: 'border-emerald-500/30 text-emerald-300/90',
    done: 'border-emerald-500/35 text-emerald-400/95',
  };
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] bg-black/25 ${tones[tone] || tones.thinking}`}
      role="status"
      aria-live="polite"
    >
      {live ? (
        <span className="stream-tool-spinner shrink-0" aria-hidden />
      ) : (
        <Check size={13} className="shrink-0 text-emerald-400" aria-hidden />
      )}
      {Icon && <Icon size={13} className="shrink-0 opacity-80" aria-hidden />}
      <span className="font-medium">{label}</span>
    </div>
  );
}

/** Friendly wait state during briefing — no terminal/tools noise. */
function PresentationWait({ title, hint }) {
  return (
    <div
      className="rounded-2xl border border-amber-400/30 bg-amber-500/[0.07] px-4 py-3.5 flex items-start gap-3"
      role="status"
      aria-live="polite"
    >
      <span className="presentation-signal-dot shrink-0 mt-1" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-amber-100/95">{title}</p>
        {hint ? (
          <p className="mt-1 text-[11px] text-amber-200/65 leading-relaxed">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Fixed colored zone — sunken (inset) panel in code/JSON style. */
function ZoneShell({ tone, live, header, children }) {
  const styles = {
    thinking: live
      ? 'border-violet-400/40'
      : 'border-violet-500/25',
    tool: live
      ? 'border-amber-400/35'
      : 'border-emerald-500/25',
    log: 'border-slate-500/25',
    system: 'border-red-500/20',
  };

  return (
    <div className={`zone-sunk rounded-xl border overflow-hidden ${styles[tone] || styles.log}`}>
      <div className="flex items-center gap-2 px-3 py-2 text-xs border-b border-white/5 bg-black/35">
        {header}
      </div>
      <div className="px-3 py-3 zone-sunk-body">{children}</div>
    </div>
  );
}

function ResponseActionBar({
  children,
  className = '',
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1 mt-2 pt-2 border-t border-white/5 opacity-100 ${className}`}>
      {children}
    </div>
  );
}

function VoiceAckBubble({
  item,
  onReplaySpeech,
  onToggleVoicePause,
  onStopSpeech,
  activeReplayId = '',
  voicePlaying = false,
  voicePaused = false,
  voiceConfigured = false,
}) {
  const { agentName } = useSettings();
  const { t } = useLocale();
  const pending = item.text === '…' || item.text === '...';
  const name = String(agentName || 'Zephir').trim() || 'Zephir';
  const replayId = `voice_ack:${item.id}`;
  const canReplay = voiceConfigured && !pending && Boolean(String(item.text || '').trim());
  const isActive = activeReplayId === replayId && voicePlaying;
  const showPause = isActive && !voicePaused;

  return (
    <div className="space-y-2" data-voice-ack="groq">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 px-1">
        <Bot size={12} className="text-sky-400 shrink-0" />
        <span className="text-slate-400 normal-case font-mono">{name} · Groq direct</span>
      </div>
      <div className={`max-w-[min(100%,42rem)] rounded-2xl border px-4 py-3 shadow-md group ${
        pending
          ? 'border-sky-400/50 bg-sky-500/20'
          : isActive
            ? 'border-sky-400/60 bg-sky-950/55 ring-1 ring-sky-500/20'
            : 'border-sky-400/55 bg-sky-950/55'
      }`}>
        <p className={`text-sm text-sky-50 leading-relaxed whitespace-pre-wrap ${pending ? 'animate-pulse opacity-70' : ''}`}>
          {pending ? t('timeline.ackPending') : item.text}
        </p>
        {canReplay && (
          <ResponseActionBar>
            <button
              type="button"
              onClick={() => {
                if (isActive) {
                  onToggleVoicePause?.();
                  return;
                }
                onReplaySpeech?.(item.text, { id: replayId });
              }}
              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                isActive
                  ? 'border-sky-400/40 bg-sky-500/15 text-sky-200'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:border-white/20'
              }`}
              title={showPause ? t('timeline.pause') : (isActive && voicePaused ? t('timeline.resume') : t('timeline.readAck'))}
              aria-label={showPause ? t('timeline.pause') : (isActive && voicePaused ? t('timeline.resume') : t('timeline.readAck'))}
            >
              {showPause ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
            </button>
            {isActive && (
              <button
                type="button"
                onClick={() => onStopSpeech?.()}
                className="p-1.5 rounded-lg border border-red-500/30 bg-red-600/20 text-red-200 hover:bg-red-600/35 transition cursor-pointer"
                title={t('chat.tts.stop')}
                aria-label={t('chat.tts.stopAria')}
              >
                <Square size={13} className="fill-current" />
              </button>
            )}
          </ResponseActionBar>
        )}
      </div>
    </div>
  );
}

function HumanBubble({ item, editable, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(item.text || '');
  }, [item.text, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    if (!editable) return;
    setDraft(item.text || '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(item.text || '');
    setEditing(false);
  };

  const submitEdit = () => {
    const text = draft.trim();
    if (!text) return;
    if (text === (item.text || '').trim()) {
      setEditing(false);
      return;
    }
    onEdit?.(item.id, text, item.images);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      submitEdit();
    }
  };

  return (
    <div className="flex justify-end items-start gap-1.5 min-w-0 w-full">
      {editable && !editing && (
        <button
          type="button"
          onClick={startEdit}
          className="shrink-0 mt-1.5 p-2 rounded-lg text-slate-300 bg-white/5 border border-white/10 hover:text-brand-300 hover:bg-white/10 transition"
          title="modifier ce message"
          aria-label="modifier ce message"
        >
          <Pencil size={15} />
        </button>
      )}
      <div className="max-w-[calc(100%-2.75rem)] sm:max-w-[85%] min-w-0 relative">
        <div className={`rounded-2xl px-4 py-3 text-sm bg-brand-600/30 text-white border border-brand-500/20 shadow-lg shadow-brand-900/15 ${
          editing ? 'ring-2 ring-brand-400/40' : ''
        }`}>
          {item.images?.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {item.images.map((img) => (
                <a
                  key={img.id}
                  href={img.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block shrink-0"
                  title={img.name || ''}
                >
                  {img.kind === 'doc' ? (
                    <span className="flex items-center gap-2 max-w-[14rem] px-3 py-2 rounded-lg border border-white/20 bg-white/5 text-sm text-slate-200">
                      <FileText size={16} className="shrink-0 text-brand-300" />
                      <span className="truncate">{img.name || 'document'}</span>
                    </span>
                  ) : (
                    <img
                      src={img.url}
                      alt={img.name || 'image'}
                      className="max-h-40 max-w-full rounded-lg border border-white/20 object-cover"
                    />
                  )}
                </a>
              ))}
            </div>
          )}
          {editing ? (
            <div className="space-y-2">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={Math.min(8, Math.max(2, draft.split('\n').length))}
                className="w-full bg-black/30 border border-white/15 rounded-xl px-3 py-2 text-sm text-white resize-y min-h-[4rem] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <p className="text-[10px] text-brand-200/70">
                Entrée = renvoyer depuis ce message · les messages suivants seront supprimés
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={cancelEdit} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-slate-300 hover:bg-white/10">
                  <X size={12} /> Annuler
                </button>
                <button
                  type="button"
                  onClick={submitEdit}
                  disabled={!draft.trim()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40"
                >
                  <Check size={12} /> Renvoyer
                </button>
              </div>
            </div>
          ) : (
            <>
              {item.text ? (
                <p className="whitespace-pre-wrap break-words leading-relaxed">{item.text}</p>
              ) : null}
              {item.edited_at ? (
                <p className="text-[10px] text-brand-200/50 mt-1">modifié</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SystemBubble({ text }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl px-3 py-2 text-xs bg-red-950/30 text-red-200 border border-red-500/20">
        {text}
      </div>
    </div>
  );
}

function ThinkingBlock({ block, conversation, workspaceCwd }) {
  const { t } = useLocale();
  const live = Boolean(block.streaming);
  if (!block.text && !live) return null;
  const copyText = stripEmotionTagsForDisplay(block.text || '');

  return (
    <ZoneShell
      tone="thinking"
      live={live}
      header={(
        <>
          <Brain size={14} className="text-violet-400 shrink-0" />
          <span className="font-medium text-violet-200">{t('timeline.thinking')}</span>
          {live && <span className="text-[10px] text-violet-400/80">{t('status.live')}</span>}
          <CopyCodeButton
            text={copyText}
            label={t('timeline.thinking')}
            className="ml-auto"
          />
        </>
      )}
    >
      <StreamingMarkdown
        text={block.text}
        streaming={live}
        className="md-prose-violet font-mono text-xs text-violet-200/90"
        cursorVariant="violet"
        conversation={conversation}
        workspaceCwd={workspaceCwd}
      />
    </ZoneShell>
  );
}

function ToolBlock({ block, runStatus = 'running', conversation = '', workspaceCwd = '' }) {
  const { t } = useLocale();
  const running = runStatus === 'running' && block.status === 'running';
  const tool = normalizeToolName(block.tool);
  const isShell = isShellTool(block.tool, block.input);
  const args = parseToolInput(block.input);
  const command = block.command || toolCommand(args);
  const cwd = block.cwd || toolCwd(args);
  const preview = toolHeaderPreview(tool, block.input, { command, cwd });
  const Icon = TOOL_ICONS[tool] || Wrench;
  const resultText = formatToolResultForDisplay(block.result, { tool: block.tool, input: block.input });
  const richResult = looksLikeRichMarkdown(resultText);
  const statusLabel = running ? t('timeline.running') : t('timeline.done');

  if (isShell) {
    return (
      <ZoneShell
        tone="tool"
        live={running}
        header={(
          <>
            <Terminal size={14} className="text-emerald-400 shrink-0" />
            <span className="font-mono font-medium text-brand-300">{t('timeline.terminal')}</span>
            {preview && (
              <span className="truncate text-slate-500 font-mono text-[10px] ml-1 flex-1 min-w-0">{preview}</span>
            )}
            <span className={`text-[10px] shrink-0 ${running ? 'text-amber-400' : 'text-emerald-500'}`}>
              {statusLabel}
            </span>
          </>
        )}
      >
        <TerminalView command={command} cwd={cwd} output={resultText} running={running} />
      </ZoneShell>
    );
  }

  return (
    <ZoneShell
      tone="tool"
      live={running}
      header={(
        <>
          {running ? (
            <span className="stream-tool-spinner shrink-0" aria-hidden />
          ) : (
            <Icon size={14} className="text-emerald-400 shrink-0" />
          )}
          <span className="font-mono font-medium text-brand-300">{tool}</span>
          {preview && (
            <span className="truncate text-slate-500 font-mono text-[10px] ml-1 flex-1 min-w-0">{preview}</span>
          )}
          <span className={`text-[10px] shrink-0 ${running ? 'text-amber-400' : 'text-emerald-500'}`}>
            {statusLabel}
          </span>
        </>
      )}
    >
      <div className="space-y-2">
        {/* Never dump raw tool JSON args on mobile/chat — header preview is enough. */}
        {running && !resultText && (
          <p className="text-[10px] text-amber-400/80">Exécution…</p>
        )}
        {resultText && (
          richResult ? (
            <div className="rich-content-stack">
              <StreamingMarkdown
                text={resultText}
                conversation={conversation}
                workspaceCwd={workspaceCwd}
              />
            </div>
          ) : (
            <CodePanel title="Résultat" text={resultText} />
          )
        )}
      </div>
    </ZoneShell>
  );
}

function LogBlock({ block }) {
  if (!block.text) return null;

  return (
    <ZoneShell
      tone="log"
      live={false}
      header={(
        <>
          <ScrollText size={14} className="text-slate-400 shrink-0" />
          <span className="font-medium text-slate-300">Log</span>
        </>
      )}
    >
      <CodePanel text={block.text} language="bash" />
    </ZoneShell>
  );
}

function AssistantBlock({
  block,
  run,
  onReplaySpeech,
  onToggleVoicePause,
  onStopSpeech,
  activeReplayId = '',
  voicePlaying = false,
  voicePaused = false,
  voiceConfigured = false,
  voicePlaybackOn = false,
  karaokeOn = false,
  karaokeWords = [],
  karaokeIndex = -1,
  karaokeGrain = 'word',
  isLiveKaraokeTarget = false,
  stripAckLead = false,
  conversation = '',
  workspaceCwd = '',
  timelinePagination = false,
}) {
  const streaming = Boolean(block.streaming) && isRunActive(run);
  const displayText = stripAckLead
    ? stripLeadingVoiceAck(block.text || '')
    : (block.text || '');
  if (!displayText && !streaming) return null;

  const replayId = `assistant:${block.id}`;
  const isReplayActive = activeReplayId === replayId && voicePlaying;
  const showInlineKaraoke = Boolean(
    voicePlaybackOn
    && karaokeOn
    && voicePlaying
    && karaokeWords.length > 0
    && (isReplayActive || (!activeReplayId && isLiveKaraokeTarget)),
  );
  const isActive = isReplayActive || (voicePlaying && !activeReplayId && isLiveKaraokeTarget);
  const showPause = isActive && !voicePaused;
  const canReplay = voiceConfigured && Boolean(displayText?.trim()) && !streaming;
  const copyText = stripEmotionTagsForDisplay(displayText);

  return (
    <div className={`zone-sunk rounded-2xl px-4 py-3 text-sm text-emerald-50 border group ${
      streaming
        ? 'border-emerald-400/40'
        : isActive
          ? 'border-emerald-400/50 ring-1 ring-emerald-500/20'
          : 'border-emerald-500/25'
    }`}>
      <div className="rich-content-stack min-w-0">
        <StreamingMarkdown
          text={displayText}
          streaming={streaming}
          conversation={conversation}
          workspaceCwd={workspaceCwd}
          karaoke={showInlineKaraoke
            ? { enabled: true, words: karaokeWords, activeIndex: karaokeIndex, grain: karaokeGrain }
            : null}
        />
      </div>
      {(canReplay || copyText) && (
        <ResponseActionBar>
          <CopyCodeButton
            text={copyText}
            label="Copier la réponse"
            iconOnly
            className="border border-white/10 bg-white/5 hover:bg-white/10 rounded-lg"
          />
          {canReplay && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (isActive) {
                    onToggleVoicePause?.();
                    return;
                  }
                  onReplaySpeech?.(displayText, { id: replayId });
                }}
                className={`p-1.5 rounded-lg border transition cursor-pointer ${
                  isActive
                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:border-white/20'
                }`}
                title={showPause ? 'Pause' : (isActive && voicePaused ? 'Reprendre' : 'Lire')}
                aria-label={showPause ? 'Pause' : (isActive && voicePaused ? 'Reprendre' : 'Lire la réponse')}
              >
                {showPause ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
              </button>
              {isActive && (
                <button
                  type="button"
                  onClick={() => onStopSpeech?.()}
                  className="p-1.5 rounded-lg border border-red-500/30 bg-red-950/30 text-red-200 hover:bg-red-900/40 transition cursor-pointer"
                  title="Stop"
                  aria-label="Arrêter la lecture"
                >
                  <Square size={12} className="fill-current" />
                </button>
              )}
            </>
          )}
        </ResponseActionBar>
      )}
    </div>
  );
}

/** Prefer admin agent name; Cursor "Auto"/default → that name. */
function displayRunLabel(model, agentName) {
  const name = String(agentName || 'Zephir').trim() || 'Zephir';
  const m = String(model || '').trim();
  if (!m || /^(auto|default|\(default\))$/i.test(m)) return name;
  if (/composer-2\.5-fast/i.test(m)) return `${name} · Fast`;
  if (/composer-2\.5$/i.test(m)) return `${name} · Composer`;
  return `${name} · ${m}`;
}

function RunCard({
  run,
  filters,
  onReplaySpeech,
  onToggleVoicePause,
  onStopSpeech,
  activeReplayId,
  voicePlaying,
  voicePaused,
  voiceConfigured,
  voicePlaybackOn = false,
  karaokeOn,
  karaokeWords,
  karaokeIndex,
  karaokeGrain,
  liveKaraokeBlockId,
  stripAckLead = false,
  conversation = '',
  workspaceCwd = '',
  timelinePagination = false,
}) {
  const { agentName } = useSettings();
  const { t } = useLocale();
  const closed = run.status === 'done' || run.status === 'aborted';
  // Hide empty Composer outline — but always show briefing (prime) runs.
  if (closed && isEmptyRunShell(run) && !run.prime) return null;

  // Render-time close: never keep a live terminal/tool spinner on a finished run.
  const blocks = closed
    ? (run.blocks || []).map((b) => {
      if (b.type === 'tool' && b.status !== 'done' && b.status !== 'error') {
        return { ...b, status: 'done', streaming: false };
      }
      if (b.streaming) return { ...b, streaming: false };
      return b;
    })
    : (run.blocks || []);
  const running = run.status === 'running';
  const active = isRunActive({ ...run, blocks });
  const modelLabel = run.prime
    ? `${String(agentName || 'Zephir').trim() || 'Zephir'} · ${t('timeline.presentation')}`
    : displayRunLabel(run.model, agentName);

  const renderBlocks = blocks;
  const agentLabel = String(agentName || 'Zephir').trim() || 'Zephir';

  // Briefing / prime: hide CLI noise (terminal, tools, logs) — greeting only.
  if (run.prime) {
    const assistantBlocks = renderBlocks.filter((b) => b.type === 'assistant');
    const hasGreeting = assistantBlocks.some(
      (b) => Boolean(b.streaming) || String(b.text || '').trim(),
    );
    const showPresentationWait = running && !hasGreeting;

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 px-1">
          <Bot size={12} className="text-brand-400 shrink-0" />
          <span className="text-slate-400 normal-case font-mono">
            {agentLabel} · {t('timeline.presentation')}
          </span>
          {showPresentationWait && (
            <span className="text-amber-400 normal-case tracking-normal">{t('timeline.running')}</span>
          )}
          {!showPresentationWait && run.status === 'done' && (
            <span className="text-emerald-500/90 normal-case tracking-normal">{t('timeline.done')}</span>
          )}
          {run.status === 'aborted' && (
            <span className="text-red-400 normal-case tracking-normal">⏹</span>
          )}
        </div>

        <div className="space-y-2 pl-1 border-l-2 border-amber-500/25 ml-1">
          {showPresentationWait && (
            <PresentationWait
              title={t('timeline.presentationPreparing').replace('{agent}', agentLabel)}
              hint={t('timeline.presentationCanType')}
            />
          )}
          {assistantBlocks.map((block) => (
            <AssistantBlock
              key={block.id}
              block={block}
              run={run}
              onReplaySpeech={onReplaySpeech}
              onToggleVoicePause={onToggleVoicePause}
              onStopSpeech={onStopSpeech}
              activeReplayId={activeReplayId}
              voicePlaying={voicePlaying}
              voicePaused={voicePaused}
              voiceConfigured={voiceConfigured}
              voicePlaybackOn={voicePlaybackOn}
              karaokeOn={karaokeOn}
              karaokeWords={karaokeWords}
              karaokeIndex={karaokeIndex}
              karaokeGrain={karaokeGrain}
              isLiveKaraokeTarget={liveKaraokeBlockId === block.id}
              stripAckLead={stripAckLead}
              conversation={conversation}
              workspaceCwd={workspaceCwd}
            />
          ))}
        </div>
      </div>
    );
  }

  // Compact wait state — no empty answer card outline.
  if (running && isEmptyRunShell(run)) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 px-1">
          <Bot size={12} className="text-brand-400 shrink-0" />
          <span className="text-slate-400 normal-case font-mono">{modelLabel}</span>
          <span className="text-emerald-400 normal-case tracking-normal">{t('timeline.running')}</span>
        </div>
        <TypingIndicator label={`${String(agentName || 'Zephir').trim() || 'Zephir'}…`} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 px-1">
        <Bot size={12} className="text-brand-400 shrink-0" />
        <span className="text-slate-400 normal-case font-mono" title={run.model || agentName}>
          {modelLabel}
        </span>
        {running && active && <span className="text-emerald-400 normal-case tracking-normal">{t('timeline.running')}</span>}
        {run.status === 'done' && <span className="text-emerald-500/90 normal-case tracking-normal">{t('timeline.done')}</span>}
        {run.status === 'aborted' && <span className="text-red-400 normal-case tracking-normal">⏹</span>}
      </div>

      <div className="space-y-2 pl-1 border-l-2 border-white/5 ml-1">
        {renderBlocks.map((block) => {
          if (block.type === 'shell_summary') {
            return (
              <ActivityHint
                key={block.id}
                icon={Terminal}
                label={t('timeline.shellsDone').replace('{count}', String(block.count))}
                tone="done"
                live={false}
              />
            );
          }
          if (block.type === 'thinking') {
            // Prime greeting: hide internal model reflection (often English).
            if (run.prime) return null;
            if (!filters.thinking) {
              // Hidden filter: keep a live cue without showing the reflection text
              if (running && block.streaming) {
                return (
                  <ActivityHint
                    key={block.id}
                    icon={Brain}
                    label="En réflexion…"
                    tone="thinking"
                  />
                );
              }
              return null;
            }
            return <ThinkingBlock key={block.id} block={block} conversation={conversation} workspaceCwd={workspaceCwd} />;
          }
          if (block.type === 'tool') {
            const isShell = isShellTool(block.tool, block.input);
            const filterOn = isShell ? filters.terminal : filters.tools;
            const tool = normalizeToolName(block.tool);
            const Icon = isShell ? Terminal : (TOOL_ICONS[tool] || Wrench);
            // Never keep a live spinner after the run closed (even if tool_complete was missed).
            const toolLive = running && block.status === 'running';

            if (!filterOn) {
              // Live cue only — finished tools stay hidden (no wall of “Terminal terminé”).
              if (toolLive) {
                return (
                  <ActivityHint
                    key={block.id}
                    icon={Icon}
                    label={isShell
                      ? t('timeline.shellRunning')
                      : t('timeline.toolRunning').replace('{tool}', tool || 'tool')}
                    tone={isShell ? 'terminal' : 'tool'}
                    live
                  />
                );
              }
              return null;
            }
            return (
              <ToolBlock
                key={block.id}
                block={block}
                runStatus={toolLive ? 'running' : 'done'}
                conversation={conversation}
                workspaceCwd={workspaceCwd}
              />
            );
          }
          if (block.type === 'assistant') {
            return (
              <AssistantBlock
                key={block.id}
                block={block}
                run={run}
                onReplaySpeech={onReplaySpeech}
                onToggleVoicePause={onToggleVoicePause}
                onStopSpeech={onStopSpeech}
                activeReplayId={activeReplayId}
                voicePlaying={voicePlaying}
                voicePaused={voicePaused}
                voiceConfigured={voiceConfigured}
                voicePlaybackOn={voicePlaybackOn}
                karaokeOn={karaokeOn}
                karaokeWords={karaokeWords}
                karaokeIndex={karaokeIndex}
                karaokeGrain={karaokeGrain}
                isLiveKaraokeTarget={liveKaraokeBlockId === block.id}
                stripAckLead={stripAckLead || Boolean(run.voiceTurn)}
                conversation={conversation}
                workspaceCwd={workspaceCwd}
              />
            );
          }
          if (block.type === 'log') {
            const showPrimeLog = run.prime && !run.blocks?.some((b) => b.type === 'assistant' && b.text);
            if (!filters.logs && !showPrimeLog) return null;
            return <LogBlock key={block.id} block={block} />;
          }
          if (block.type === 'system' && block.text) {
            return (
              <ZoneShell
                key={block.id}
                tone="system"
                live={false}
                header={<span className="text-red-300 font-medium">Système</span>}
              >
                <CodePanel text={block.text} />
              </ZoneShell>
            );
          }
          return null;
        })}
        <RunOutcomeHint run={run} blocks={renderBlocks} t={t} />
        {running && run.blocks.length === 0 && (
          <TypingIndicator label="Connexion à cursor-agent…" />
        )}
      </div>
    </div>
  );
}

function RunTimeline({
  items,
  filters = DEFAULT_VIEW_FILTERS,
  editable = false,
  onEditHuman,
  onReplaySpeech,
  onToggleVoicePause,
  onStopSpeech,
  activeReplayId,
  voicePlaying,
  voicePaused,
  voiceConfigured,
  voicePlaybackOn = false,
  karaokeOn = false,
  karaokeWords = [],
  karaokeIndex = -1,
  karaokeGrain = 'word',
  conversation = '',
  workspaceCwd = '',
  timelinePagination = false,
}) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(() => loadTimelineShowAll());

  const { visible, hiddenExchanges } = sliceRecentExchanges(items, RECENT_EXCHANGES_LIMIT);
  const displayItems = timelinePagination
    ? (showAll ? (items || []) : visible)
    : (items || []);
  const canCollapse = timelinePagination && hiddenExchanges > 0;

  const liveKaraokeBlockId = resolveLiveKaraokeBlockId(items);

  const toggleExpand = () => {
    setShowAll((prev) => {
      const next = !prev;
      saveTimelineShowAll(next);
      return next;
    });
  };

  if (!items?.length) {
    return (
      <p className="text-center text-slate-500 text-sm py-12">
        Envoie un prompt — réflexion, outils et réponse s&apos;affichent ici.
      </p>
    );
  }

  return (
    <div className="space-y-4 min-w-0 w-full max-w-full">
      {canCollapse && (
        <div className="flex justify-center sticky top-0 z-10 py-1">
          <button
            type="button"
            onClick={toggleExpand}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border border-white/10 bg-[#111827]/95 text-slate-400 hover:text-white hover:border-brand-500/35 hover:bg-brand-600/10 transition cursor-pointer backdrop-blur-md shadow-lg"
          >
            {showAll ? (
              <>
                <ChevronUp size={13} />
                {t('timeline.collapse').replace('{count}', String(RECENT_EXCHANGES_LIMIT))}
              </>
            ) : (
              <>
                <ChevronDown size={13} />
                {t('timeline.showAll').replace('{count}', String(hiddenExchanges))}
              </>
            )}
          </button>
        </div>
      )}
      {displayItems.map((item, index) => {
        if (item.type === 'human') {
          return (
            <HumanBubble
              key={item.id}
              item={item}
              editable={editable}
              onEdit={onEditHuman}
            />
          );
        }
        if (item.type === 'voice_ack') {
          return (
            <VoiceAckBubble
              key={item.id}
              item={item}
              onReplaySpeech={onReplaySpeech}
              onToggleVoicePause={onToggleVoicePause}
              onStopSpeech={onStopSpeech}
              activeReplayId={activeReplayId}
              voicePlaying={voicePlaying}
              voicePaused={voicePaused}
              voiceConfigured={voiceConfigured}
            />
          );
        }
        if (item.type === 'system') {
          return <SystemBubble key={item.id} text={item.text} />;
        }
        if (item.type === 'run') {
          const prev = displayItems[index - 1];
          const stripAckLead = prev?.type === 'voice_ack' || Boolean(item.voiceTurn);
          return (
            <RunCard
              key={item.id}
              run={item}
              filters={filters}
              onReplaySpeech={onReplaySpeech}
              onToggleVoicePause={onToggleVoicePause}
              onStopSpeech={onStopSpeech}
              activeReplayId={activeReplayId}
              voicePlaying={voicePlaying}
              voicePaused={voicePaused}
              voiceConfigured={voiceConfigured}
              voicePlaybackOn={voicePlaybackOn}
              karaokeOn={karaokeOn}
              karaokeWords={karaokeWords}
              karaokeIndex={karaokeIndex}
              karaokeGrain={karaokeGrain}
              liveKaraokeBlockId={liveKaraokeBlockId}
              stripAckLead={stripAckLead}
              conversation={conversation}
              workspaceCwd={workspaceCwd}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

/**
 * Memoized: the timeline renders markdown (StreamingMarkdown) for each block.
 * Without this, every keypress in the composer — which lives in Dashboard — rebuilds
 * the entire history, making input unusable on mobile.
 */
export default memo(RunTimeline);
