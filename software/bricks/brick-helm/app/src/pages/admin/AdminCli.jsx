import { useState } from 'react';
import { Loader2, Terminal, Cpu, Check } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useLocale } from '../../context/LocaleContext.jsx';

const CLI_MODELS = {
  opencode: [
    { id: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra (Gratuit · 1M Ctx)' },
    { id: 'opencode/nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning (Gratuit · 250 t/s)' },
    { id: 'opencode/mimo-v2.5-free', label: 'MiMo V2.5 (Gratuit · Multimodal)' },
    { id: 'opencode/laguna-s-2.1-free', label: 'Laguna S 2.1 (Gratuit · Docs)' },
    { id: 'opencode/hy3-free', label: 'HY3 (Gratuit · Polyvalent)' },
    { id: 'opencode/big-pickle', label: 'Big Pickle (Gratuit · Raisonnement)' },
  ],
  agy: [
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (Défaut)' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Haute Précision)' },
    { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet (AGY)' },
  ],
  cursor: [
    { id: 'composer-2.5', label: 'Composer 2.5 (Défaut)' },
    { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'gpt-4o', label: 'GPT-4o' },
  ],
};

const CLI_CONFIGS = [
  { id: 'opencode', label: 'OpenCode Souverain', hint: 'Moteur IA libre & local (Modèles gratuits Zen)' },
  { id: 'agy', label: 'Google Antigravity (AGY)', hint: 'Moteur agentique multi-outils & Gemini' },
  { id: 'cursor', label: 'Cursor CLI Composer', hint: 'Génération de code & refactoring' },
];

export default function AdminCli() {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const {
    enabledPlugins = {},
    agentPlugin,
    defaultModels = {},
    setEnabledPlugins,
    setDefaultEngineModel,
  } = useSettings();
  const [toggling, setToggling] = useState('');
  const [savingModel, setSavingModel] = useState('');

  const handleToggleCli = async (id, nextOn) => {
    if (!setEnabledPlugins || toggling) return;
    const enabledCount = Object.values(enabledPlugins).filter(Boolean).length;
    if (!nextOn && enabledCount <= 1 && enabledPlugins[id]) {
      pushToast(t('admin.cli.minOne') || 'Au moins un moteur doit rester actif', { type: 'error' });
      return;
    }
    setToggling(id);
    const res = await setEnabledPlugins({ [id]: nextOn });
    setToggling('');
    if (!res.ok) {
      pushToast(res.error || t('admin.cli.toggleError'), { type: 'error' });
      return;
    }
    const label = CLI_CONFIGS.find((c) => c.id === id)?.label || id;
    pushToast(
      nextOn ? `${label} activé` : `${label} désactivé`,
      { type: 'success' },
    );
  };

  const handleModelChange = async (engineId, modelId) => {
    if (!setDefaultEngineModel || savingModel) return;
    setSavingModel(engineId);
    const res = await setDefaultEngineModel(engineId, modelId);
    setSavingModel('');
    if (!res.ok) {
      pushToast(res.error || 'Erreur lors du changement de modèle', { type: 'error' });
      return;
    }
    pushToast(`Modèle par défaut mis à jour pour ${engineId}`, { type: 'success' });
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div className="zone-sunk rounded-2xl border border-white/10 p-4 sm:p-5 space-y-4">
        <div>
          <p className="text-sm font-medium text-white flex items-center gap-2">
            <Terminal size={16} className="text-brand-400" />
            Moteurs CLI & Modèles par Défaut
          </p>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Activez les moteurs d'agents disponibles et choisissez le modèle IA utilisé par défaut lors de la création d'une nouvelle session.
          </p>
        </div>

        <div className="space-y-3" role="list">
          {CLI_CONFIGS.map((p) => {
            const on = enabledPlugins[p.id] !== false;
            const busy = toggling === p.id;
            const isSaving = savingModel === p.id;
            const models = CLI_MODELS[p.id] || [];
            const currentDefault = defaultModels[p.id] || models[0]?.id || '';

            return (
              <div
                key={p.id}
                className={`rounded-xl border p-3.5 transition space-y-3 ${
                  on
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-white/10 bg-black/20 opacity-75'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white flex items-center gap-2">
                      {p.label}
                      {agentPlugin === p.id && (
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-400 border border-brand-500/30">
                          Actif
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">{p.hint}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={busy}
                    onClick={() => handleToggleCli(p.id, !on)}
                    className={`relative shrink-0 h-7 w-12 rounded-full transition cursor-pointer disabled:opacity-50 ${
                      on ? 'bg-emerald-500/80' : 'bg-slate-600'
                    }`}
                    title={on ? `Désactiver ${p.label}` : `Activer ${p.label}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
                        on ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                    {busy && (
                      <Loader2 size={12} className="absolute inset-0 m-auto animate-spin text-slate-800" />
                    )}
                  </button>
                </div>

                {on && models.length > 0 && (
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-3">
                    <label className="text-xs text-slate-400 flex items-center gap-1.5 shrink-0">
                      <Cpu size={13} className="text-brand-400" />
                      Modèle par défaut :
                    </label>
                    <div className="relative flex-1 max-w-[280px]">
                      <select
                        value={currentDefault}
                        disabled={isSaving}
                        onChange={(e) => handleModelChange(p.id, e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white outline-none focus:border-brand-500 cursor-pointer disabled:opacity-50"
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      {isSaving && (
                        <Loader2 size={12} className="absolute right-2 top-2 animate-spin text-brand-400" />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
