/**
 * Build agy child-process env: ANTIGRAVITY_API_KEY only — never GEMINI/GOOGLE (freeze/429).
 */
export function resolveAntigravityApiKey(env = process.env) {
  const key = env.ANTIGRAVITY_API_KEY || env.AGY_API_KEY || '';
  if (!key || !key.startsWith('AQ.')) return '';
  return key;
}

export function buildAgySpawnEnv(baseEnv = process.env, extra = {}) {
  const key = resolveAntigravityApiKey({ ...baseEnv, ...extra });
  const env = { ...baseEnv, ...extra };
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.AGY_API_KEY;
  if (key) env.ANTIGRAVITY_API_KEY = key;
  else delete env.ANTIGRAVITY_API_KEY;
  return env;
}

export function hasAntigravityApiKey(env = process.env) {
  return Boolean(resolveAntigravityApiKey(env));
}
