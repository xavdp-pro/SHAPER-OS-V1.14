import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Trash2, X } from 'lucide-react';

/** From this many options, show a Select2-style search field. */
const SEARCH_THRESHOLD = 8;

function normalizeSearch(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Custom select (no native <select>) — mobile-friendly.
 * Many options → search input + clear (Select2-style).
 */
export default function PickerMenu({
  label,
  value,
  options = [],
  onChange,
  disabled = false,
  placeholder = 'Choisir…',
  searchPlaceholder = 'Rechercher…',
  className = '',
  searchable,
  /** Expand panel in-flow (push siblings) instead of absolute overlay. */
  inline = false,
  /** Use more vertical space for long option lists (e.g. SSH hosts). */
  tall = false,
  /** Open list expanded (stepper machine step). */
  defaultOpen = false,
  /** Render section headers when options carry `group` / `groupLabel`. */
  grouped = false,
  clearable = false,
  emptyLabel,
  /** UI-only delete. Trash shown when `removable` on the option. */
  onRemoveOption,
  removeTitle = 'Supprimer de la liste',
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const useSearch = searchable ?? options.length >= SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    if (!useSearch || !query.trim()) return options;
    const q = normalizeSearch(query);
    return options.filter((opt) => {
      const hay = normalizeSearch([opt.label, opt.hint, opt.value].filter(Boolean).join(' '));
      return hay.includes(q);
    });
  }, [options, query, useSearch]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return undefined;
    }
    const onPointer = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (next) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  const clear = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange('');
    setOpen(false);
    setQuery('');
  };

  const showClear = clearable && value != null && value !== '';

  const panelClass = [
    inline ? 'picker-panel-wrap picker-panel-inline' : 'picker-panel-wrap',
    tall ? 'picker-panel-tall' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      className={`relative ${tall ? 'picker-root-grow' : ''} ${className}`.trim()}
    >
      {label && (
        <span className="text-[9px] text-slate-600 px-1 block mb-0.5 shrink-0">{label}</span>
      )}
      <div className="relative flex items-stretch gap-1 shrink-0">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className={`picker-trigger flex-1 min-w-0 ${open ? 'picker-trigger-open' : ''}`}
        >
          <span className="flex-1 min-w-0 text-left truncate">
            {selected ? (
              <>
                <span className="text-white">{selected.label}</span>
                {selected.hint && (
                  <span className="text-slate-500 ml-1.5 font-mono text-[10px]">{selected.hint}</span>
                )}
              </>
            ) : (
              <span className="text-slate-500">{emptyLabel || placeholder}</span>
            )}
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {showClear && (
          <button
            type="button"
            disabled={disabled}
            onClick={clear}
            className="picker-clear"
            title="Vider"
            aria-label="Vider la sélection"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className={panelClass}>
          {useSearch && (
            <div className="picker-search">
              <Search size={14} className="shrink-0 text-slate-500" aria-hidden />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered[0] && !filtered[0].disabled) {
                    e.preventDefault();
                    pick(filtered[0].value);
                  }
                  if (e.key === 'Escape') {
                    if (query) {
                      e.stopPropagation();
                      setQuery('');
                    }
                  }
                }}
                placeholder={searchPlaceholder}
                className="picker-search-input"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={searchPlaceholder}
              />
              {query ? (
                <button
                  type="button"
                  className="picker-search-clear"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  title="Effacer"
                  aria-label="Effacer la recherche"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          )}
          <ul
            id={listId}
            role="listbox"
            className="picker-panel theme-scrollbar"
          >
            {clearable && (
              <li role="option" aria-selected={!selected}>
                <button
                  type="button"
                  onClick={() => pick('')}
                  className={`picker-option ${!selected ? 'picker-option-active' : ''}`}
                >
                  <span className="flex-1 min-w-0 text-left text-sm text-slate-500 truncate">
                    {emptyLabel || placeholder}
                  </span>
                  {!selected && <Check size={16} className="shrink-0 text-brand-400" />}
                </button>
              </li>
            )}
            {filtered.map((opt, idx) => {
              const active = opt.value === value;
              const optDisabled = Boolean(opt.disabled);
              const prevGroup = idx > 0 ? filtered[idx - 1]?.group : null;
              const showGroup = grouped && opt.groupLabel && opt.group !== prevGroup;
              return (
                <li key={`${String(opt.group || '')}-${String(opt.value)}`}>
                  {showGroup && (
                    <div className="picker-group-label" role="presentation">
                      {opt.groupLabel}
                    </div>
                  )}
                  <div className="flex items-stretch w-full" role="option" aria-selected={active} aria-disabled={optDisabled}>
                    <button
                      type="button"
                      disabled={optDisabled}
                      onClick={() => !optDisabled && pick(opt.value)}
                      className={`picker-option flex-1 min-w-0 ${active ? 'picker-option-active' : ''} ${optDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <span className="flex-1 min-w-0 text-left">
                        <span className="block text-sm text-white truncate">{opt.label}</span>
                        {opt.hint && (
                          <span className="block text-[10px] text-slate-500 font-mono truncate mt-0.5">
                            {opt.hint}
                          </span>
                        )}
                      </span>
                      {active && <Check size={16} className="shrink-0 text-brand-400" />}
                    </button>
                    {onRemoveOption && opt.removable && !optDisabled && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onRemoveOption(opt.value);
                        }}
                        className="picker-option-remove shrink-0"
                        title={removeTitle}
                        aria-label={`${removeTitle} : ${opt.label}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {!filtered.length && (
              <li className="px-3 py-4 text-center text-xs text-slate-500">
                Aucun résultat
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
