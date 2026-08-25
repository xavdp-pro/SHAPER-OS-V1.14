import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronDown, Folder, HelpCircle, Plus, Search, Trash2, X,
} from 'lucide-react';
import { isValidAppId, normalizeAppId } from '../lib/appId.js';

function normalizeSearch(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Folder picker for turbinobash apps under /apps.
 * Lists existing directories, creates new ids via onCreate, removes from UI via onRemove.
 */
export default function AppsFolderPicker({
  value,
  projects = [],
  onChange,
  onCreate,
  onRemove,
  disabled = false,
  loading = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [createName, setCreateName] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const listId = useId();

  const selected = projects.find((p) => p.id === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return projects;
    const q = normalizeSearch(query);
    return projects.filter((p) => {
      const hay = normalizeSearch([p.label, p.id, p.appPath, p.rootPath].filter(Boolean).join(' '));
      return hay.includes(q);
    });
  }, [projects, query]);

  const createSlug = normalizeAppId(createName || query);
  const createExists = createSlug && projects.some((p) => p.id === createSlug);
  const canCreate = Boolean(createSlug && isValidAppId(createSlug) && !createExists);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCreateName('');
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

  const pick = (id) => {
    onChange(id);
    setOpen(false);
    setQuery('');
    setCreateName('');
  };

  const submitCreate = (e) => {
    e?.preventDefault();
    if (!canCreate) return;
    onCreate?.(createSlug);
    setOpen(false);
    setQuery('');
    setCreateName('');
  };

  return (
    <div ref={rootRef} className={`relative flex-1 min-w-0 ${className}`.trim()}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={`picker-trigger w-full ${open ? 'picker-trigger-open' : ''}`}
      >
        <Folder size={14} className="shrink-0 text-brand-300" />
        <span className="flex-1 min-w-0 text-left truncate">
          {selected ? (
            <>
              <span className="text-white">{selected.label}</span>
              <span className="text-slate-500 ml-1.5 font-mono text-[10px]">/apps/{selected.id}</span>
            </>
          ) : (
            <span className="text-slate-500">Choisir un dossier /apps…</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="picker-panel-wrap">
          <div className="px-3 py-2 border-b border-white/10 shrink-0">
            <p className="text-[10px] text-slate-500 font-mono">/apps</p>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
              Espaces applicatifs turbinobash — sélectionne un dossier existant ou crée-en un nouveau.
            </p>
          </div>
          <div className="picker-search">
            <Search size={14} className="shrink-0 text-slate-500" aria-hidden />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher ou nom du nouveau projet…"
              className="picker-search-input"
              autoComplete="off"
              spellCheck={false}
            />
            {query ? (
              <button
                type="button"
                className="picker-search-clear"
                onClick={() => setQuery('')}
                aria-label="Effacer"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          <ul id={listId} role="listbox" className="picker-panel theme-scrollbar max-h-56">
            {filtered.map((p) => {
              const active = p.id === value;
              return (
                <li key={p.id} role="option" aria-selected={active}>
                  <div className="flex items-stretch w-full">
                    <button
                      type="button"
                      onClick={() => pick(p.id)}
                      className={`picker-option flex-1 min-w-0 ${active ? 'picker-option-active' : ''}`}
                    >
                      <Folder size={14} className="shrink-0 text-slate-400" />
                      <span className="flex-1 min-w-0 text-left">
                        <span className="block text-sm text-white truncate">{p.label}</span>
                        <span className="block text-[10px] text-slate-500 font-mono truncate mt-0.5">
                          {p.hasAppDir === false ? `/apps/${p.id} (pas encore d'app/)` : p.appPath || `/apps/${p.id}/app`}
                        </span>
                      </span>
                      {active && <Check size={16} className="shrink-0 text-brand-400" />}
                    </button>
                    {onRemove && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onRemove(p.id);
                        }}
                        className="picker-option-remove shrink-0"
                        title="Supprimer de la liste KovZu (rien sur le disque)"
                        aria-label={`Supprimer ${p.label} de la liste`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {!filtered.length && !canCreate && (
              <li className="px-3 py-4 text-center text-xs text-slate-500">
                {loading ? 'Chargement…' : 'Aucun dossier /apps'}
              </li>
            )}
          </ul>
          <form onSubmit={submitCreate} className="border-t border-white/10 p-2 shrink-0 space-y-2">
            <div className="flex items-start gap-2 px-1">
              <HelpCircle size={13} className="shrink-0 text-brand-300 mt-0.5" />
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Nouveau : l'agent lance <span className="font-mono text-slate-400">tb app create</span>
                {' '}— le dossier <span className="font-mono text-slate-400">/apps/&lt;id&gt;/</span> sera créé sur le serveur.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={createName || (canCreate ? createSlug : '')}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="nom-du-projet"
                className="flex-1 min-w-0 bg-black/40 border border-white/15 rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/40 font-mono"
              />
              <button
                type="submit"
                disabled={!canCreate}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-brand-600/80 hover:bg-brand-600 text-white transition shrink-0 disabled:opacity-40"
              >
                <Plus size={13} />
                Créer
              </button>
            </div>
            {createSlug && !isValidAppId(createSlug) && (
              <p className="text-[10px] text-amber-400/90 px-1">Lettres, chiffres et tirets uniquement.</p>
            )}
            {createExists && (
              <p className="text-[10px] text-slate-500 px-1">Ce dossier existe déjà — sélectionne-le dans la liste.</p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
