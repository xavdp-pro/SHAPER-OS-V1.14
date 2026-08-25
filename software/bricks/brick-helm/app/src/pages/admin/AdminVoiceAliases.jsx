import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../context/LocaleContext.jsx';
import { AudioLines, Loader2, Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import { listVoiceAliases, createVoiceAlias, deleteVoiceAlias } from '../../api/client.js';

/**
 * Voice aliases — spoken forms → canonical infrastructure names.
 * "cas zéro" → gbs-k0: the post-STT corrector applies these aliases before sending.
 */
export default function AdminVoiceAliases() {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const [aliases, setAliases] = useState([]);
  const [canonicals, setCanonicals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftAlias, setDraftAlias] = useState('');
  const [draftCanonical, setDraftCanonical] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const { ok, data } = await listVoiceAliases();
    if (ok) {
      setAliases(Array.isArray(data?.aliases) ? data.aliases : []);
      setCanonicals(Array.isArray(data?.canonicals) ? data.canonicals : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const alias = draftAlias.trim();
    const canonical = draftCanonical.trim();
    if (!alias || !canonical) {
      pushToast(t('toast.aliasNeedBoth'), { type: 'error' });
      return;
    }
    setSaving(true);
    const { ok, data } = await createVoiceAlias(alias, canonical);
    setSaving(false);
    if (!ok) {
      pushToast(data?.error || 'Enregistrement échoué', { type: 'error' });
      return;
    }
    setDraftAlias('');
    setDraftCanonical('');
    pushToast(`${t('toast.aliasSaved')} : « ${alias} » → ${canonical}`, { type: 'success' });
    void reload();
  };

  const handleDelete = async (row) => {
    const { ok, data } = await deleteVoiceAlias(row.id);
    if (!ok) {
      pushToast(data?.error || 'Suppression échouée', { type: 'error' });
      return;
    }
    pushToast(`${t('toast.aliasDeleted')} : « ${row.alias} »`, { type: 'success' });
    void reload();
  };

  return (
    <div className="space-y-5">
      <section className="glass rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <AudioLines size={16} className="text-brand-400 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-white">Alias vocaux</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Formes entendues au micro → noms canoniques. Ex. « cas zéro » → gbs-k0.
              Appliqué automatiquement avant l’envoi, et répété dans l’accusé vocal.
            </p>
          </div>
        </div>

        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
          <input
            className="input-field flex-1 text-sm py-2.5"
            placeholder="Forme parlée (ex. cas zéro)"
            value={draftAlias}
            onChange={(e) => setDraftAlias(e.target.value)}
          />
          <input
            className="input-field flex-1 text-sm py-2.5"
            placeholder="Nom canonique (ex. gbs-k0)"
            value={draftCanonical}
            onChange={(e) => setDraftCanonical(e.target.value)}
            list="voice-canonicals"
          />
          <datalist id="voice-canonicals">
            {canonicals.map((c) => <option key={c} value={c} />)}
          </datalist>
          <button type="submit" className="btn-primary text-xs py-2.5 px-4 shrink-0" disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Ajouter
          </button>
        </form>

        {loading ? (
          <p className="text-xs text-slate-500">Chargement…</p>
        ) : !aliases.length ? (
          <p className="text-xs text-slate-600">
            Aucun alias — ajoute les noms que le micro comprend de travers.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {aliases.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2">
                <span className="text-sm text-slate-300 flex-1 min-w-0 truncate">« {row.alias} »</span>
                <span className="text-xs text-slate-500 shrink-0">→</span>
                <code className="text-sm text-brand-300 flex-1 min-w-0 truncate">{row.canonical}</code>
                <button
                  type="button"
                  onClick={() => handleDelete(row)}
                  className="btn-icon text-slate-500 hover:text-red-400"
                  aria-label={`Supprimer l'alias ${row.alias}`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass rounded-2xl p-4 sm:p-5 space-y-2">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Noms connus (boostés au micro)
        </h3>
        <p className="text-xs text-slate-500">
          Nœuds CLI + hôtes SSH + canoniques des alias — envoyés au STT pour améliorer la reconnaissance.
          Au micro tu peux aussi épeler : « épelle golf bravo sierra tiret hôtel un » → gbs-h1.
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {canonicals.map((c) => (
            <code key={c} className="text-[11px] px-2 py-1 rounded-lg bg-black/30 border border-white/10 text-slate-300">
              {c}
            </code>
          ))}
          {!canonicals.length && <p className="text-xs text-slate-600">Aucun nom détecté.</p>}
        </div>
      </section>
    </div>
  );
}
