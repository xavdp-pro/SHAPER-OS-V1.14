import { Router } from 'express';
import { authMiddleware } from './auth.js';
import {
  getSettings,
  setAgentName,
  setAppName,
  setVoiceIds,
  setComposerFast,
  setModelSelection,
  setAgentPlugin,
  setClaudeModel,
  setClaudeThinking,
  setEnabledPlugins,
  normalizeAgentName,
  normalizeAppName,
  composerModelForFast,
  setTtsProvider,
  setDefaultEngineModel,
} from '../lib/settingsStore.js';
import { listAgentPlugins, probeAllPlugins, getAgentPlugin, isCliEnginePlugin } from '../lib/agentPlugins.js';
import { getAdapterForPlugin } from '../lib/agentAdapters/index.js';
import {
  decorateClaudeModels,
  fetchOpenRouterStatus,
  formatAgentModelError,
  isGroqAgentModel,
  isOpenRouterModel,
} from '../lib/openrouterStatus.js';
import { getUser } from '../lib/usersStore.js';
import { canManageDemoVoices } from '../lib/demoAdmin.js';
import { availableTtsProviders, resolveTtsProvider } from '../lib/ttsProvider.js';

async function requireAdmin(req, res) {
  const user = await getUser(Number(req.user?.sub));
  if (!user || user.status !== 'active' || user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

async function requireVoiceAdmin(req, res) {
  const user = await getUser(Number(req.user?.sub));
  if (!canManageDemoVoices(user)) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

async function fetchClaudeModels() {
  const plugin = getAgentPlugin('claude');
  if (!plugin?.url) return { models: [], defaultModel: null };
  try {
    const res = await fetch(`${plugin.url}/api/models`, {
      headers: plugin.token ? { Authorization: `Bearer ${plugin.token}` } : {},
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { models: [], defaultModel: null };
    return {
      models: Array.isArray(data.models) ? data.models.filter((m) => !isGroqAgentModel(m.id)) : [],
      defaultModel: data.default_model || null,
    };
  } catch {
    return { models: [], defaultModel: null };
  }
}

async function settingsPayload(extra = {}) {
  const settings = await getSettings();
  const enabled = settings.enabledPlugins || {};
  const plugins = listAgentPlugins()
    .filter(isCliEnginePlugin)
    .map((p) => {
    const adapter = getAdapterForPlugin(p);
    const isEnabled = enabled[p.id] !== false;
    return {
      id: p.id,
      url: p.url,
      kind: p.kind,
      capabilities: adapter.capabilities,
      enabled: isEnabled,
    };
  });
  const claude = await fetchClaudeModels();
  const openrouter = await fetchOpenRouterStatus();
  return {
    ok: true,
    ...settings,
    plugins,
    /** Console picker: only CLIs turned on in admin. */
    pluginsActive: plugins.filter((p) => p.enabled),
    claudeModels: decorateClaudeModels(claude.models, openrouter),
    claudeDefaultModel: claude.defaultModel,
    openrouter,
    ...extra,
  };
}

const router = Router();

router.get('/settings', authMiddleware, async (_req, res) => {
  try {
    res.json(await settingsPayload());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Settings unavailable' });
  }
});

router.get('/plugins', authMiddleware, async (_req, res) => {
  try {
    const probes = await probeAllPlugins();
    res.json({
      ok: true,
      plugins: probes
        .filter(isCliEnginePlugin)
        .map((p) => {
        const adapter = getAdapterForPlugin(p);
        return {
          id: p.id,
          url: p.url,
          kind: p.kind,
          capabilities: adapter.capabilities,
          online: Boolean(p.probe?.ok),
          error: p.probe?.error || null,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Plugins unavailable' });
  }
});

router.patch('/settings', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const out = { ok: true };
    let touched = false;

    const wantsVoices = body.voices && typeof body.voices === 'object';
    const wantsTts = body.ttsProvider != null || body.tts_provider != null;
    const wantsAdminOnly = (
      body.agentName != null || body.agent_name != null
      || body.appName != null || body.app_name != null
      || (body.enabledPlugins != null && typeof body.enabledPlugins === 'object')
      || wantsTts
    );
    if (wantsAdminOnly && !(await requireAdmin(req, res))) return;
    if (wantsVoices && !(await requireVoiceAdmin(req, res))) return;

    if (body.agentName != null || body.agent_name != null) {
      out.agentName = await setAgentName(body.agentName ?? body.agent_name);
      out.normalizedAgent = normalizeAgentName(out.agentName);
      touched = true;
    }

    if (body.appName != null || body.app_name != null) {
      out.appName = await setAppName(body.appName ?? body.app_name);
      out.normalizedApp = normalizeAppName(out.appName);
      touched = true;
    }

    if (body.voices && typeof body.voices === 'object') {
      out.voices = await setVoiceIds(body.voices);
      touched = true;
    }

    if (
      body.modelFamily != null
      || body.modelEffort != null
      || body.modelFast != null
      || body.family != null
      || body.effort != null
    ) {
      const sel = await setModelSelection({
        family: body.modelFamily ?? body.family,
        effort: body.modelEffort ?? body.effort,
        fast: body.modelFast ?? body.fast,
      });
      out.modelFamily = sel.family;
      out.modelEffort = sel.effort;
      out.modelFast = sel.fast;
      out.composerModel = sel.modelId;
      out.modelLabel = sel.label;
      out.composerFast = Boolean(sel.fast);
      touched = true;
    } else if (body.composerFast != null || body.composer_fast != null) {
      // Legacy toggle → map onto current family
      const full = await getSettings();
      const fast = body.composerFast ?? body.composer_fast;
      if (full.modelFamily === 'composer-2.5') {
        const sel = await setModelSelection({ family: 'composer-2.5', effort: 'full', fast });
        out.composerFast = sel.fast;
        out.composerModel = sel.modelId;
      } else {
        const sel = await setModelSelection({
          family: full.modelFamily,
          effort: full.modelEffort,
          fast,
        });
        out.composerFast = await setComposerFast(fast);
        out.composerModel = sel.modelId || composerModelForFast(out.composerFast);
        out.modelFast = sel.fast;
      }
      touched = true;
    }

    if (body.agentPlugin != null || body.plugin != null) {
      try {
        out.agentPlugin = await setAgentPlugin(body.agentPlugin ?? body.plugin);
      } catch (err) {
        return res.status(400).json({ ok: false, error: err.message || 'CLI unavailable' });
      }
      touched = true;
    }

    if (body.enabledPlugins != null && typeof body.enabledPlugins === 'object') {
      const result = await setEnabledPlugins(body.enabledPlugins);
      out.enabledPlugins = result.enabledPlugins;
      out.agentPlugin = result.agentPlugin;
      touched = true;
    }

    if (body.claudeModel != null || body.claude_model != null) {
      const nextModel = String(body.claudeModel ?? body.claude_model).trim();
      if (isGroqAgentModel(nextModel)) {
        return res.status(400).json({
          ok: false,
          error: 'Groq is reserved for acknowledgments — choose Kimi, Ollama or OpenRouter',
        });
      }
      if (isOpenRouterModel(nextModel)) {
        const orStatus = await fetchOpenRouterStatus();
        if (!orStatus.configured) {
          return res.status(400).json({
            ok: false,
            error: 'OpenRouter key missing — Kimi models unavailable',
            openrouter: orStatus,
          });
        }
        if (!orStatus.ok) {
          return res.status(402).json({
            ok: false,
            error: orStatus.error || 'Insufficient OpenRouter credits',
            openrouter: orStatus,
          });
        }
      }
      out.claudeModel = await setClaudeModel(nextModel);
      touched = true;
    }

    if (body.claudeThinking != null || body.claude_thinking != null) {
      out.claudeThinking = await setClaudeThinking(body.claudeThinking ?? body.claude_thinking);
      touched = true;
    }

    if (wantsTts) {
      try {
        const next = resolveTtsProvider(body.ttsProvider ?? body.tts_provider);
        if (!availableTtsProviders().includes(next)) {
          return res.status(400).json({ ok: false, error: `TTS engine ${next} not configured` });
        }
        out.ttsProvider = await setTtsProvider(next);
      } catch (err) {
        return res.status(400).json({ ok: false, error: err.message || 'Invalid TTS engine' });
      }
      touched = true;
    }

    if (!touched) {
      return res.status(400).json({
        ok: false,
        error: 'agentName, appName, voices, ttsProvider, modelFamily/effort/fast, agentPlugin, enabledPlugins, claudeModel or claudeThinking required',
      });
    }

    res.json(await settingsPayload(out));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Save failed' });
  }
});

/** Set default model for a CLI engine (opencode, agy, cursor). */
router.post('/settings/default-model', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const engine = String(req.body?.engine || req.body?.plugin || '').trim().toLowerCase();
  const model = String(req.body?.model || req.body?.modelId || '').trim();
  if (!engine || !model) {
    return res.status(400).json({ ok: false, error: 'engine and model required' });
  }
  try {
    const result = await setDefaultEngineModel(engine, model);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
