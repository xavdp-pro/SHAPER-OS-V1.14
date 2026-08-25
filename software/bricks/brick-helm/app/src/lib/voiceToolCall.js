import { getActiveConversation, injectMessage } from '../api/client.js';

const TOOL_NAME = 'send_to_cursor';

/**
 * Handle Hume EVI tool calls — bridge voice commands to Cursor CLI inject.
 * @param {import('@humeai/voice-react').ToolCall} toolCall
 * @param {{ success: (content: unknown) => object, error: (e: object) => object }} send
 */
export async function handleVoiceToolCall(toolCall, send) {
  if (toolCall.name !== TOOL_NAME) {
    return send.error({
      error: 'Unknown tool',
      code: 'UNKNOWN_TOOL',
      level: 'warn',
      content: `Outil inconnu: ${toolCall.name}`,
    });
  }

  let params = {};
  try {
    params = JSON.parse(toolCall.parameters || '{}');
  } catch {
    return send.error({
      error: 'Invalid parameters JSON',
      code: 'INVALID_PARAMS',
      level: 'warn',
      content: 'Paramètres invalides pour send_to_cursor.',
    });
  }

  const message = String(params.message || '').trim();
  if (!message) {
    return send.error({
      error: 'Missing message',
      code: 'MISSING_MESSAGE',
      level: 'warn',
      content: 'Le paramètre message est requis.',
    });
  }

  try {
    const { ok, data } = await injectMessage(message);
    if (!ok) {
      return send.error({
        error: data?.error || 'Inject failed',
        code: 'CURSOR_INJECT_FAILED',
        level: 'error',
        content: data?.error || 'Envoi vers Cursor échoué.',
      });
    }

    const conv = getActiveConversation() || 'défaut';
    return send.success(
      `Commande envoyée au moteur Cursor. Travail en cours sur le workspace KovZu (conversation ${conv}).`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return send.error({
      error: msg,
      code: 'TOOL_EXCEPTION',
      level: 'error',
      content: `Erreur lors de l'envoi vers Cursor: ${msg}`,
    });
  }
}
