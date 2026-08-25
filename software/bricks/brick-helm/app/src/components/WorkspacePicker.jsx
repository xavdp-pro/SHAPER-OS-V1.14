import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Folder, FolderOpen, Home, Loader2, RefreshCw,
} from 'lucide-react';
import { browseRemoteFs } from '../api/client.js';
import { useLocale } from '../context/LocaleContext.jsx';

function defaultRoots(user) {
  const u = String(user || '').trim() || 'zaza';
  return [
    `/home/${u}`,
    `/home/${u}/Bureau`,
    `/apps/${u}`,
    `/apps/${u}/app`,
    `/apps/${u}/ws`,
  ];
}

function shortLabel(abs, user) {
  const u = String(user || '').trim();
  return String(abs || '')
    .replace(`/home/${u}/Bureau`, '~/Bureau')
    .replace(`/home/${u}`, '~')
    .replace(`/apps/${u}`, '/apps…');
}

function breadcrumbParts(absPath) {
  const raw = String(absPath || '/').replace(/\/+$/, '') || '/';
  if (raw === '/') return [{ name: '/', path: '/' }];
  const parts = raw.split('/').filter(Boolean);
  const crumbs = [{ name: '/', path: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
}

export default function WorkspacePicker({
  machine = '',
  user = '',
  value = '',
  onChange,
  active = true,
}) {
  const { t } = useLocale();
  const [browsePath, setBrowsePath] = useState('');
  const [entries, setEntries] = useState([]);
  const [parent, setParent] = useState(null);
  const [roots, setRoots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [draft, setDraft] = useState(value || '');

  const suggestedRoots = useMemo(() => defaultRoots(user), [user]);
  const crumbs = useMemo(() => breadcrumbParts(browsePath || value), [browsePath, value]);

  const loadDir = useCallback(async (dirPath, { select = true } = {}) => {
    if (!machine || !user) return;
    const target = String(dirPath || suggestedRoots[0]).trim();
    if (!target.startsWith('/')) return;
    setLoading(true);
    setError('');
    const { ok, data } = await browseRemoteFs({
      node: machine,
      user,
      path: target,
    });
    setLoading(false);
    if (!ok || !data?.ok) {
      setError(data?.error || t('stepper.browseError'));
      setBrowsePath(target);
      setEntries([]);
      setParent(target === '/' ? null : target.replace(/\/[^/]+\/?$/, '') || '/');
      if (select) {
        setDraft(target);
        onChange?.(target);
      }
      return;
    }
    setBrowsePath(data.path);
    setDraft(data.path);
    setEntries(data.entries || []);
    setParent(data.parent ?? null);
    setSource(data.source || '');
    if (Array.isArray(data.roots) && data.roots.length) {
      setRoots(data.roots);
    } else {
      setRoots(suggestedRoots);
    }
    if (select) onChange?.(data.path);
  }, [machine, user, suggestedRoots, onChange, t]);

  useEffect(() => {
    if (!active || !machine || !user) return;
    const initial = value || suggestedRoots[1] || suggestedRoots[0];
    setDraft(initial);
    void loadDir(initial);
  }, [active, machine, user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (value && value !== draft) setDraft(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const quickRoots = roots.length ? roots : suggestedRoots;
  const selected = String(value || draft || '').trim();

  const applyDraft = () => {
    const trimmed = String(draft || '').trim();
    if (!trimmed.startsWith('/')) return;
    onChange?.(trimmed);
    void loadDir(trimmed);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <label className="block px-1 shrink-0">
        <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
          {t('stepper.pathLabel')}
        </span>
        <div className="flex gap-1.5 mt-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyDraft();
              }
            }}
            onBlur={applyDraft}
            placeholder={t('stepper.pathPlaceholder')}
            className="input-field text-sm py-2.5 font-mono flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={applyDraft}
            className="btn-secondary px-3 text-xs shrink-0"
            title={t('stepper.browseGo')}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </label>
      <p className="text-[10px] text-slate-600 px-1 shrink-0">{t('stepper.pathHint')}</p>

      <div className="flex flex-wrap gap-1 px-1 shrink-0">
        {quickRoots.map((root) => (
          <button
            key={root}
            type="button"
            onClick={() => {
              setDraft(root);
              onChange?.(root);
              void loadDir(root);
            }}
            className={`text-[10px] font-mono px-2 py-1 rounded-lg border transition ${
              selected === root || browsePath === root
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-300'
                : 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:border-white/20'
            }`}
          >
            {shortLabel(root, user)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden flex flex-col flex-1 min-h-[42vh]">
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 bg-white/5 shrink-0">
          <button
            type="button"
            disabled={parent == null || loading}
            onClick={() => {
              if (parent == null) return;
              setDraft(parent);
              onChange?.(parent);
              void loadDir(parent);
            }}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30"
            title={t('stepper.browseUp')}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              const home = suggestedRoots[0];
              setDraft(home);
              onChange?.(home);
              void loadDir(home);
            }}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
            title="~"
          >
            <Home size={13} />
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto theme-scrollbar text-[10px] font-mono">
            {crumbs.map((c, i) => (
              <button
                key={c.path}
                type="button"
                onClick={() => {
                  setDraft(c.path);
                  onChange?.(c.path);
                  void loadDir(c.path);
                }}
                className={`shrink-0 px-1 py-0.5 rounded hover:bg-white/10 ${
                  i === crumbs.length - 1 ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
                title={c.path}
              >
                {c.name === '/' ? '/' : c.name}
                {i < crumbs.length - 1 && c.name !== '/' ? (
                  <span className="text-slate-700 ml-0.5">/</span>
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadDir(browsePath || selected || suggestedRoots[0])}
            className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-40"
            title={t('stepper.browseRefresh')}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          {source && (
            <span className="text-[9px] text-slate-600 uppercase shrink-0">{source}</span>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto theme-scrollbar">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-xs">
              <Loader2 size={14} className="animate-spin" />
              {t('stepper.browseLoading')}
            </div>
          )}
          {!loading && error && (
            <div className="px-3 py-4 space-y-2">
              <p className="text-[11px] text-amber-400/95">{error}</p>
              <p className="text-[10px] text-slate-500">{t('stepper.browseErrorHint')}</p>
            </div>
          )}
          {!loading && !error && !entries.length && (
            <p className="px-3 py-6 text-[11px] text-slate-500 text-center">{t('stepper.browseEmpty')}</p>
          )}
          {!loading && entries.map((entry) => {
            const isSelected = selected === entry.path;
            return (
              <div
                key={entry.path}
                className={`flex items-stretch border-b border-white/5 ${
                  isSelected ? 'bg-brand-500/10' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setDraft(entry.path);
                    onChange?.(entry.path);
                    void loadDir(entry.path);
                  }}
                  className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-left text-xs font-mono transition hover:bg-white/5 ${
                    isSelected ? 'text-brand-200' : 'text-slate-300'
                  }`}
                >
                  {isSelected ? (
                    <FolderOpen size={14} className="shrink-0 text-amber-400" />
                  ) : (
                    <Folder size={14} className="shrink-0 text-amber-400/80" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(entry.path);
                    onChange?.(entry.path);
                    setBrowsePath(entry.path);
                  }}
                  className={`px-2.5 shrink-0 text-slate-500 hover:text-emerald-400 hover:bg-white/5 ${
                    isSelected ? 'text-emerald-400' : ''
                  }`}
                  title={t('stepper.browseSelect')}
                >
                  <Check size={14} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-white/10 px-3 py-2 bg-white/[0.03] flex items-center gap-2">
          <p className="flex-1 min-w-0 text-[10px] font-mono text-emerald-400/90 truncate" title={selected}>
            {selected ? `→ ${selected}` : t('stepper.pathPlaceholder')}
          </p>
          {selected.startsWith('/') && (
            <span className="text-[9px] text-slate-600 shrink-0 uppercase tracking-wide">
              {t('stepper.browseSelected')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
