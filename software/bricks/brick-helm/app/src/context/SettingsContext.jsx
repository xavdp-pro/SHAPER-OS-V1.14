import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSettings, updateSettings, postModelSync, setDefaultEngineModel as apiSetDefaultEngineModel } from '../api/client.js';

const SettingsContext = createContext(null);

const DEFAULT_AGENT_NAME = 'Zephir';
const DEFAULT_APP_NAME = 'KovZu';
const DEFAULT_ENGINE_MODELS = {
  opencode: 'opencode/nemotron-3-ultra-free',
  agy: 'gemini-3.7-flash',
  cursor: 'composer-2.5',
  claude: 'claude-3-7-sonnet',
};

export function SettingsProvider({ children }) {
  const [agentName, setAgentNameState] = useState(DEFAULT_AGENT_NAME);
  const [appName, setAppNameState] = useState(DEFAULT_APP_NAME);
  const [composerFast, setComposerFastState] = useState(true);
  const [modelFamily, setModelFamily] = useState('opencode/nemotron-3-ultra-free');
  const [modelEffort, setModelEffort] = useState('full');
  const [modelFast, setModelFast] = useState(false);
  const [modelLabel, setModelLabel] = useState('Nemotron 3 Ultra (Gratuit)');
  const [modelFamilies, setModelFamilies] = useState([]);
  const [agentPlugin, setAgentPluginState] = useState('opencode');
  const [plugins, setPlugins] = useState([]);
  const [enabledPlugins, setEnabledPluginsState] = useState({ opencode: true, agy: true, cursor: true });
  const [defaultModels, setDefaultModels] = useState(DEFAULT_ENGINE_MODELS);
  const [claudeModel, setClaudeModelState] = useState('or-kimi-k3');
  const [claudeThinking, setClaudeThinkingState] = useState('auto');
  const [claudeModels, setClaudeModels] = useState([]);
  const [openrouter, setOpenrouter] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyPayload = useCallback((data) => {
    if (!data) return;
    if (data.agentName) setAgentNameState(String(data.agentName).trim() || DEFAULT_AGENT_NAME);
    if (data.appName) setAppNameState(String(data.appName).trim() || DEFAULT_APP_NAME);
    if (data.modelFamily) setModelFamily(data.modelFamily);
    if (data.modelEffort) setModelEffort(data.modelEffort);
    if (data.modelFast != null) setModelFast(Boolean(data.modelFast));
    if (data.composerFast != null) setComposerFastState(Boolean(data.composerFast));
    if (data.modelLabel) setModelLabel(data.modelLabel);
    if (Array.isArray(data.modelFamilies)) setModelFamilies(data.modelFamilies);
    if (data.agentPlugin) setAgentPluginState(data.agentPlugin);
    if (Array.isArray(data.plugins)) setPlugins(data.plugins);
    if (data.enabledPlugins && typeof data.enabledPlugins === 'object') {
      setEnabledPluginsState(data.enabledPlugins);
    }
    if (data.defaultModels && typeof data.defaultModels === 'object') {
      setDefaultModels((prev) => ({ ...prev, ...data.defaultModels }));
    }
    if (data.claudeModel) setClaudeModelState(data.claudeModel);
    if (data.claudeThinking) setClaudeThinkingState(data.claudeThinking);
    if (Array.isArray(data.claudeModels)) setClaudeModels(data.claudeModels);
    if (data.openrouter) setOpenrouter(data.openrouter);
  }, []);

  const refresh = useCallback(async () => {
    const { ok, data } = await getSettings();
    if (ok && data) applyPayload(data);
    setLoading(false);
  }, [applyPayload]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = `${appName || DEFAULT_APP_NAME} v2`;
  }, [appName]);

  const setAgentName = useCallback(async (name) => {
    const { ok, data } = await updateSettings({ agentName: name });
    if (!ok) return { ok: false, error: data?.error || 'Enregistrement échoué' };
    const next = String(data?.agentName || name).trim() || DEFAULT_AGENT_NAME;
    setAgentNameState(next);
    return { ok: true, agentName: next };
  }, []);

  const setAppName = useCallback(async (name) => {
    const { ok, data } = await updateSettings({ appName: name });
    if (!ok) return { ok: false, error: data?.error || 'Enregistrement échoué' };
    const next = String(data?.appName || name).trim() || DEFAULT_APP_NAME;
    setAppNameState(next);
    return { ok: true, appName: next };
  }, []);

  const setComposerFast = useCallback(async (fast) => {
    const next = Boolean(fast);
    setComposerFastState(next);
    setModelFast(next);
    const { ok, data } = await updateSettings({
      modelFamily,
      modelEffort,
      modelFast: next,
    });
    if (!ok) {
      setComposerFastState(!next);
      setModelFast(!next);
      return { ok: false, error: data?.error || 'Enregistrement échoué' };
    }
    applyPayload(data);
    void postModelSync({
      modelFamily: data?.modelFamily || modelFamily,
      modelLabel: data?.modelLabel || modelLabel,
      modelEffort: data?.modelEffort || modelEffort,
      modelFast: next,
    });
    return { ok: true, composerFast: next, composerModel: data?.composerModel };
  }, [applyPayload, modelFamily, modelEffort, modelLabel]);

  const setModelSelection = useCallback(async ({ family, effort, fast, broadcast = true }) => {
    const { ok, data } = await updateSettings({
      modelFamily: family,
      modelEffort: effort,
      modelFast: fast,
    });
    if (!ok) return { ok: false, error: data?.error || 'Enregistrement échoué' };
    applyPayload(data);
    if (broadcast) {
      void postModelSync({
        modelFamily: data?.modelFamily || family,
        modelLabel: data?.modelLabel,
        modelEffort: data?.modelEffort || effort,
        modelFast: data?.modelFast != null ? data.modelFast : fast,
      });
    }
    return {
      ok: true,
      modelLabel: data?.modelLabel,
      composerModel: data?.composerModel,
      modelFamily: data?.modelFamily,
      modelEffort: data?.modelEffort,
      modelFast: data?.modelFast,
    };
  }, [applyPayload]);

  const applyRemoteModelChange = useCallback(({ modelFamily: fam, modelLabel: lbl, modelEffort: eff, modelFast: fst }) => {
    if (fam) setModelFamily(fam);
    if (lbl) setModelLabel(lbl);
    if (eff) setModelEffort(eff);
    if (fst != null) {
      setModelFast(Boolean(fst));
      setComposerFastState(Boolean(fst));
    }
  }, []);

  const setDefaultEngineModel = useCallback(async (engine, model) => {
    const { ok, data } = await apiSetDefaultEngineModel(engine, model);
    if (!ok) return { ok: false, error: data?.error || 'Enregistrement échoué' };
    setDefaultModels((prev) => ({ ...prev, [engine]: model }));
    return { ok: true, engine, model };
  }, []);

  const setAgentPlugin = useCallback(async (plugin) => {
    const { ok, data } = await updateSettings({ agentPlugin: plugin });
    if (!ok) return { ok: false, error: data?.error || 'Enregistrement échoué' };
    applyPayload(data);
    return { ok: true, agentPlugin: data?.agentPlugin };
  }, [applyPayload]);

  const setClaudeModel = useCallback(async (model) => {
    const { ok, data } = await updateSettings({ claudeModel: model });
    if (!ok) return { ok: false, error: data?.error || 'Enregistrement échoué' };
    applyPayload(data);
    return { ok: true, claudeModel: data?.claudeModel };
  }, [applyPayload]);

  const setClaudeThinking = useCallback(async (mode) => {
    const { ok, data } = await updateSettings({ claudeThinking: mode });
    if (!ok) return { ok: false, error: data?.error || 'Enregistrement échoué' };
    applyPayload(data);
    return { ok: true, claudeThinking: data?.claudeThinking };
  }, [applyPayload]);

  const setEnabledPlugins = useCallback(async (partial) => {
    const { ok, data } = await updateSettings({ enabledPlugins: partial });
    if (!ok) return { ok: false, error: data?.error || 'Enregistrement échoué' };
    applyPayload(data);
    return {
      ok: true,
      enabledPlugins: data?.enabledPlugins,
      agentPlugin: data?.agentPlugin,
    };
  }, [applyPayload]);

  /** Plugins usable in the console picker (admin-enabled CLI engines only). */
  const activePlugins = useMemo(
    () => (plugins || []).filter((p) => {
      if (p.enabled === false) return false;
      return p.id === 'cursor' || p.id === 'claude' || p.id === 'opencode' || p.id === 'agy' || p.kind === 'cursor' || p.kind === 'claude';
    }),
    [plugins],
  );

  const value = useMemo(() => ({
    agentName,
    appName,
    composerFast,
    modelFamily,
    modelEffort,
    modelFast,
    modelLabel,
    modelFamilies,
    agentPlugin,
    plugins,
    activePlugins,
    enabledPlugins,
    defaultModels,
    claudeModel,
    claudeThinking,
    claudeModels,
    openrouter,
    loading,
    refresh,
    setAgentName,
    setAppName,
    setComposerFast,
    setModelSelection,
    applyRemoteModelChange,
    setDefaultEngineModel,
    setAgentPlugin,
    setClaudeModel,
    setClaudeThinking,
    setEnabledPlugins,
  }), [
    agentName, appName, composerFast, modelFamily, modelEffort, modelFast, modelLabel,
    modelFamilies, agentPlugin, plugins, activePlugins, enabledPlugins, defaultModels, claudeModel, claudeThinking, claudeModels,
    openrouter, loading, refresh,
    setAgentName, setAppName, setComposerFast, setModelSelection, applyRemoteModelChange, setDefaultEngineModel, setAgentPlugin, setClaudeModel,
    setClaudeThinking, setEnabledPlugins,
  ]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    return {
      agentName: DEFAULT_AGENT_NAME,
      appName: DEFAULT_APP_NAME,
      composerFast: true,
      modelFamily: 'opencode/nemotron-3-ultra-free',
      modelEffort: 'full',
      modelFast: false,
      modelLabel: 'Nemotron 3 Ultra (Gratuit)',
      modelFamilies: [],
      agentPlugin: 'opencode',
      plugins: [],
      activePlugins: [],
      enabledPlugins: { opencode: true, agy: true, cursor: true },
      defaultModels: DEFAULT_ENGINE_MODELS,
      claudeModel: 'or-kimi-k3',
      claudeThinking: 'auto',
      claudeModels: [],
      openrouter: null,
      loading: false,
      refresh: async () => {},
      setAgentName: async () => ({ ok: false, error: 'SettingsProvider manquant' }),
      setAppName: async () => ({ ok: false, error: 'SettingsProvider manquant' }),
      setComposerFast: async () => ({ ok: false, error: 'SettingsProvider manquant' }),
      setModelSelection: async () => ({ ok: false, error: 'SettingsProvider manquant' }),
      applyRemoteModelChange: () => {},
      setDefaultEngineModel: async () => ({ ok: false, error: 'SettingsProvider manquant' }),
      setAgentPlugin: async () => ({ ok: false, error: 'SettingsProvider manquant' }),
      setClaudeModel: async () => ({ ok: false, error: 'SettingsProvider manquant' }),
      setClaudeThinking: async () => ({ ok: false, error: 'SettingsProvider manquant' }),
      setEnabledPlugins: async () => ({ ok: false, error: 'SettingsProvider manquant' }),
    };
  }
  return ctx;
}
