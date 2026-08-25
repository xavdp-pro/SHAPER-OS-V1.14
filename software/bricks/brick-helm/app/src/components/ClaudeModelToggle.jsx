import { useMemo, useState } from 'react';
import { Brain, Zap } from 'lucide-react';
import { useLocale } from '../context/LocaleContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PickerMenu from './PickerMenu.jsx';
import { CLAUDE_PROFILE_PRESETS, GROUP_LABEL_KEYS } from '../lib/claudeModelPresets.js';

const THINKING_MODES = ['auto', 'on', 'off'];

const THINKING_LABEL_KEYS = {
  auto: 'model.claude.thinkingAuto',
  on: 'model.claude.thinkingOn',
  off: 'model.claude.thinkingOff',
};

function formatCredits(openrouter) {
  if (!openrouter?.configured) return null;
  if (openrouter.remaining == null) return null;
  const n = Number(openrouter.remaining);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(2)} $`;
}

/** Claude / LiteLLM model picker — grouped list, quick presets, OpenRouter status. */
export default function ClaudeModelToggle({ compact = false, menu = false }) {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const {
    claudeModel = 'or-kimi-k3',
    claudeThinking = 'auto',
    claudeModels = [],
    openrouter,
    setClaudeModel,
    setClaudeThinking,
  } = useSettings();
  const [saving, setSaving] = useState(false);

  const modelById = useMemo(() => {
    const map = new Map();
    for (const m of claudeModels) map.set(m.id, m);
    return map;
  }, [claudeModels]);

  const options = useMemo(() => {
    const list = (claudeModels.length
      ? claudeModels
      : [
        { id: 'or-kimi-k3', label: 'Kimi K3', group: 'openrouter_paid', hint: 'Top qualité', requiresOpenRouter: true },
        { id: 'minimax-m3', label: 'MiniMax M3', group: 'ollama', hint: 'Ollama Cloud' },
        { id: 'gpt-oss-20b', label: 'GPT-OSS 20B', group: 'ollama', hint: 'Ollama léger' },
      ]).filter((m) => !String(m.id || '').startsWith('groq-'));

    return list.map((m) => {
      const unavailable = m.available === false;
      const reason = m.unavailableReason || (
        m.requiresOpenRouter && !openrouter?.configured
          ? t('model.claude.orMissing')
          : null
      );
      const suffix = unavailable && reason ? ` — ${reason}` : '';
      const groupKey = GROUP_LABEL_KEYS[m.group] || GROUP_LABEL_KEYS.other;
      return {
        value: m.id,
        label: `${m.label || m.id}${suffix}`,
        hint: m.hint || m.id,
        group: m.group || 'other',
        groupLabel: m.groupLabel || t(groupKey),
        profile: m.profile,
        thinking: m.thinking,
        disabled: unavailable,
      };
    });
  }, [claudeModels, openrouter, t]);

  const currentMeta = modelById.get(claudeModel);

  const apply = async (model) => {
    if (saving || !setClaudeModel || model === claudeModel) return;
    const picked = options.find((o) => o.value === model);
    if (picked?.disabled) {
      pushToast(picked.label.split(' — ').slice(1).join(' — ') || t('model.claude.unavailable'), {
        type: 'error',
        duration: 8000,
      });
      return;
    }
    setSaving(true);
    const res = await setClaudeModel(model);
    setSaving(false);
    if (!res.ok) {
      pushToast(res.error || t('model.saveError'), { type: 'error', duration: 8000 });
      return;
    }
    const label = options.find((o) => o.value === res.claudeModel)?.label?.split(' — ')[0] || res.claudeModel;
    pushToast(label, { type: 'success' });
  };

  const applyThinking = async (mode) => {
    if (saving || !setClaudeThinking || mode === claudeThinking) return;
    setSaving(true);
    const res = await setClaudeThinking(mode);
    setSaving(false);
    if (!res.ok) {
      pushToast(res.error || t('model.saveError'), { type: 'error' });
      return;
    }
    pushToast(t(THINKING_LABEL_KEYS[mode] || THINKING_LABEL_KEYS.auto), { type: 'success' });
  };

  const orHint = openrouter && !openrouter.ok && openrouter.error
    ? openrouter.error
    : (openrouter?.lowCredits ? t('model.claude.lowCredits') : null);

  const creditsLine = formatCredits(openrouter);

  const presets = useMemo(() => CLAUDE_PROFILE_PRESETS.map((p) => {
    const meta = modelById.get(p.id);
    const unavailable = meta?.available === false;
    return { ...p, unavailable };
  }), [modelById]);

  return (
    <div className={`flex flex-col gap-1.5 ${menu ? 'items-stretch w-full' : 'items-end'}`}>
      {menu && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('model.claude.presets')}>
          {presets.map((p) => {
            const active = claudeModel === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={saving || p.unavailable}
                title={t(p.labelKey)}
                onClick={() => apply(p.id)}
                className={`claude-preset-chip ${active ? 'claude-preset-chip-active' : ''} ${
                  p.unavailable ? 'opacity-40 cursor-not-allowed' : ''
                }`}
              >
                {p.profile === 'fast' && <Zap size={11} className="shrink-0" aria-hidden />}
                {p.profile === 'planning' && <Brain size={11} className="shrink-0" aria-hidden />}
                {t(p.labelKey)}
              </button>
            );
          })}
        </div>
      )}

      {menu && (
        <div className="flex flex-col gap-1" role="group" aria-label={t('model.claude.thinkingMode')}>
          <span className="text-[9px] uppercase tracking-wide text-slate-500 px-0.5">
            {t('model.claude.thinkingMode')}
          </span>
          <div className="flex flex-wrap gap-1">
            {THINKING_MODES.map((mode) => {
              const active = claudeThinking === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={saving}
                  title={t(THINKING_LABEL_KEYS[mode])}
                  onClick={() => applyThinking(mode)}
                  className={`claude-preset-chip ${active ? 'claude-preset-chip-active' : ''}`}
                >
                  {mode === 'on' && <Brain size={11} className="shrink-0" aria-hidden />}
                  {t(THINKING_LABEL_KEYS[mode])}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <PickerMenu
        value={claudeModel}
        options={options}
        disabled={saving}
        searchable
        grouped
        tall={menu}
        inline={menu}
        searchPlaceholder={t('model.claude.search')}
        placeholder={t('model.claude.placeholder')}
        className={menu
          ? 'w-full'
          : `picker-compact ${compact ? 'w-[9rem]' : 'w-[11rem]'}`}
        onChange={apply}
      />

      {(currentMeta?.thinking || creditsLine) && menu && (
        <p className="text-[9px] text-slate-500 px-0.5 leading-tight" role="status">
          {currentMeta?.thinking && (
            <span className="text-violet-400/90">{t('model.claude.thinking')}: {currentMeta.thinking}</span>
          )}
          {currentMeta?.thinking && creditsLine ? ' · ' : null}
          {creditsLine ? `${t('model.claude.credits')}: ${creditsLine}` : null}
        </p>
      )}

      {orHint && (
        <p
          className={`text-[9px] text-amber-400/90 leading-tight ${
            menu ? 'text-left px-0.5' : 'max-w-[11rem] text-right'
          }`}
          role="status"
        >
          {orHint}
        </p>
      )}
    </div>
  );
}
