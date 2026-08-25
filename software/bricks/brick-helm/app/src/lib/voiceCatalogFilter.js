/**
 * Locale matching for ElevenLabs catalog.
 *
 * Doc notes:
 * - Premade voices are mostly labeled language=en but may list FR/ES in verified_languages.
 * - Free tier: Voice Library voices are NOT available via API — mostly English premades.
 * - Native francophone / hispanophone voices need to be in "My Voices" (paid library / clone).
 *
 * @typedef {'native' | 'verified' | 'all'} VoiceLocaleFilterMode
 */

const LOCALE_ALIASES = {
  fr: new Set(['fr', 'fra', 'fre', 'french', 'français', 'francais', 'fr-fr', 'fr-ca']),
  es: new Set(['es', 'spa', 'spanish', 'español', 'espanol', 'es-es', 'es-mx', 'es-419']),
  en: new Set(['en', 'eng', 'english', 'en-us', 'en-gb', 'en-au', 'en-ca']),
};

const ACCENT_HINTS = {
  fr: ['french', 'parisian', 'Québécois', 'quebecois', 'canadian french'],
  es: ['spanish', 'peninsular', 'mexican', 'castilian', 'latam', 'argentina', 'colombian'],
  en: ['american', 'british', 'australian', 'irish', 'scottish', 'canadian'],
};

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function localeSet(locale) {
  return LOCALE_ALIASES[String(locale || '').slice(0, 2)] || null;
}

/** Primary language from labels.language (what ElevenLabs tags as the voice's language). */
export function voicePrimaryLanguage(voice) {
  return norm(voice?.language || voice?.labels?.language || '');
}

/** Distinct language codes from verified_languages[]. */
export function voiceVerifiedLanguages(voice) {
  const raw = voice?.verifiedLanguages || voice?.verified_languages || [];
  if (!Array.isArray(raw)) return [];
  const out = new Set();
  for (const item of raw) {
    const code = norm(typeof item === 'string' ? item : item?.language);
    if (code) out.add(code.slice(0, 2));
  }
  return [...out];
}

export function isNativeLocaleVoice(voice, locale) {
  const set = localeSet(locale);
  if (!set) return false;
  const primary = voicePrimaryLanguage(voice);
  if (!primary) return false;
  if (set.has(primary) || set.has(primary.slice(0, 2))) return true;
  // e.g. labels.language = "french"
  return set.has(primary);
}

export function isVerifiedLocaleVoice(voice, locale) {
  const lang = String(locale || '').slice(0, 2);
  if (!lang) return false;
  if (isNativeLocaleVoice(voice, lang)) return true;
  return voiceVerifiedLanguages(voice).includes(lang);
}

/**
 * Strict match for UI filter.
 * - native: labels.language is that locale (true francophone / hispanophone / anglophone)
 * - verified: native OR verified_languages includes locale (can speak it; often EN-primary)
 * - all: always
 */
export function voiceMatchesLocale(voice, locale, mode = 'native') {
  const m = mode || 'native';
  if (m === 'all') return true;
  if (m === 'verified') return isVerifiedLocaleVoice(voice, locale);
  return isNativeLocaleVoice(voice, locale);
}

export function voiceLocaleRank(voice, locale) {
  if (isNativeLocaleVoice(voice, locale)) return 0;
  if (isVerifiedLocaleVoice(voice, locale)) return 1;
  return 2;
}

export function sortVoicesForLocale(voices, locale) {
  return [...voices].sort((a, b) => {
    const ra = voiceLocaleRank(a, locale);
    const rb = voiceLocaleRank(b, locale);
    if (ra !== rb) return ra - rb;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
}

export function countVoicesByLocale(voices, locale) {
  let native = 0;
  let verified = 0;
  for (const v of voices) {
    if (isNativeLocaleVoice(v, locale)) native += 1;
    else if (isVerifiedLocaleVoice(v, locale)) verified += 1;
  }
  return { native, verified, other: Math.max(0, voices.length - native - verified) };
}

export function voiceOptionHint(voice) {
  const primary = voicePrimaryLanguage(voice) || '—';
  const accent = voice?.accent || voice?.labels?.accent || '';
  const gender = voice?.gender || voice?.labels?.gender || '';
  const verified = voiceVerifiedLanguages(voice);
  const parts = [primary];
  if (accent) parts.push(accent);
  if (gender) parts.push(gender);
  if (voiceNeedsPaidApi(voice)) {
    parts.push('API payante');
  } else if (voice?.provider === 'cartesia') {
    parts.push('Cartesia');
  } else if (voice?.provider === 'deepgram') {
    parts.push('Deepgram');
  }
  if (verified.length) {
    const extra = verified.filter((l) => l !== primary.slice(0, 2)).slice(0, 4);
    if (extra.length) parts.push(`+${extra.join('/')}`);
  }
  return parts.join(' · ');
}

export function voiceNeedsPaidApi(voice) {
  if (!voice) return false;
  if (voice.provider === 'cartesia' || voice.provider === 'deepgram') return false;
  if (voice.apiFreeTierOk === true) return false;
  if (voice.apiFreeTierOk === false) return true;
  const cat = String(voice.category || '').toLowerCase();
  // ElevenLabs: only premade is reliably free-tier via API
  return Boolean(cat && cat !== 'premade');
}

/** Accent keywords for search box (not used for strict filter). */
export function accentHintsForLocale(locale) {
  return ACCENT_HINTS[String(locale || '').slice(0, 2)] || [];
}
