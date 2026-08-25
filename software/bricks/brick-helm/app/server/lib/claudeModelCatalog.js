/** Client/server mirror of bridge model groups (picker UI). */
export const GROUP_ORDER = [
  'openrouter_paid',
  'openrouter_free',
  'ollama',
  'claude_alias',
  'other',
];

export const PROFILE_PRESETS = [
  { id: 'or-kimi-k3', labelKey: 'model.claude.presetTop', profile: 'top' },
  { id: 'or-deepseek-v4-flash', labelKey: 'model.claude.presetFast', profile: 'fast' },
  { id: 'or-deepseek-v4-pro', labelKey: 'model.claude.presetValue', profile: 'value' },
  { id: 'or-kimi-k2.7-code', labelKey: 'model.claude.presetCode', profile: 'code' },
  { id: 'or-glm-5.2', labelKey: 'model.claude.presetPlan', profile: 'planning' },
  { id: 'or-qwen-coder', labelKey: 'model.claude.presetFree', profile: 'free' },
  { id: 'claude-haiku-4-5-20251001', labelKey: 'model.claude.presetHaiku', profile: 'menu' },
];

export function sortClaudeModels(models) {
  const groupRank = Object.fromEntries(GROUP_ORDER.map((g, i) => [g, i]));
  return [...models].sort((a, b) => {
    const ga = groupRank[a.group] ?? 99;
    const gb = groupRank[b.group] ?? 99;
    if (ga !== gb) return ga - gb;
    return (a.sort ?? 999) - (b.sort ?? 999) || String(a.label).localeCompare(String(b.label));
  });
}
