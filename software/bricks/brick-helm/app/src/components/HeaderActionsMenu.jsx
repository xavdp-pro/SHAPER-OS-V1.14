import { useEffect, useRef, useState } from 'react';
import {
  Brain, Copy, MessageSquare, Mic2, MoreVertical, RefreshCw, RotateCcw, ScrollText, Square, Terminal, Wrench,
} from 'lucide-react';
import { FILTER_LABELS } from '../lib/viewFilters.js';
import AgentPluginToggle from './AgentPluginToggle.jsx';
import ComposerModeToggle from './ComposerModeToggle.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';

const FILTER_ITEMS = [
  { key: 'thinking', Icon: Brain, onClass: 'text-violet-400' },
  { key: 'tools', Icon: Wrench, onClass: 'text-amber-400' },
  { key: 'terminal', Icon: Terminal, onClass: 'text-emerald-400' },
  { key: 'logs', Icon: ScrollText, onClass: 'text-slate-300' },
];

function Section({ title, children }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 px-0.5">{title}</p>
      <div className="zone-sunk rounded-lg p-1.5 border border-white/5">
        {children}
      </div>
    </div>
  );
}

export default function HeaderActionsMenu({
  filters,
  onToggleFilter,
  onCopy,
  onStop,
  onClear,
  onRefresh,
  copying = false,
  stopping = false,
  agentBusy = false,
  canClear = false,
  polling = false,
  copyDisabled = false,
  karaokeOn = false,
  karaokeSupported = false,
  karaokeGrain = 'word',
  onToggleKaraoke,
  timelinePagination = false,
  onToggleTimelinePagination,
  cursorPure = false,
  onToggleCursorPure,
  forceOpen = false,
}) {
  const { t } = useLocale();
  const { activePlugins = [] } = useSettings();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  const menuOpen = forceOpen || open;

  useEffect(() => {
    if (forceOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [forceOpen]);

  const showCliPicker = activePlugins.length > 1;

  const zoneLabels = {
    zones: t('filter.zones'),
    hide: t('filter.hide'),
    show: t('filter.show'),
    thinking: t('filter.thinking'),
    tools: t('filter.tools'),
    terminal: t('filter.terminal'),
    logs: t('filter.logs'),
  };

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        title={t('options.title')}
        className={`h-9 w-9 rounded-lg border flex items-center justify-center transition cursor-pointer shrink-0 ${
          menuOpen
            ? 'bg-white/15 text-white border-white/25 ring-2 ring-violet-400/30'
            : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:text-white'
        }`}
        data-help-target="help-options"
      >
        <MoreVertical size={18} />
      </button>

      {menuOpen && (
        <div
          className={`absolute right-0 top-full mt-1 w-[min(18.5rem,calc(100vw-1rem))] max-h-[min(75dvh,32rem)] overflow-y-auto overscroll-contain theme-scrollbar rounded-xl border border-white/10 bg-[#0f172a] shadow-2xl p-3 space-y-3 ${
            forceOpen ? 'z-[72] pointer-events-none' : 'z-50'
          }`}
          role="dialog"
          aria-label={t('options.title')}
          data-help-scroll="options-menu"
        >
          <div data-help-target="help-cli-model" className="space-y-3">
            {showCliPicker && (
              <Section title={t('options.cli')}>
                <AgentPluginToggle menu />
              </Section>
            )}

            <Section title={t('options.model')}>
              <ComposerModeToggle menu />
            </Section>
          </div>

          {typeof onToggleTimelinePagination === 'function' && (
            <Section title={t('options.experience')}>
              <button
                type="button"
                onClick={() => onToggleTimelinePagination()}
                className={`w-full flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-xs border transition cursor-pointer ${
                  timelinePagination
                    ? 'text-violet-300 bg-violet-500/15 border-violet-400/30'
                    : 'text-slate-400 border-transparent hover:bg-white/5'
                }`}
                aria-pressed={timelinePagination}
                title={timelinePagination ? t('options.timelinePaginationOnHint') : t('options.timelinePaginationOffHint')}
              >
                <ScrollText size={14} className="shrink-0" />
                {t('options.timelinePagination')}
                <span className={`ml-auto text-[10px] uppercase tracking-wide ${
                  timelinePagination ? 'text-violet-400' : 'text-slate-500'
                }`}
                >
                  {timelinePagination ? t('options.on') : t('options.off')}
                </span>
              </button>
            </Section>
          )}

          {typeof onToggleCursorPure === 'function' && (
            <Section title={t('options.experience')}>
              <button
                type="button"
                onClick={() => onToggleCursorPure()}
                className={`w-full flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-xs border transition cursor-pointer ${
                  cursorPure
                    ? 'text-sky-300 bg-sky-500/15 border-sky-400/30'
                    : 'text-slate-400 border-transparent hover:bg-white/5'
                }`}
                aria-pressed={cursorPure}
                title={cursorPure ? t('options.cursorPureOnHint') : t('options.cursorPureOffHint')}
              >
                <MessageSquare size={14} className="shrink-0" />
                {t('options.cursorPure')}
                <span className={`ml-auto text-[10px] uppercase tracking-wide ${
                  cursorPure ? 'text-sky-400' : 'text-slate-500'
                }`}
                >
                  {cursorPure ? t('options.on') : t('options.off')}
                </span>
              </button>
            </Section>
          )}

          <Section title={t('filter.zones')}>
            <div className="grid grid-cols-2 gap-1" role="group" aria-label={zoneLabels.zones}>
              {FILTER_ITEMS.map(({ key, Icon, onClass }) => {
                const on = filters[key];
                const label = zoneLabels[key] || FILTER_LABELS[key];
                return (
                  <button
                    key={key}
                    type="button"
                    data-help-target={`help-zone-${key}`}
                    onClick={() => onToggleFilter(key)}
                    className={`flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-xs border transition cursor-pointer ${
                      on
                        ? `${onClass} bg-white/10 border-white/15`
                        : 'text-slate-500 opacity-60 border-transparent hover:bg-white/5'
                    }`}
                    title={`${label} — ${on ? zoneLabels.hide : zoneLabels.show}`}
                    aria-pressed={on}
                  >
                    <Icon size={14} className="shrink-0" />
                    {label}
                  </button>
                );
              })}
            </div>
          </Section>

          {karaokeSupported && typeof onToggleKaraoke === 'function' && (
            <Section title={t('options.voice')}>
              <button
                type="button"
                onClick={() => onToggleKaraoke()}
                className={`w-full flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-xs border transition cursor-pointer ${
                  karaokeOn
                    ? 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30'
                    : 'text-slate-400 border-transparent hover:bg-white/5'
                }`}
                aria-pressed={karaokeOn}
                title={karaokeOn
                  ? (karaokeGrain === 'sentence' ? t('karaoke.onHintSentence') : t('karaoke.onHint'))
                  : t('karaoke.offHint')}
              >
                <Mic2 size={14} className="shrink-0" />
                {t('karaoke.label')}
                <span className={`ml-auto text-[10px] uppercase tracking-wide ${
                  karaokeOn ? 'text-emerald-400' : 'text-slate-500'
                }`}
                >
                  {karaokeOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </Section>
          )}

          <div className="zone-sunk-divider" role="separator" aria-hidden="true" />

          <div
            data-help-target="help-actions"
            className="zone-sunk rounded-lg p-1.5 border border-white/5 grid grid-cols-2 gap-1"
          >
            <button
              type="button"
              data-help-target="help-action-copy"
              onClick={() => { onCopy(); setOpen(false); }}
              disabled={copyDisabled}
              className="flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <Copy size={14} className={copying ? 'animate-pulse' : ''} /> {t('options.copy')}
            </button>
            <button
              type="button"
              data-help-target="help-action-stop"
              onClick={() => { onStop(); setOpen(false); }}
              disabled={stopping || !agentBusy}
              className="flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-xs text-red-300 hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <Square size={14} className="fill-current" /> Stop
            </button>
            <button
              type="button"
              data-help-target="help-action-clear"
              onClick={() => { onClear(); setOpen(false); }}
              disabled={!canClear}
              className="flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <RotateCcw size={14} /> {t('options.clear')}
            </button>
            <button
              type="button"
              data-help-target="help-action-reload"
              onClick={() => { onRefresh(); setOpen(false); }}
              disabled={polling}
              className="flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={polling ? 'animate-spin' : ''} /> {t('options.reload')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
