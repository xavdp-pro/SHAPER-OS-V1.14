import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { LOCALE_FLAGS, LOCALES } from '../lib/locale.js';
import { useLocale } from '../context/LocaleContext.jsx';

function FlagFr({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#fff" />
      <rect width="8" height="24" fill="#0055A4" />
      <rect x="16" width="8" height="24" fill="#EF4135" />
    </svg>
  );
}

function FlagEs({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#C60B1E" />
      <rect y="6" width="24" height="12" fill="#FFC400" />
    </svg>
  );
}

function FlagGb({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#012169" />
      <path d="M0 0 L24 24 M24 0 L0 24" stroke="#fff" strokeWidth="5" />
      <path d="M0 0 L24 24 M24 0 L0 24" stroke="#C8102E" strokeWidth="2.2" />
      <path d="M12 0 V24 M0 12 H24" stroke="#fff" strokeWidth="7" />
      <path d="M12 0 V24 M0 12 H24" stroke="#C8102E" strokeWidth="4" />
    </svg>
  );
}

const FLAG_SVG = { fr: FlagFr, es: FlagEs, en: FlagGb };

function FlagMark({ code, className = 'w-6 h-6 rounded-md shadow-sm overflow-hidden' }) {
  const Icon = FLAG_SVG[code] || FlagFr;
  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      <Icon className="w-full h-full" />
    </span>
  );
}

/** Custom language picker — never a native <select>. */
function FlagSelect({ locale, setLocale, t }) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const current = LOCALE_FLAGS[locale] || LOCALE_FLAGS.fr;

  useEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return undefined;
    }
    const place = () => {
      const el = btnRef.current || rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(220, window.innerWidth - 16);
      let left = r.right - width;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      const height = 168;
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
    <div className="relative shrink-0" ref={rootRef} data-help-target="help-lang">
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-center gap-0 lg:gap-2 h-9 w-9 lg:w-auto rounded-xl border px-0 lg:px-2.5 transition cursor-pointer ${
          open
            ? 'border-violet-400/40 bg-white/10 text-white ring-2 ring-violet-400/20'
            : 'border-white/10 bg-black/30 text-slate-100 hover:bg-white/10 hover:border-white/20'
        }`}
        aria-label={t('lang.title')}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <FlagMark code={locale} className="w-6 h-6 rounded-md overflow-hidden ring-1 ring-black/20" />
        <span className="text-xs font-semibold tracking-wide hidden lg:inline">{current.label}</span>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition hidden lg:block ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t('lang.title')}
          style={panelStyle || { position: 'fixed', visibility: 'hidden', top: 0, left: 0 }}
          className="max-h-[min(70dvh,22rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#0b1220]/98 backdrop-blur-xl shadow-2xl shadow-black/50 p-1.5"
        >
          {LOCALES.map((code) => {
            const { label } = LOCALE_FLAGS[code];
            const active = locale === code;
            return (
              <li key={code} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setLocale(code);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-sm transition cursor-pointer ${
                    active
                      ? 'bg-violet-500/20 text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <FlagMark code={code} className="w-7 h-7 rounded-lg overflow-hidden ring-1 ring-white/10" />
                  <span className="flex-1 font-medium">{label}</span>
                  {active ? (
                    <Check size={14} className="text-violet-300 shrink-0" />
                  ) : (
                    <span className="text-[10px] font-bold uppercase text-slate-500">{code}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function LanguageSelector() {
  const { locale, setLocale, t } = useLocale();
  return <FlagSelect locale={locale} setLocale={setLocale} t={t} />;
}
