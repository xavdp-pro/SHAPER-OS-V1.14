import { getAgentPlugin } from './agentPlugins.js';
import { sortClaudeModels } from './claudeModelCatalog.js';

const PLACEHOLDER_MARKERS = ['your-openrouter', 'changeme', 'replace-me'];

export function isOpenRouterModel(modelId) {
  const id = String(modelId || '').trim();
  return id.startsWith('or-');
}

/** Groq is reserved for voice ack in helm-v2 API — never an agent model. */
export function isGroqAgentModel(modelId) {
  return String(modelId || '').trim().startsWith('groq-');
}

export function openRouterKeyConfigured(key = process.env.OPENROUTER_API_KEY) {
  const k = String(key || '').trim();
  if (!k) return false;
  const lower = k.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((m) => lower.includes(m))) return false;
  return k.startsWith('sk-or-');
}

/** Fetch OpenRouter credits via claude-bridge (key lives in bridge .env). */
export async function fetchOpenRouterStatus() {
  const plugin = getAgentPlugin('claude');
  if (!plugin?.url) {
    return {
      configured: false,
      ok: false,
      error: 'Bridge Claude indisponible',
      remaining: null,
      totalCredits: null,
    };
  }
  try {
    const res = await fetch(`${plugin.url.replace(/\/$/, '')}/api/credits`, {
      headers: plugin.token ? { Authorization: `Bearer ${plugin.token}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const configured = openRouterKeyConfigured() || Boolean(data.total_credits);
      return {
        configured,
        ok: false,
        error: data.error || `HTTP ${res.status}`,
        remaining: null,
        totalCredits: null,
      };
    }
    const configured = openRouterKeyConfigured()
      || Boolean(data.ok)
      || typeof data.total_credits === 'number';
    const total = typeof data.total_credits === 'number' ? data.total_credits : null;
    const usage = typeof data.usage === 'number' ? data.usage : null;
    const remaining = typeof data.remaining === 'number'
      ? data.remaining
      : (total != null && usage != null ? Math.max(0, total - usage) : null);
    let error = null;
    if (!configured) {
      error = 'OPENROUTER_API_KEY manquante ou invalide (bridge/claude/.env)';
    } else if (data.ok === false && data.error) {
      error = String(data.error);
    } else if (remaining != null && remaining <= 0) {
      error = 'Crédits OpenRouter épuisés — recharge sur openrouter.ai';
    }
    const ok = configured && !error;
    return {
      configured,
      ok,
      error,
      remaining,
      totalCredits: total,
      usage,
      lowCredits: remaining != null && remaining > 0 && remaining < 0.5,
    };
  } catch (err) {
    return {
      configured: openRouterKeyConfigured(),
      ok: false,
      error: err.message || 'OpenRouter injoignable',
      remaining: null,
      totalCredits: null,
    };
  }
}

export function decorateClaudeModels(models, orStatus) {
  const list = Array.isArray(models) ? models : [];
  const configured = Boolean(orStatus?.configured);
  const creditsOk = Boolean(orStatus?.ok);
  const decorated = list.map((m) => {
    const id = m.id || m.value || m;
    const needsOr = isOpenRouterModel(id);
    const available = m.available != null
      ? Boolean(m.available)
      : (!needsOr || (configured && creditsOk));
    let unavailableReason = m.unavailableReason || null;
    if (!unavailableReason && needsOr && !configured) {
      unavailableReason = 'Clé OpenRouter manquante';
    } else if (!unavailableReason && needsOr && configured && !creditsOk) {
      unavailableReason = orStatus?.error || 'Crédits OpenRouter insuffisants';
    }
    return {
      ...m,
      id,
      label: m.label || id,
      group: m.group || null,
      groupLabel: m.groupLabel || null,
      hint: m.hint || null,
      profile: m.profile || null,
      thinking: m.thinking || null,
      sort: m.sort ?? null,
      requiresOpenRouter: needsOr,
      available,
      unavailableReason,
    };
  });
  return sortClaudeModels(decorated);
}

/** User-facing French error for agent inject / model failures. */
export function formatAgentModelError(err, { model } = {}) {
  const raw = String(err?.message || err?.data?.error || err || '').trim();
  const lower = raw.toLowerCase();
  const needsOr = isOpenRouterModel(model);

  if (needsOr && (
    lower.includes('missing authentication')
    || lower.includes('openrouter')
    || lower.includes('401')
    || lower.includes('authenticationerror')
  )) {
    return 'OpenRouter : clé API manquante ou invalide — configure OPENROUTER_API_KEY dans bridge/claude/.env';
  }
  if (lower.includes('402') || lower.includes('insufficient') || lower.includes('credit')
    || lower.includes('quota') || lower.includes('balance')) {
    return 'OpenRouter : crédits insuffisants — recharge ton compte sur openrouter.ai';
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Limite de débit atteinte — réessaie dans quelques secondes';
  }
  if (needsOr && raw) {
    return `Kimi / OpenRouter : ${raw}`;
  }
  return raw || 'Envoi échoué';
}
