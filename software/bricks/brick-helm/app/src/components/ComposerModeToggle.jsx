import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { useLocale } from '../context/LocaleContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PickerMenu from './PickerMenu.jsx';

const EFFORTS = ['low', 'medium', 'high'];

const EFFORT_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  full: 'Full',
};

/** Model picker: family + effort + fast toggle — PickerMenu, no native select. */
export default function ComposerModeToggle({ compact = false, menu = false }) {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const {
    modelFamily = 'gemini-3.7-flash',
    modelEffort = 'low',
    modelFast = true,
    modelFamilies = [],
    setModelSelection,
  } = useSettings();
  const [saving, setSaving] = useState(false);

    const families = modelFamilies.length
    ? modelFamilies
    : [
      { id: 'opencode/nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning (Gratuit)', efforts: ['full'], supportsFast: false },
      { id: 'opencode/big-pickle', label: 'Big Pickle (Gratuit)', efforts: ['full'], supportsFast: false },
      { id: 'opencode/hy3-free', label: 'HY3 (Gratuit)', efforts: ['full'], supportsFast: false },
      { id: 'opencode/mimo-v2.5-free', label: 'Mimo V2.5 (Gratuit)', efforts: ['full'], supportsFast: false },
      { id: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra (Gratuit)', efforts: ['full'], supportsFast: false },
      { id: 'opencode/muse-spark-1.2-contributor-free', label: 'Muse Spark 1.2 (Gratuit)', efforts: ['full'], supportsFast: false },
      { id: 'opencode/x-preview-f-free', label: 'X-Preview (Gratuit)', efforts: ['full'], supportsFast: false },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3 (Direct)', efforts: ['full'], supportsFast: false },
      { id: 'deepseek/deepseek-reasoner', label: 'DeepSeek R1 Raisonnement', efforts: ['full'], supportsFast: false },
    ];

  const current = families.find((f) => f.id === modelFamily) || families[0];
  const efforts = current?.efforts?.length ? current.efforts : ['full'];
  const showEffort = efforts.length > 1 && efforts[0] !== 'full';
  const showFast = Boolean(current?.supportsFast);

  const familyOptions = useMemo(
    () => families.map((f) => ({ value: f.id, label: f.label })),
    [families],
  );

  const effortOptions = useMemo(
    () => efforts.map((e) => {
      const key = `model.effort.${e}`;
      const translated = t(key);
      return { value: e, label: translated && translated !== key ? translated : (EFFORT_LABELS[e] || e) };
    }),
    [efforts, t],
  );

  const apply = async (patch) => {
    if (saving || !setModelSelection) return;
    setSaving(true);
    const res = await setModelSelection(patch);
    setSaving(false);
    if (!res.ok) {
      pushToast(res.error || t('model.saveError'), { type: 'error' });
      return;
    }
    pushToast(res.modelLabel || res.composerModel || 'Modèle enregistré', { type: 'success' });
  };

  const pickerClass = menu
    ? 'w-full'
    : `picker-compact ${compact ? 'w-[8rem]' : 'w-[10rem]'}`;

  return (
    <div
      className={menu
        ? 'flex flex-col gap-1.5 w-full'
        : 'flex items-center gap-1.5 shrink-0'}
    >
      <PickerMenu
        value={modelFamily}
        options={familyOptions}
        disabled={saving}
        searchable
        inline={menu}
        searchPlaceholder="Rechercher un modèle…"
        placeholder="Modèle"
        className={pickerClass}
        onChange={(family) => {
          const selectedFamily = families.find((f) => f.id === family);
          const defaultEffort = selectedFamily?.efforts?.[0] || 'low';
          apply({
            family,
            effort: selectedFamily?.efforts?.includes(modelEffort) ? modelEffort : defaultEffort,
            fast: Boolean(selectedFamily?.supportsFast && modelFast),
          });
        }}
      />

      {showEffort && (
        <PickerMenu
          value={modelEffort}
          options={effortOptions}
          disabled={saving}
          searchable={false}
          inline={menu}
          placeholder="Force de réflexion"
          className={menu
            ? 'w-full'
            : `picker-compact ${compact ? 'w-[5.5rem]' : 'w-[6.5rem]'}`}
          onChange={(effort) => apply({ family: modelFamily, effort, fast: modelFast })}
        />
      )}

      {showFast && (
        <button
          type="button"
          onClick={() => apply({ family: modelFamily, effort: modelEffort, fast: !modelFast })}
          disabled={saving}
          title={modelFast ? t('model.fastHint') : t('model.fullHint')}
          aria-pressed={modelFast}
          className={`flex items-center gap-1.5 rounded-md transition cursor-pointer ${
            menu ? 'h-9 w-full justify-center px-2 text-xs' : (compact ? 'h-8 px-1.5 text-[10px]' : 'h-9 px-2 text-xs')
          } ${
            modelFast
              ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40'
              : 'bg-white/5 text-slate-300 ring-1 ring-white/15 hover:bg-white/10'
          } disabled:opacity-50`}
        >
          <Zap size={compact || menu ? 12 : 14} className={modelFast ? 'text-amber-300' : 'text-slate-400'} />
          <span className="font-semibold uppercase tracking-wide">{t('model.fast')}</span>
        </button>
      )}
    </div>
  );
}
