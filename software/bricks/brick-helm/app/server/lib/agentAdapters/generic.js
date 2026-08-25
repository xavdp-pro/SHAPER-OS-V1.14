/** Fallback for future CLI plugins sharing the cursor-like HTTP contract. */

export const kind = 'generic';

export const capabilities = {
  stopRun: true,
  resetSession: true,
  bindWorkspace: false,
  modelField: 'passthrough',
  transportLabel: 'agent-bridge',
};

/**
 * @param {import('./types.js').AdapterContext} ctx
 */
export async function resetSession(ctx) {
  const { apiFetch, target, conversationName } = ctx;
  try {
    return await apiFetch(target, '/api/conversations/reset', {
      method: 'POST',
      body: JSON.stringify({ conversation: conversationName }),
    });
  } catch (err) {
    if (err.status === 404) {
      return apiFetch(target, '/api/conversations/delete', {
        method: 'POST',
        body: JSON.stringify({ conversation: conversationName }),
      });
    }
    throw err;
  }
}

/**
 * @param {import('./types.js').AdapterContext} ctx
 */
export async function stopRun(ctx, { all = false } = {}) {
  const { apiFetch, target, conversationName } = ctx;
  try {
    const body = all ? { all: true } : { conversation: conversationName };
    return await apiFetch(target, '/api/conversations/stop', {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: 15000,
    });
  } catch (err) {
    if (err.status === 404) {
      return { ok: true, stopped: false, note: 'generic: no stop endpoint' };
    }
    throw err;
  }
}

/**
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
