import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../../context/LocaleContext.jsx';
import {
  Check, Info, Loader2, Play, RotateCcw, Save, Volume2,
} from 'lucide-react';
import { getVoiceCatalog, updateSettings, voiceTtsPreview } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { LOCALE_FLAGS } from '../../lib/locale.js';
import PickerMenu from '../../components/PickerMenu.jsx';
import {
  countVoicesByLocale,
  isNativeLocaleVoice,
  sortVoicesForLocale,
  voiceMatchesLocale,
  voiceNeedsPaidApi,
  voiceOptionHint,
} from '../../lib/voiceCatalogFilter.js';
import { speechTextFromAssistant, takeSpeakableChunks } from '../../lib/voiceCursorLoop.js';
import { splitEmotionSegments } from '../../lib/emotionTags.js';
import {
  mergeTinySpeechChunks,
  playBase64Audio,
  playSpeechChunkPipeline,
  SINGLE_SHOT_TTS_MAX,
  unlockAudioPlayback,
} from '../../lib/voicePlaybackPipeline.js';

/** @typedef {'native' | 'verified' | 'all'} FilterMode */

const LANGS = ['fr', 'es', 'en'];

const LOCALE_OPTIONS = LANGS.map((l) => ({
  value: l,
  label: `${LOCALE_FLAGS[l].flag}  ${LOCALE_FLAGS[l].label}`,
  hint: l.toUpperCase(),
}));

const PROVIDER_LABELS = {
  cartesia: 'Cartesia',
  deepgram: 'Deepgram',
  elevenlabs: 'ElevenLabs',
};

function formatSavedVoiceMeta(meta) {
  if (!meta?.voiceId) return '—';
  const prov = meta.provider ? (PROVIDER_LABELS[meta.provider] || meta.provider) : '?';
  const short = meta.voiceId.length > 24
    ? `${meta.voiceId.slice(0, 10)}…${meta.voiceId.slice(-6)}`
    : meta.voiceId;
  return `${prov} · ${short}`;
}

function formatUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(2)} $`;
}

export default function AdminVoices() {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('eleven_v3');
  const [scripts, setScripts] = useState({});
  const [selected, setSelected] = useState({ fr: '', es: '', en: '' });
  const [drafts, setDrafts] = useState({ fr: '', es: '', en: '' });
  const [texts, setTexts] = useState({ fr: '', es: '', en: '' });
  const [testing, setTesting] = useState({ fr: false, es: false, en: false });
  const [testProgress, setTestProgress] = useState('');
  const [activeLang, setActiveLang] = useState('fr');
  /** native = true nationality; verified = can speak language; all = full catalog */
  const [filterMode, setFilterMode] = useState(/** @type {FilterMode} */ ('native'));
  const [catalogNotes, setCatalogNotes] = useState(null);
  const [stack, setStack] = useState(/** @type {Record<string, unknown>|null} */ (null));
  const [saved, setSaved] = useState({ fr: '', es: '', en: '' });
  const [mismatch, setMismatch] = useState({ fr: false, es: false, en: false });
  const [savedMeta, setSavedMeta] = useState(/** @type {Record<string, {voiceId:string,provider:string|null,ignored:boolean}|null>} */ ({}));
  const [karaoke, setKaraoke] = useState(false);
  const [karaokeGrain, setKaraokeGrain] = useState(/** @type {'word'|'sentence'|null} */ (null));
  const [ttsProviderEnv, setTtsProviderEnv] = useState('');
  const [activeProvider, setActiveProvider] = useState('');
  const [availableProviders, setAvailableProviders] = useState([]);
  const [billing, setBilling] = useState(/** @type {Record<string, unknown>|null} */ (null));
  const [switching, setSwitching] = useState(false);
  const abortRef = useRef(0);
  const testAbortRef = useRef(/** @type {AbortController|null} */ (null));
  const providerRef = useRef('');

  const load = useCallback(async (browse) => {
    setLoading(true);
    const { ok, data } = await getVoiceCatalog(browse);
    setLoading(false);
    if (!ok) {
      pushToast(data?.error || 'Catalogue voix indisponible', { type: 'error' });
      return;
    }
    const nextProvider = data.provider || browse || '';
    providerRef.current = nextProvider;
    setCatalog(data.voices || []);
    setProvider(nextProvider);
    setActiveProvider(data.activeProvider || nextProvider);
    setAvailableProviders(Array.isArray(data.availableProviders) ? data.availableProviders : []);
    setBilling(data.billing || null);
    setModel(data.model || 'eleven_v3');
    setCatalogNotes(data.notes || null);
    setStack(data.stack || null);
    setSaved(data.saved || {});
    setMismatch(data.mismatch || {});
    setSavedMeta(data.savedMeta || {});
    setKaraoke(Boolean(data.karaoke));
    setKaraokeGrain(data.karaokeGrain || (data.karaoke ? 'word' : null));
    setTtsProviderEnv(data.ttsProviderEnv || '');
    const sel = data.selected || {};
    const nextSel = {
      fr: sel.fr || '',
      es: sel.es || '',
      en: sel.en || '',
    };
    setSelected(nextSel);
    setDrafts(nextSel);
    const sc = data.testScripts || {};
    setScripts(sc);
    setTexts({
      fr: sc.fr || '',
      es: sc.es || '',
      en: sc.en || '',
    });
  }, [pushToast]);

  useEffect(() => { load(); }, [load]);

  const dirty = LANGS.some((l) => drafts[l] && drafts[l] !== selected[l]);

  const handleSave = async () => {
    setSaving(true);
    const { ok, data } = await updateSettings({ voices: drafts });
    setSaving(false);
    if (!ok) {
      pushToast(data?.error || 'Enregistrement échoué', { type: 'error' });
      return;
    }
    const voices = data.voices || drafts;
    setSelected({ ...voices });
    setDrafts({ ...voices });
    pushToast(t('toast.voicesSaved'), { type: 'success' });
    await load(providerRef.current);
  };

  const handleActivateProvider = async (next) => {
    if (!next || next === activeProvider || switching) return;
    setSwitching(true);
    const { ok, data } = await updateSettings({ ttsProvider: next });
    setSwitching(false);
    if (!ok) {
      pushToast(data?.error || 'Changement de moteur TTS échoué', { type: 'error' });
      return;
    }
    pushToast(`TTS chat → ${PROVIDER_LABELS[next] || next}`, { type: 'success' });
    await load(next);
  };

  const resetScript = (lang) => {
    setTexts((prev) => ({ ...prev, [lang]: scripts[lang] || '' }));
  };

  const handleTest = async (lang, { quick = false } = {}) => {
    const voiceId = drafts[lang];
    if (!voiceId) {
      pushToast(t('toast.pickVoiceFirst'), { type: 'error' });
      return;
    }
    const voice = catalog.find((v) => v.voiceId === voiceId);
    if (voiceNeedsPaidApi(voice)) {
      pushToast(
        'Cette voix (Library / pro) refuse l’API en plan gratuit. Choisis une voix premade (ex. Matilda), ou upgrade ElevenLabs.',
        { type: 'error', duration: 12000 },
      );
      return;
    }

    // Unlock audio in the same user-gesture turn (avoids silent spinner / autoplay block)
    void unlockAudioPlayback();

    testAbortRef.current?.abort();
    const ac = new AbortController();
    testAbortRef.current = ac;
    const token = ++abortRef.current;
    setTesting((t) => ({ ...t, [lang]: true }));
    setTestProgress(quick ? 'Synthèse…' : 'Préparation…');

    const failMsg = (data, status) => (
      data?.error
      || (status === 402 && provider === 'cartesia'
        ? 'Crédits Cartesia épuisés — bascule sur Deepgram pour le chat.'
        : null)
      || (status === 402
        ? 'Plan gratuit : voix Library interdite via l’API — prends une voix premade.'
        : null)
      || (status ? `Test TTS échoué (HTTP ${status})` : 'Test TTS échoué')
    );

    try {
      if (quick) {
        setTestProgress('Synthèse…');
        const { ok, status, data } = await voiceTtsPreview({
          lang,
          voiceId,
          provider,
          useQuickTest: true,
        });
        if (token !== abortRef.current) return;
        if (!ok || !data?.audioBase64) {
          pushToast(failMsg(data, status), { type: 'error', duration: 12000 });
          return;
        }
        setTestProgress('Lecture…');
        await playBase64Audio(data.audioBase64, data.contentType, { signal: ac.signal });
        pushToast(t('toast.playbackOk'), { type: 'success', duration: 2000 });
        return;
      }

      // Prefer longest available script (textarea may be truncated vs demo)
      const fromUi = String(texts[lang] || '').trim();
      const fromDemo = String(scripts[lang] || '').trim();
      const raw = (fromUi.length >= fromDemo.length ? fromUi : fromDemo) || fromUi || fromDemo;
      if (!raw.trim()) {
        pushToast(t('toast.testTextEmpty'), { type: 'error' });
        return;
      }

      const fetchOne = async (text) => {
        const { ok, status, data } = await voiceTtsPreview({ lang, voiceId, text, provider });
        if (!ok || !data?.audioBase64) {
          throw new Error(failMsg(data, status));
        }
        return { audioBase64: data.audioBase64, contentType: data.contentType };
      };

      // One HTTP TTS = one emotion. Split on [happy]/[excited]/… so the demo
      // is not locked to the first tag (was [calm] → whole script sounded cold).
      const emotionPieces = splitEmotionSegments(raw)
        .map((seg) => speechTextFromAssistant(seg, { streaming: false }))
        .filter(Boolean);

      if (!emotionPieces.length) {
        pushToast(t('toast.testTextEmpty'), { type: 'error' });
        return;
      }

      if (emotionPieces.length > 1) {
        setTestProgress(`Émotions 0/${emotionPieces.length}…`);
        await playSpeechChunkPipeline(emotionPieces, async (text) => fetchOne(text), {
          signal: ac.signal,
          prefetch: 2,
          onProgress: (i, n) => setTestProgress(`Émotion ${i}/${n}`),
        });
        if (token === abortRef.current) {
          pushToast(t('toast.playbackFullOk'), { type: 'success', duration: 2500 });
        }
        return;
      }

      const speech = emotionPieces[0];

      // Short scripts without multi-emotion tags: ONE request
      if (speech.length <= SINGLE_SHOT_TTS_MAX) {
        setTestProgress('Synthèse du script…');
        const payload = await fetchOne(speech);
        if (token !== abortRef.current) return;
        setTestProgress('Lecture…');
        await playBase64Audio(payload.audioBase64, payload.contentType, { signal: ac.signal });
        if (token === abortRef.current) {
          pushToast(t('toast.playbackFullOk'), { type: 'success', duration: 2500 });
        }
        return;
      }

      // Long texts: larger chunks + prefetch pipeline
      const { chunks: rawChunks } = takeSpeakableChunks(speech, { final: true, hardMax: 220 });
      const chunks = mergeTinySpeechChunks(rawChunks, 120);
      if (!chunks.length) {
        pushToast(t('toast.scriptNothing'), { type: 'error' });
        return;
      }

      await playSpeechChunkPipeline(chunks, async (text) => fetchOne(text), {
        signal: ac.signal,
        prefetch: 2,
        onProgress: (i, n) => setTestProgress(`Lecture ${i}/${n}`),
      });

      if (token === abortRef.current) {
        pushToast(t('toast.playbackFullOk'), { type: 'success', duration: 2500 });
      }
    } catch (err) {
      if (token !== abortRef.current) return;
      if (err?.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Lecture audio échouée';
      pushToast(
        /autoplay|NotAllowed|play/i.test(msg)
          ? 'Lecture bloquée par le navigateur — reclique sur Tester'
          : msg,
        { type: 'error', duration: 12000 },
      );
    } finally {
      if (token === abortRef.current) {
        setTesting((t) => ({ ...t, [lang]: false }));
        setTestProgress('');
      }
    }
  };

  const voiceLabel = (id) => {
    const v = catalog.find((x) => x.voiceId === id);
    return v ? v.name : id || '—';
  };

  const voiceMeta = (id) => {
    const v = catalog.find((x) => x.voiceId === id);
    if (!v) return '';
    return voiceOptionHint(v);
  };

  const lang = activeLang;
  const localeMeta = LOCALE_FLAGS[lang];

  const freeCatalog = useMemo(
    () => catalog.filter((v) => !voiceNeedsPaidApi(v)),
    [catalog],
  );
  const paidHidden = catalog.length - freeCatalog.length;

  const localeCounts = useMemo(() => countVoicesByLocale(freeCatalog, lang), [freeCatalog, lang]);

  const voiceOptions = useMemo(() => {
    let list = sortVoicesForLocale(freeCatalog, lang);
    if (filterMode !== 'all') {
      list = list.filter((v) => voiceMatchesLocale(v, lang, filterMode));
    }
    // Keep current selection visible even if it was a paid voice (so user can switch)
    const currentId = drafts[lang];
    if (currentId && !list.some((v) => v.voiceId === currentId)) {
      const current = catalog.find((v) => v.voiceId === currentId);
      if (current) list = [current, ...list];
    }
    return list.map((v) => {
      const hint = voiceOptionHint(v);
      const paid = voiceNeedsPaidApi(v);
      const native = isNativeLocaleVoice(v, lang);
      let badge = filterMode === 'all'
        ? (native ? `${hint} · natif` : hint)
        : hint;
      if (paid) badge = `${badge} · (actuelle, payante — change-la)`;
      return {
        value: v.voiceId,
        label: v.name,
        hint: badge,
      };
    });
  }, [freeCatalog, catalog, lang, filterMode, drafts]);

  const anyMismatch = LANGS.some((l) => mismatch[l]);
  const sttLabel = stack?.sttProvider ? String(stack.sttProvider) : '—';
  const sttModel = stack?.sttModel ? String(stack.sttModel) : '';
  const ttsLabel = stack?.ttsProvider ? String(stack.ttsProvider) : (provider || '—');

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  const saveBar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[11px] text-slate-500">
        {dirty
          ? 'Modifications non enregistrées — le chat utilise les voix actives jusqu’à enregistrement.'
          : 'Voix alignées avec le chat (TTS actif).'}
      </p>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !dirty}
        className="btn-primary text-sm py-2 px-4"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : dirty ? <Save size={14} /> : <Check size={14} />}
        Enregistrer
      </button>
    </div>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="zone-sunk rounded-xl border border-white/10 p-3.5 space-y-3">
        <p className="text-xs text-slate-300 font-medium">Stack voix (chat + tests)</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <span>
            STT :{' '}
            <strong className="text-slate-200 capitalize">{sttLabel}</strong>
            {sttModel ? ` (${sttModel})` : ''}
          </span>
          <span>
            TTS chat :{' '}
            <strong className="text-slate-200">
              {PROVIDER_LABELS[activeProvider] || activeProvider || ttsLabel}
            </strong>
            {activeProvider === provider && model ? ` (${model})` : ''}
          </span>
          <span>
            Karaoke :{' '}
            <strong className={karaoke ? 'text-brand-300' : 'text-slate-500'}>
              {karaoke
                ? (karaokeGrain === 'sentence' ? 'oui (phrases)' : 'oui (Cartesia)')
                : 'non'}
            </strong>
          </span>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Catalogue à tester
          </p>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Moteur TTS">
            {(availableProviders.length ? availableProviders : ['cartesia', 'deepgram']).map((id) => {
              const active = provider === id;
              const used = activeProvider === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => { if (id !== provider) void load(id); }}
                  className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border transition cursor-pointer ${
                    active
                      ? 'border-brand-500/40 bg-brand-600/20 text-brand-100'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {PROVIDER_LABELS[id] || id}
                  {used && <span className="text-[9px] uppercase tracking-wide opacity-80">chat</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-slate-500">Cartesia</p>
            <p className={billing?.cartesia?.quotaExceeded ? 'text-amber-300' : 'text-slate-200'}>
              {!billing?.cartesia?.configured
                ? 'clé absente'
                : billing?.cartesia?.quotaExceeded
                  ? 'crédits épuisés (402)'
                  : billing?.cartesia?.ok
                    ? 'TTS OK'
                    : (billing?.cartesia?.message || 'indisponible')}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-slate-500">Deepgram</p>
            <p className="text-slate-200">
              {!billing?.deepgram?.configured
                ? 'clé absente'
                : billing?.deepgram?.ok
                  ? `solde ${formatUsd(billing.deepgram.usd)}`
                  : (billing?.deepgram?.message || 'indisponible')}
            </p>
          </div>
        </div>

        {provider && provider !== activeProvider && (
          <button
            type="button"
            onClick={() => handleActivateProvider(provider)}
            disabled={switching}
            className="btn-primary text-sm py-2 px-3"
          >
            {switching ? <Loader2 size={14} className="animate-spin" /> : null}
            Utiliser {PROVIDER_LABELS[provider] || provider} pour le chat
          </button>
        )}

        {billing?.cartesia?.quotaExceeded && activeProvider === 'cartesia' && (
          <p className="text-[11px] text-amber-300/90 leading-relaxed">
            Cartesia n’a plus de crédits. Passe le chat sur Deepgram (onglet Deepgram → Utiliser pour le chat).
          </p>
        )}
        {anyMismatch && (
          <p className="text-[11px] text-amber-300/90 leading-relaxed">
            Mode hybride : certaines voix en base ne correspondent pas au TTS de ce catalogue — elles sont
            ignorées. Le sélecteur ci-dessous montre ce que ce moteur utiliserait.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-slate-500 max-w-xl">
          Voix {PROVIDER_LABELS[provider] || provider || '—'}
          {provider === activeProvider ? ' (moteur du chat)' : ' (test catalogue)'}
          . Modèle :{' '}
          <span className="font-mono text-slate-400">{model}</span>
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="btn-primary text-sm py-2 px-4 shrink-0"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : dirty ? <Save size={14} /> : <Check size={14} />}
          Enregistrer
        </button>
      </div>
      {dirty && (
        <p className="text-[11px] text-amber-300/90 -mt-2">
          Modifications non enregistrées
        </p>
      )}

      {/* Nationality overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {LANGS.map((l) => {
          const active = activeLang === l;
          const dirtyLang = drafts[l] && drafts[l] !== selected[l];
          const hybridLang = Boolean(mismatch[l]);
          const meta = LOCALE_FLAGS[l];
          return (
            <button
              key={l}
              type="button"
              onClick={() => setActiveLang(l)}
              className={`text-left rounded-2xl border px-3.5 py-3 transition cursor-pointer ${
                active
                  ? 'border-brand-500/50 bg-brand-600/15 ring-1 ring-brand-500/30'
                  : 'border-white/10 bg-black/25 hover:border-white/20 hover:bg-black/35'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xl leading-none" aria-hidden>{meta.flag}</span>
                {dirtyLang && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Non enregistré" />
                )}
                {!dirtyLang && hybridLang && (
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" title="Voix base ≠ TTS actif" />
                )}
              </div>
              <p className={`text-sm font-semibold ${active ? 'text-white' : 'text-slate-200'}`}>
                {meta.label}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">
                {l}
              </p>
              <p className="text-xs text-slate-400 mt-2 truncate" title={voiceLabel(drafts[l] || selected[l])}>
                {voiceLabel(drafts[l] || selected[l])}
              </p>
              {(voiceMeta(drafts[l] || selected[l])) && (
                <p className="text-[10px] text-slate-600 mt-0.5 truncate">
                  {voiceMeta(drafts[l] || selected[l])}
                </p>
              )}
            </button>
          );
        })}
      </div>

      <div className="zone-sunk rounded-2xl border border-white/10 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:justify-between">
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Nationalité à configurer
            </p>
            <PickerMenu
              value={lang}
              options={LOCALE_OPTIONS}
              onChange={setActiveLang}
              placeholder="Choisir une nationalité"
            />
            <p className="text-[11px] text-slate-500">
              Voix chat (active) :{' '}
              <span className="text-slate-300">{voiceLabel(selected[lang])}</span>
            </p>
            {mismatch[lang] && savedMeta[lang] && (
              <p className="text-[11px] text-amber-300/90 leading-relaxed mt-1">
                En base (ignorée) :{' '}
                <span className="font-mono text-amber-200/90">{formatSavedVoiceMeta(savedMeta[lang])}</span>
                {' '}— TTS actif = {PROVIDER_LABELS[provider] || provider}. Enregistre une voix{' '}
                {PROVIDER_LABELS[provider] || provider} pour remplacer.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1">
            <span className="text-2xl" aria-hidden>{localeMeta?.flag}</span>
            <Volume2 size={16} className="text-brand-400" />
          </div>
        </div>

        <div className="block text-xs text-slate-400 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Voix {provider === 'cartesia' ? 'Cartesia' : provider === 'deepgram' ? 'Deepgram' : 'API'}
              {' '}gratuites — {localeMeta?.label}
            </span>
            <span className="text-[10px] text-slate-500">
              {localeCounts.native} native{localeCounts.native > 1 ? 's' : ''}
              {' · '}
              {freeCatalog.length} gratuites
              {paidHidden > 0 ? ` · ${paidHidden} payantes masquées` : ''}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtre nationalité">
            {([
              ['native', `Natives ${lang.toUpperCase()}`, localeCounts.native],
              ['verified', 'Savent parler', localeCounts.native + localeCounts.verified],
              ['all', 'Toutes les gratuites', freeCatalog.length],
            ]).map(([mode, label, count]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFilterMode(/** @type {FilterMode} */ (mode))}
                className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border transition cursor-pointer ${
                  filterMode === mode
                    ? 'border-brand-500/40 bg-brand-600/20 text-brand-100'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
                <span className="opacity-70">({count})</span>
              </button>
            ))}
          </div>

          <PickerMenu
            value={drafts[lang] || ''}
            options={voiceOptions}
            onChange={(voiceId) => setDrafts((d) => ({ ...d, [lang]: voiceId }))}
            placeholder={
              voiceOptions.length
                ? '— Choisir une voix —'
                : `Aucune voix native ${lang.toUpperCase()}`
            }
            searchPlaceholder="Nom, accent, langue, genre…"
            clearable
            searchable
          />

          {filterMode === 'native' && localeCounts.native === 0 && provider !== 'cartesia' && provider !== 'deepgram' && (
            <p className="text-[11px] text-amber-300/90 leading-relaxed flex gap-2">
              <Info size={14} className="shrink-0 mt-0.5" />
              <span>
                Aucune voix <strong className="text-amber-200">native {localeMeta?.label}</strong> dans
                ce compte. Sur le plan gratuit, la Voice Library n’est pas dispo via l’API —
                tu n’as surtout des voix EN. Passe en « Savent parler » (voix EN vérifiées FR/ES)
                ou ajoute une voix native dans My Voices (plan payant), puis recharge.
              </span>
            </p>
          )}

          {filterMode === 'verified' && (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Voix dont la langue principale est {localeMeta?.label}, ou marquées
              « verified » pour {lang.toUpperCase()} (souvent des premades anglaises
              multilingues — moins naturelles qu’une vraie voix native).
            </p>
          )}
        </div>

        {drafts[lang] && (
          <p className="text-[10px] text-slate-500 font-mono break-all">
            ID : {drafts[lang]}
            {voiceMeta(drafts[lang]) ? ` · ${voiceMeta(drafts[lang])}` : ''}
          </p>
        )}

        {voiceNeedsPaidApi(catalog.find((v) => v.voiceId === drafts[lang])) && (
          <p className="text-[11px] text-amber-300/95 leading-relaxed rounded-lg border border-amber-500/25 bg-amber-950/20 px-3 py-2">
            <strong className="text-amber-200">API payante</strong> — Enrick / Miquel (Voice Library)
            ne marchent pas en plan gratuit via l’API (erreur 402). Pour tester maintenant :
            filtre « Savent parler » → choisis une premade (ex. Matilda), ou upgrade ElevenLabs.
          </p>
        )}

        <label className="block text-xs text-slate-400 space-y-1">
          Texte de test ({localeMeta?.label}
          {provider === 'cartesia' ? ' — tags émotion Sonic' : provider === 'deepgram' ? ' — Aura (sans tags émotion)' : ''})
          <textarea
            rows={6}
            value={texts[lang]}
            onChange={(e) => setTexts((t) => ({ ...t, [lang]: e.target.value }))}
            className="input-field text-sm py-2 font-mono leading-relaxed resize-y min-h-[8rem]"
            placeholder="[calm] Bonjour…"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleTest(lang, { quick: false })}
            disabled={testing[lang] || !drafts[lang]}
            className="btn-primary text-sm py-2 px-4"
          >
            {testing[lang] ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            {testing[lang] && testProgress
              ? testProgress
              : 'Tester le script (complet)'}
          </button>
          <button
            type="button"
            onClick={() => handleTest(lang, { quick: true })}
            disabled={testing[lang] || !drafts[lang]}
            className="btn-secondary text-sm py-2 px-3"
            title="Phrase courte — contrôle rapide"
          >
            {testing[lang] ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Test rapide
          </button>
          <button
            type="button"
            onClick={() => resetScript(lang)}
            className="btn-secondary text-sm py-2 px-3"
            title="Recharger le script démo"
          >
            <RotateCcw size={14} />
            Script démo
          </button>
        </div>

        {provider === 'cartesia' && (
          <p className="text-[11px] text-slate-500">
            Tags Sonic :{' '}
            <span className="text-slate-400">
              [calm] [content] [curious] [excited] [happy] [confident] [sad] [scared] [angry] [mysterious] [surprised] [apologetic]
            </span>
          </p>
        )}

        <div className="pt-2 border-t border-white/10">
          {saveBar}
        </div>
      </div>

      <div className="zone-sunk rounded-xl border border-white/10 p-3 text-[11px] text-slate-500 leading-relaxed space-y-1.5">
        <p className="text-slate-400 font-medium flex items-center gap-1.5">
          <Info size={13} />
          {provider === 'cartesia' ? 'Cartesia Sonic' : provider === 'deepgram' ? 'Deepgram Aura' : 'Limites ElevenLabs (doc)'}
        </p>
        {provider === 'cartesia' ? (
          <>
            <p>
              {catalogNotes?.tip || (
                <>
                  TTS via Cartesia (plan free inclus) — voix natives FR / ES / EN.
                  STT : Deepgram Nova (live WS).
                </>
              )}
            </p>
            <p>
              Catalogue filtré : uniquement les voix utilisables sans upgrade API.
              {paidHidden > 0
                ? ` ${paidHidden} voix payantes (Library / My Voices) sont masquées.`
                : ''}
            </p>
          </>
        ) : provider === 'deepgram' ? (
          <>
            <p>
              {catalogNotes?.tip || (
                <>
                  TTS via Deepgram Aura-2 (WebSocket streaming) — crédits free généreux.
                  Deepgram Nova (STT) + Aura-2 (TTS). Karaoke : phrase en cours (horloge PCM).
                </>
              )}
            </p>
            <p>
              Voix natives FR / ES / EN listées. Active avec{' '}
              <span className="text-slate-300 font-mono">TTS_PROVIDER=deepgram</span>
              {' '}et <span className="text-slate-300 font-mono">DEEPGRAM_API_KEY</span>.
            </p>
          </>
        ) : (
          <>
            <p>
              {catalogNotes?.tip || (
                <>
                  Plan gratuit : Voice Library <em>non disponible via l’API</em> — surtout des
                  voix premade anglaises. Les modèles (eleven_v3) parlent FR/ES, mais une voix
                  <strong className="text-slate-300"> native</strong> FR/ES demande de l’ajouter
                  dans My Voices (souvent plan payant).
                </>
              )}
            </p>
            <p>
              Ici seules les voix <span className="text-slate-300">API gratuites</span> sont
              listées{paidHidden > 0 ? ` (${paidHidden} payantes masquées)` : ''}.
            </p>
          </>
        )}
      </div>

      {!catalog.length && (
        <p className="text-xs text-amber-300/90 zone-sunk rounded-xl border border-amber-500/20 p-3">
          {provider === 'cartesia'
            ? 'Aucune voix Cartesia. Vérifie CARTESIA_API_KEY, puis recharge.'
            : provider === 'deepgram'
              ? 'Aucune voix Deepgram. Vérifie DEEPGRAM_API_KEY et TTS_PROVIDER=deepgram, puis recharge.'
              : 'Aucune voix dans le compte ElevenLabs. Ajoute des voix dans My Voices, puis recharge.'}
        </p>
      )}
    </div>
  );
}
