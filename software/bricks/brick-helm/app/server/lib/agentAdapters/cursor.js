/** Cursor agent bridge — cursor-agent CLI via :4310 */

export const kind = 'cursor';

export const capabilities = {
  stopRun: true,
  resetSession: true,
  bindWorkspace: true,
  modelField: 'composer',
  transportLabel: 'cursor-agent-cli',
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
export function buildInjectBody(ctx) {
  const { conversationName, message, attachments, model } = ctx;
  return {
    conversation: conversationName,
    message,
    attachments,
    model,
  };
}
