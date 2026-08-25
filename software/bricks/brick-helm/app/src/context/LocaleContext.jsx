import { postLocaleSync } from '../api/client.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  loadLocale,
  localeFromSearch,
  normalizeLocale,
  saveLocale,
  syncLocaleQuery,
  t as translate,
} from '../lib/locale.js';
import { setActiveLocale } from '../api/client.js';

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const location = useLocation();
  const [locale, setLocaleState] = useState(() => loadLocale());

  /**
   * @param {string} next
   * @param {{ broadcast?: boolean }} [opts] `false` when applying a switch that
   *   came from another page — otherwise the two clients echo each other.
   */
  const setLocale = useCallback((next, opts = {}) => {
    const value = normalizeLocale(next);
    setLocaleState(value);
    saveLocale(value);
    syncLocaleQuery(value);
    if (opts.broadcast !== false) void postLocaleSync(value).catch(() => {});
  }, []);

  // Honor ?lang= / ?locale= when the URL changes (deep links / demo).
  useEffect(() => {
    const fromUrl = localeFromSearch(location.search);
    if (!fromUrl) return;
    setLocaleState((prev) => {
      if (prev === fromUrl) return prev;
      saveLocale(fromUrl);
      return fromUrl;
    });
  }, [location.search]);

  useEffect(() => {
    setActiveLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback((key) => translate(locale, key), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale requires LocaleProvider');
  return ctx;
}
