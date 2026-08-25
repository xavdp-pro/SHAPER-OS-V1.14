import React, { createContext, useContext, useState, useEffect } from 'react';
import fr from './fr.json';
import en from './en.json';
import es from './es.json';

const translations = { fr, en, es };

const I18nContext = createContext({
  locale: 'fr',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    return localStorage.getItem('shaper_locale') || 'fr';
  });

  const setLocale = (newLocale) => {
    if (translations[newLocale]) {
      setLocaleState(newLocale);
      localStorage.setItem('shaper_locale', newLocale);
    }
  };

  const t = (path) => {
    const keys = path.split('.');
    let current = translations[locale] || translations.fr;
    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = current[k];
      } else {
        return path;
      }
    }
    return typeof current === 'string' ? current : path;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
