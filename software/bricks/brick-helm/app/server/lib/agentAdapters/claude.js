/** Claude Code bridge — Claude CLI + LiteLLM via :4320 */

export const kind = 'claude';

export const capabilities = {
  stopRun: false,
  resetSession: true,
  bindWorkspace: true,
  modelField: 'litellm',
  transportLabel: 'claude-bridge',
};

/**
 * Claude bridge has no /reset — delete registry entry to start fresh.
 * @param {import('./types.js').AdapterContext} ctx
 */
export async function resetSession(ctx) {
  const { apiFetch, target, conversationName } = ctx;
  return apiFetch(target, '/api/conversations/delete', {
    method: 'POST',
    body: JSON.stringify({ conversation: conversationName }),
  });
}

/**
 * No stop endpoint — SSE ends on response_complete.
 * @param {import('./types.js').AdapterContext} _ctx
 */
export async function stopRun(_ctx) {
  return {
    ok: true,
    stopped: false,
    note: 'claude-bridge: no stop endpoint',
  };
}

/**
 * @param {import('./types.js').InjectBuildContext} ctx
 */
export function buildInjectBody(ctx) {
  const { conversationName, message, attachments, model, thinking } = ctx;
  return {
    conversation: conversationName,
    message,
    attachments,
    model,
    thinking,
  };
}
