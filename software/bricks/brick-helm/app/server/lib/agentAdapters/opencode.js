/** OpenCode agent bridge — opencode CLI via :4340 (opencode-bridge). */

export const kind = 'opencode';

export const capabilities = {
  stopRun: true,
  resetSession: true,
  // The bridge scopes each session to a directory, so the console can bind a
  // workspace per conversation and the agent runs there, not in a scratch dir.
  bindWorkspace: true,
  modelField: 'model',
  transportLabel: 'opencode-cli',
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
 * Models are `provider/model` (e.g. opencode/nemotron-3-ultra-free); the bridge
 * splits them, so pass the id through untouched.
 * @param {import('./types.js').InjectBuildContext} ctx
 */
export function buildInjectBody(ctx) {
  const { conversationName, message, attachments, model } = ctx;
  const body = {
    conversation: conversationName,
    message,
    attachments,
  };
  if (model) body.model = model;
  return body;
}
