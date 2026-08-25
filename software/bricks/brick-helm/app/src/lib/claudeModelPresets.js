/** Quick picks for Claude / LiteLLM model selector (UI only). */
export const CLAUDE_PROFILE_PRESETS = [
  { id: 'or-kimi-k3', labelKey: 'model.claude.presetTop', profile: 'top' },
  { id: 'or-deepseek-v4-flash', labelKey: 'model.claude.presetFast', profile: 'fast' },
  { id: 'or-deepseek-v4-pro', labelKey: 'model.claude.presetValue', profile: 'value' },
  { id: 'or-kimi-k2.7-code', labelKey: 'model.claude.presetCode', profile: 'code' },
  { id: 'or-glm-5.2', labelKey: 'model.claude.presetPlan', profile: 'planning' },
  { id: 'or-qwen-coder', labelKey: 'model.claude.presetFree', profile: 'free' },
  { id: 'claude-haiku-4-5-20251001', labelKey: 'model.claude.presetHaiku', profile: 'menu' },
];

export const GROUP_LABEL_KEYS = {
  openrouter_paid: 'model.claude.groupPaid',
  openrouter_free: 'model.claude.groupFree',
  ollama: 'model.claude.groupOllama',
  claude_alias: 'model.claude.groupAlias',
  other: 'model.claude.groupOther',
};
