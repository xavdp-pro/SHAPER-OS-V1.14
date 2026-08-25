/** Antigravity agent bridge — agy CLI via :4330 */

export const kind = 'agy';

export const capabilities = {
  stopRun: true,
  resetSession: true,
  bindWorkspace: true,
  modelField: 'composer',
  transportLabel: 'antigravity-cli',
};

/**
 * @param {import('./types.js').AdapterContext} ctx
 */
export async function resetSession(ctx) {
  const { apiFetch, target, conversationName } = ctx;
  return apiFetch(target, '/api/conversations/reset', {
    method: 'POST',
    body: JSON.stringify({ conversation: conversationName }),
  });
}

/**
 * @param {import('./types.js').AdapterContext} ctx
 */
export async function stopRun(ctx, { all = false } = {}) {
  const { apiFetch, target, conversationName } = ctx;
  const body = all ? { all: true } : { conversation: conversationName };
  return apiFetch(target, '/api/conversations/stop', {
    method: 'POST',
    body: JSON.stringify(body),
    timeout: 15000,
  });
}

/**
 * @param {import('./types.js').InjectBuildContext} ctx
 */
/** Antigravity CLI requires --model gemini-X-flash-low (effort suffix). */
export function normalizeAgyModel(model) {
  const raw = String(model || '').trim();
  if (!raw) return 'gemini-3.7-flash-low';
  if (/^gemini-3\.\d+-(flash|pro)$/.test(raw)) return `${raw}-low`;
  return raw;
}

export function buildInjectBody(ctx) {
  const { conversationName, message, attachments, model } = ctx;
  return {
    conversation: conversationName,
    message,
    attachments,
    model: normalizeAgyModel(model),
  };
}
