import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Brain, ChevronLeft, ChevronRight, Copy, HelpCircle, Languages, Mic2, MoreVertical,
  ScrollText, Send, Terminal, Volume2, Wrench, X,
} from 'lucide-react';
import { useLocale } from '../context/LocaleContext.jsx';

/** card: where the guide panel sits so it does not cover the spotlight target. */
const STEPS = [
  { id: 'welcome', Icon: HelpCircle, target: 'help-chat-viewport', pad: 8, card: 'bottom-right' },
  { id: 'lang', Icon: Languages, target: 'help-lang', pad: 8, card: 'bottom-left' },
  { id: 'options', Icon: MoreVertical, target: 'help-cli-model', pad: 6, openOptions: true, card: 'top-left' },
  { id: 'thinking', Icon: Brain, target: 'help-zone-thinking', pad: 6, openOptions: true, card: 'top-left' },
  { id: 'tools', Icon: Wrench, target: 'help-zone-tools', pad: 6, openOptions: true, card: 'top-left' },
  { id: 'terminal', Icon: Terminal, target: 'help-zone-terminal', pad: 6, openOptions: true, card: 'top-left' },
  { id: 'logs', Icon: ScrollText, target: 'help-zone-logs', pad: 6, openOptions: true, card: 'top-left' },
  { id: 'actions', Icon: Copy, target: 'help-actions', pad: 6, openOptions: true, card: 'top-left' },
  { id: 'voiceAudio', Icon: Volume2, target: 'help-voice-audio', pad: 8, card: 'top-left' },
  { id: 'voiceMic', Icon: Mic2, target: 'help-voice-mic', pad: 8, card: 'top-left' },
  { id: 'voiceGo', Icon: Send, target: 'help-voice-send', pad: 8, card: 'top-left' },
];

const CARD_POS = {
  'bottom-right': 'left-3 right-3 bottom-3 sm:left-auto sm:right-4 sm:bottom-4',
  'bottom-left': 'left-3 right-3 bottom-3 sm:right-auto sm:left-4 sm:bottom-4',
  'top-right': 'left-3 right-3 top-16 sm:left-auto sm:right-4 sm:top-16 sm:bottom-auto',
  'top-left': 'left-3 right-3 top-16 sm:right-auto sm:left-4 sm:top-16 sm:bottom-auto',
};

const ACCENT = {
  welcome: '#38bdf8',
  lang: '#818cf8',
  options: '#e2e8f0',
  thinking: '#a78bfa',
  tools: '#fbbf24',
  terminal: '#34d399',
  logs: '#94a3b8',
  actions: '#fb923c',
  voiceAudio: '#38bdf8',
  voiceMic: '#f87171',
  voiceGo: '#2dd4bf',
};

/** Visible on-screen rect only — avoids highlighting off-screen message stack. */
function measureTarget(selector, pad = 8) {
  const el = document.querySelector(`[data-help-target="${selector}"]`);
  if (!el) return null;

  const r = el.getBoundingClientRect();
  const vPad = 8;
  const top = Math.max(r.top, vPad);
  const left = Math.max(r.left, vPad);
  const right = Math.min(r.right, window.innerWidth - vPad);
  const bottom = Math.min(r.bottom, window.innerHeight - vPad);
  const width = right - left;
  const height = bottom - top;
  if (width < 4 || height < 4) return null;

  return {
    top: top - pad,
    left: left - pad,
    width: width + pad * 2,
    height: height + pad * 2,
  };
}

/** Scroll target into the options menu (or nearest overflow parent). */
function scrollHelpTargetIntoView(selector) {
  const el = document.querySelector(`[data-help-target="${selector}"]`);
  if (!el) return false;

  const menu = el.closest('[data-help-scroll="options-menu"]')
    || document.querySelector('[data-help-scroll="options-menu"]');

  if (menu && menu.contains(el)) {
    // Actions sit at the bottom of the options panel — always scroll them into view.
    if (selector === 'help-actions' || selector.startsWith('help-action-')) {
      menu.scrollTop = menu.scrollHeight;
      return true;
    }
    const menuRect = menu.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const pad = 12;
    let delta = 0;
    if (elRect.bottom > menuRect.bottom - pad) {
      delta = elRect.bottom - (menuRect.bottom - pad);
    } else if (elRect.top < menuRect.top + pad) {
      delta = elRect.top - (menuRect.top + pad);
    }
    if (delta !== 0) {
      menu.scrollTop += delta;
      return true;
    }
    return false;
  }

  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  } catch {
    el.scrollIntoView(false);
  }
  return true;
}

/** Prefer corners opposite the spotlight so the card never covers the target. */
function pickCardCorner(hole, preferred) {
  if (!hole) return preferred || 'bottom-right';
  const cx = hole.left + hole.width / 2;
  const cy = hole.top + hole.height / 2;
  const onRight = cx > window.innerWidth * 0.42;
  const onBottom = cy > window.innerHeight * 0.38;
  if (onRight && onBottom) return 'top-left';
  if (onRight && !onBottom) return 'bottom-left';
  if (!onRight && onBottom) return 'top-right';
  return 'bottom-right';
}

/**
 * Console tour — light dim + thin ring on the correct UI zone.
 * Card position is chosen opposite the spotlight so it never hides the target.
 */
export default function ConsoleHelpOverlay({ open, onClose, onForceOptionsOpen }) {
  const { t } = useLocale();
  const [step, setStep] = useState(0);
  const [hole, setHole] = useState(null);
  const [cardCorner, setCardCorner] = useState('bottom-right');
  const onCloseRef = useRef(onClose);
  const onForceOptionsOpenRef = useRef(onForceOptionsOpen);
  const wasOpenRef = useRef(false);

  onCloseRef.current = onClose;
  onForceOptionsOpenRef.current = onForceOptionsOpen;

  const current = STEPS[step] || STEPS[0];

  const refreshHole = useCallback(() => {
    const next = STEPS[step];
    if (!next) return;
    scrollHelpTargetIntoView(next.target);
    const measured = measureTarget(next.target, next.pad);
    setHole(measured);
    setCardCorner(pickCardCorner(measured, next.card));
  }, [step]);

  // Reset to step 0 only when the tour opens — not when parent re-renders
  // (onClose / forceOptions change each time the options menu toggles).
  useEffect(() => {
    if (open && !wasOpenRef.current) setStep(0);
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
      if (e.key === 'ArrowRight') setStep((s) => Math.min(STEPS.length - 1, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      onForceOptionsOpenRef.current?.(false);
      setHole(null);
      return undefined;
    }
    const next = STEPS[step];
    onForceOptionsOpenRef.current?.(Boolean(next?.openOptions));
    const timers = [50, 150, 320, 500].map((ms) => setTimeout(refreshHole, ms));
    const onResize = () => refreshHole();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, step, refreshHole]);

  if (!open) return null;

  const Icon = current.Icon;
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;
  const accent = ACCENT[current.id] || '#38bdf8';
  const cardPos = CARD_POS[cardCorner] || CARD_POS['bottom-right'];

  return (
    <div className="fixed inset-0 z-[70] pointer-events-none" role="presentation">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
        <defs>
          <mask id="help-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole && (
              <rect
                x={hole.left}
                y={hole.top}
                width={hole.width}
                height={hole.height}
                rx="10"
                ry="10"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(2,6,23,0.38)"
          mask="url(#help-spotlight-mask)"
        />
      </svg>

      {hole && (
        <div
          className="pointer-events-none absolute z-[71] rounded-[10px]"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: `0 0 0 2px ${accent}`,
          }}
        />
      )}

      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="console-help-title"
        className={`pointer-events-auto fixed z-[72] sm:w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-[#0b1220]/98 shadow-2xl overflow-hidden transition-[top,bottom,left,right] duration-200 ${cardPos}`}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <span className="inline-flex p-1.5 rounded-lg bg-white/5 border border-white/10" style={{ color: accent }}>
            <HelpCircle size={14} />
          </span>
          <h2 id="console-help-title" className="text-sm font-semibold text-white flex-1 truncate">
            {t('help.title')}
          </h2>
          <span className="text-[10px] tabular-nums text-slate-500 shrink-0">
            {step + 1}/{STEPS.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
            aria-label={t('help.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2">
          <div className="inline-flex p-2 rounded-lg bg-white/5 border border-white/10 mb-2" style={{ color: accent }}>
            <Icon size={18} />
          </div>
          <h3 className="text-sm font-semibold text-white mb-1.5">
            {t(`help.step.${current.id}.title`)}
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            {t(`help.step.${current.id}.body`)}
          </p>
        </div>

        <div className="px-4 pb-1.5 flex justify-center gap-1.5" aria-hidden="true">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(i)}
              className={`h-1.5 rounded-full transition cursor-pointer ${
                i === step ? 'w-5' : 'w-1.5 bg-white/20 hover:bg-white/35'
              }`}
              style={i === step ? { background: accent } : undefined}
              aria-label={`${i + 1}`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-white/10 bg-black/20">
          <button
            type="button"
            disabled={isFirst}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 border border-white/10 hover:bg-white/5 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} />
            {t('help.prev')}
          </button>
          <div className="flex-1" />
          {isLast ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-950 cursor-pointer"
              style={{ background: accent }}
            >
              {t('help.done')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-950 cursor-pointer"
              style={{ background: accent }}
            >
              {t('help.next')}
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Header help trigger — same visual weight as language menu. */
export function ConsoleHelpButton({ onClick, onDismiss, highlight = false }) {
  const { t } = useLocale();
  return (
    <div className="relative shrink-0">
      {highlight && (
        <div
          className="help-nudge-tooltip absolute -bottom-9 right-0 z-50 flex items-center gap-1 rounded-lg border border-sky-400/40 bg-sky-950/95 py-1 pl-2.5 pr-1 text-[10px] font-medium text-sky-100 shadow-lg shadow-sky-500/20"
          role="status"
        >
          <span className="whitespace-nowrap">{t('help.nudge')}</span>
          {typeof onDismiss === 'function' && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDismiss();
              }}
              className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-sky-200/80 hover:bg-sky-400/15 hover:text-white transition cursor-pointer"
              aria-label={t('help.nudgeDismiss')}
              title={t('help.nudgeDismiss')}
            >
              <X size={12} />
            </button>
          )}
          <span
            className="pointer-events-none absolute -top-1 right-3 h-2 w-2 rotate-45 border-l border-t border-sky-400/40 bg-sky-950/95"
            aria-hidden="true"
          />
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center justify-center rounded-lg border p-1.5 transition cursor-pointer ${
          highlight
            ? 'help-nudge-btn'
            : 'border-white/10 bg-black/25 text-slate-300 hover:bg-white/10 hover:text-white'
        }`}
        aria-label={t('help.open')}
        title={highlight ? t('help.nudge') : t('help.open')}
        data-help-target="help-helpbtn"
      >
        <HelpCircle size={15} />
      </button>
    </div>
  );
}
