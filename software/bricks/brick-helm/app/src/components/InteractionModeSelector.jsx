import { useEffect, useRef, useState } from 'react';
import { Car, Check, Eye, Radio } from 'lucide-react';
import { INTERACTION_MODES } from '../lib/interactionMode.js';
import { useLocale } from '../context/LocaleContext.jsx';

const ICONS = {
  route: Car,
  view: Eye,
  remote: Radio,
};

export default function InteractionModeSelector({ value, onChange }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const mode = INTERACTION_MODES.includes(value) ? value : 'view';
  const CurrentIcon = ICONS[mode];

  useEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return undefined;
    }
    const place = () => {
      const el = btnRef.current || rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 16);
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      if (left < 8) left = 8;
      const height = 220;
      let top = r.bottom + 6;
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, r.top - height - 6);
      }
      setPanelStyle({
        position: 'fixed',
        top,
        left,
        width,
        zIndex: 80,
      });
    };
    place();
    const onPointer = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-center gap-0 h-9 w-9 rounded-xl border px-0 transition cursor-pointer ${
          open
            ? 'border-emerald-400/40 bg-white/10 text-white ring-2 ring-emerald-400/20'
            : 'border-white/10 bg-black/30 text-slate-100 hover:bg-white/10 hover:border-white/20'
        }`}
        aria-label={t('mode.title')}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CurrentIcon size={18} className="text-emerald-300 shrink-0" />
        <span className="sr-only">{t(`mode.${mode}`)}</span>

      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t('mode.title')}
          style={panelStyle || { position: 'fixed', visibility: 'hidden', top: 0, left: 0 }}
          className="max-h-[min(70dvh,22rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#0b1220]/98 backdrop-blur-xl shadow-2xl shadow-black/50 p-1.5"
        >
          {INTERACTION_MODES.map((id) => {
            const Icon = ICONS[id];
            const active = mode === id;
            return (
              <li key={id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange?.(id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition cursor-pointer ${
                    active
                      ? 'bg-emerald-500/15 text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon size={16} className={`mt-0.5 shrink-0 ${active ? 'text-emerald-300' : 'text-slate-400'}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">{t(`mode.${id}`)}</span>
                    <span className="block text-[11px] text-slate-500 leading-snug">{t(`mode.${id}Hint`)}</span>
                  </span>
                  {active && <Check size={14} className="text-emerald-300 shrink-0 mt-0.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
