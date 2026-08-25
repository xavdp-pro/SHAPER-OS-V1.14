import { config, resolveSessionWorkspace, preferredNodeForConversation } from '../config.js';
import { applyCursorLanguage, imageOnlyPrompt } from './locale.js';
import { isContextBootstrapped, getContextLocale, noteContextLocale } from './contextSession.js';
import {
  getAgentName, getAppName, getComposerModel, getClaudeModel, getClaudeThinking, getSettings,
} from './settingsStore.js';
import { getAgentPlugin } from './agentPlugins.js';
import { getAdapterForPlugin } from './agentAdapters/index.js';
import { loadRollingContextPrefix } from './rollingContext.js';
import { getConversationModel } from './timelineStore.js';

function nodes() {
  return config.cli.nodes;
}

function nodeUser(node) {
  return node?.user || config.cli.defaultUser || 'helm-v2';
}

/** Active agent backend — cursor routes to the conversation's CLI node; claude uses global plugin URL. */
async function resolveActiveTarget(conversationId) {
  const settings = await getSettings().catch(() => ({}));
  const pluginId = settings.agentPlugin || process.env.DEFAULT_AGENT_PLUGIN || 'opencode';
  const plugin = getAgentPlugin(pluginId);
  const parsed = parseConversationId(conversationId);

  // Cursor: always use the machine from machine/user/path (CLI_NODES).
  if (plugin && (plugin.kind === 'cursor' || pluginId === 'cursor')) {
    if (parsed.target) {
      return {
        ...parsed.target,
        kind: 'cursor',
        pluginId: parsed.target.name,
      };
    }
  }

  if (plugin?.url) {
    return {
      name: plugin.id,
      url: plugin.url,
      token: plugin.token || '',
      user: config.cli.defaultUser || 'helm-v2',
      kind: plugin.kind || 'generic',
      pluginId: plugin.id,
    };
  }

  return parsed.target
    ? { ...parsed.target, kind: 'cursor', pluginId: parsed.target.name }
    : null;
}

/**
 * Chemin canonique machine/user/conversation (ex. asus/zaza/NOW3).
 */
export function conversationKey(nodeName, userOrConv, conversationName) {
  const n = nodeName || nodes()[0]?.name || 'local';
  const node = nodes().find((x) => x.name === n);
  let user;
  let conv;
  if (conversationName != null && conversationName !== '') {
    user = userOrConv || nodeUser(node);
    conv = conversationName;
  } else {
    user = nodeUser(node);
    conv = userOrConv;
  }
  return `${n}/${user}/${conv}`;
}

/**
 * Parse chemin 3 niveaux (asus/zaza/NOW3) ou raccourci 2 niveaux (asus/NOW3).
 * Bare names (NOW2) resolve to the node declared in CLI_SESSION_WORKSPACES when unique.
 * Full paths on the wrong node are rewritten to the preferred node for that session name.
 */
export function parseConversationId(id) {
  const raw = String(id || '').trim();
  const fallback = nodes()[0] || null;
  if (!raw) {
    return {
      node: null, user: null, conversation: null, target: fallback, path: '',
    };
  }

  const parts = raw.split(/[/:]/).filter(Boolean);
  let node;
  let user;
  let conversation;
  let target;

  if (parts.length >= 3) {
    node = parts[0];
    user = parts[1];
    conversation = parts.slice(2).join('/');
    target = findNode(node);
  } else if (parts.length === 2) {
    node = parts[0];
    conversation = parts[1];
    target = findNode(node);
    user = nodeUser(target);
  } else {
    conversation = parts[0];
    const preferred = preferredNodeForConversation(conversation);
    target = (preferred && findNode(preferred)) || fallback;
    node = target?.name || null;
    user = nodeUser(target);
  }

  // Exclusive session (acer|NOW2|…) must not run on another node.
  const preferred = preferredNodeForConversation(conversation);
  if (preferred && node && preferred !== node) {
    const forced = findNode(preferred);
    if (forced) {
      target = forced;
      node = forced.name;
      user = nodeUser(forced);
    }
  }

  return {
    node: node || null,
    user: user || null,
    conversation: conversation || null,
    target,
    path: target && conversation
      ? conversationKey(target.name, user || nodeUser(target), conversation)
      : raw,
  };
}

export function bridgeConversationName(conversationId) {
  const { conversation } = parseConversationId(conversationId);
  return conversation || config.cli.defaultConversation;
}

async function apiFetch(target, path, options = {}) {
  if (!target?.url) throw new Error('Aucun nœud CLI configuré');
  const url = `${target.url.replace(/\/$/, '')}${path}`;
  const headers = {
    Authorization: `Bearer ${target.token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };
  const res = await fetch(url, {
    ...options,
    headers,
    signal: AbortSignal.timeout(options.timeout ?? 25000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.detail || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function getRemoteStatus(conversationId) {
  const target = await resolveActiveTarget(conversationId);
  if (!target) {
    return { ok: false, reachable: false, ready: false, transport: 'agent-bridge' };
  }
  const adapter = getAdapterForPlugin({ kind: target.kind, id: target.pluginId });
  try {
    const data = await apiFetch(target, '/api/status');
    return {
      ok: true,
      reachable: true,
      node: target.pluginId || target.name,
      plugin: target.pluginId || target.name,
      kind: target.kind,
      capabilities: { ...adapter.capabilities },
      user: target.user || nodeUser(target),
      ready: Boolean(data.ready),
      transport: adapter.capabilities.transportLabel,
      service: data.service,
      wsBase: data.ws_base,
      model: data.model,
      port: data.port || (target.kind === 'claude' ? 4320 : 4310),
      raw: data,
    };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      ready: false,
      transport: adapter.capabilities.transportLabel,
      node: target.pluginId || target.name,
      plugin: target.pluginId || target.name,
      kind: target.kind,
      capabilities: { ...adapter.capabilities },
      user: target.user || nodeUser(target),
      error: err.message,
    };
  }
}

function resolveConversationCwd(name, cwdFromBridge = '', nodeName = '') {
  const fromBridge = String(cwdFromBridge || '').trim();
  if (fromBridge) return fromBridge;
  return resolveSessionWorkspace(name, nodeName);
}

export async function listConversations() {
  const all = [];
  for (const node of nodes()) {
    const user = nodeUser(node);
    let registered = [];
    try {
      const data = await apiFetch(node, '/api/conversations');
      registered = data.registered || [];
    } catch {
      registered = [];
    }
    if (registered.length === 0) {
      const name = config.cli.defaultConversation;
      const path = conversationKey(node.name, user, name);
      all.push({
        id: path,
        path,
        name,
        node: node.name,
        user,
        cwd: resolveConversationCwd(name, '', node.name),
        port: 4200,
        is_default: true,
      });
      continue;
    }
    for (const c of registered) {
      const path = conversationKey(node.name, user, c.name);
      all.push({
        id: path,
        path,
        name: c.name,
        title: c.title || c.name,
        node: node.name,
        user,
        cwd: resolveConversationCwd(c.name, c.cwd, node.name),
        chat_id: c.chat_id || null,
        resumed: Boolean(c.chat_id),
        created_at: c.created_at || null,
        last_used_at: c.last_used_at || null,
        port: 4200,
      });
    }
  }
  return { ok: true, conversations: all, nodes: nodes().map((n) => ({ name: n.name, user: nodeUser(n) })) };
}

export function devSessionPath() {
  const node = nodes()[0];
  if (!node) return null;
  const conv = config.cli.devConversation;
  return conversationKey(node.name, nodeUser(node), conv);
}

export function getDevSessionInfo() {
  const node = nodes()[0];
  const conv = config.cli.devConversation;
  const workspace = config.cli.devWorkspaces[conv] || null;
  return {
    conversation: conv,
    path: node ? conversationKey(node.name, nodeUser(node), conv) : conv,
    workspace,
    node: node?.name || null,
    user: node ? nodeUser(node) : config.cli.defaultUser,
  };
}

export async function setConversationWorkspace(conversationId, workspace) {
  const { target } = parseConversationId(conversationId);
  if (!target) throw new Error('Nœud CLI introuvable');
  const name = bridgeConversationName(conversationId);
  const data = await apiFetch(target, '/api/conversations/workspace', {
    method: 'POST',
    body: JSON.stringify({ conversation: name, workspace }),
  });
  return { ok: true, ...data };
}

async function ensureSessionWorkspace(conversationId) {
  const { conversation, node, target } = parseConversationId(conversationId);
  const name = conversation || config.cli.defaultConversation;
  const nodeName = node || target?.name || '';
  const workspace = resolveSessionWorkspace(name, nodeName);
  if (!workspace) return null;
  return setConversationWorkspace(conversationId, workspace);
}

export async function uploadAttachment(conversationId, filename, data) {
  const { target } = parseConversationId(conversationId);
  if (!target) throw new Error('Nœud CLI introuvable');
  const name = bridgeConversationName(conversationId);
  return apiFetch(target, '/api/upload', {
    method: 'POST',
    body: JSON.stringify({ conversation: name, filename, data }),
    timeout: 60000,
  });
}

export async function getConversationWorkspacePath(conversationId) {
  const id = String(conversationId || '').trim();
  if (!id) return '';
  try {
    const data = await listConversations();
    const hit = (data.conversations || []).find((c) => (c.path || c.id) === id);
    const cwd = String(hit?.cwd || '').trim();
    if (cwd) return cwd;
  } catch {
    /* bridge may be down */
  }
  const parsed = parseConversationId(id);
  if (parsed.conversation) {
    return resolveSessionWorkspace(parsed.conversation, parsed.node || '') || '';
  }
  return '';
}

export async function injectMessage(message, conversationId, attachments = [], lang = 'fr', opts = {}) {
  const parsed = parseConversationId(conversationId);
  const target = await resolveActiveTarget(conversationId);
  const adapter = getAdapterForPlugin({ kind: target?.kind, id: target?.pluginId });
  const { user, path } = parsed;
  if (!target) throw new Error('Nœud CLI introuvable');
  const name = bridgeConversationName(conversationId);
  if (adapter.capabilities.bindWorkspace) {
    await ensureSessionWorkspace(conversationId);
  }
  const workspaceCwd = await getConversationWorkspacePath(conversationId);
  const raw = String(message || '').trim()
    || (attachments.length ? imageOnlyPrompt(lang) : '');
  const agentName = await getAgentName();
  const appName = await getAppName();
  const composerModel = await getComposerModel();
  const modelField = adapter.capabilities.modelField;
  const claudeModel = opts.claudeModel || await getClaudeModel();
  const claudeThinking = opts.claudeThinking != null
    ? opts.claudeThinking
    : (modelField === 'litellm' ? await getClaudeThinking() : 'auto');
  // A lean inject carries no language rule — it relies on CONTEXT.md, written in
  // the locale of the prime. So when the operator switches language mid-session,
  // fall back to a full inject once, in the new language.
  const bootstrappedNow = isContextBootstrapped(conversationId, workspaceCwd);
  const localeChanged = bootstrappedNow && getContextLocale(conversationId, workspaceCwd) !== lang;
  const injectMode = opts.injectMode
    || (opts.contextBootstrap ? 'bootstrap' : null)
    || (opts.forceFullContext ? 'full' : null)
    || (bootstrappedNow && !localeChanged ? 'lean' : 'full');
  if (localeChanged) {
    noteContextLocale(conversationId, workspaceCwd, lang);
    console.log('[inject] locale switch → full context', JSON.stringify({ conversationId, lang }));
  }

  let text = injectMode === 'bootstrap'
    ? raw
    : applyCursorLanguage(raw, lang, {
      agentName,
      appName,
      voiceTurn: Boolean(opts.voiceTurn),
      ackText: opts.ackText,
      workspaceCwd,
      bootstrapped: injectMode === 'lean',
      alwaysLang: modelField === 'litellm',
      claudeThinking: modelField === 'litellm' ? claudeThinking : 'auto',
    });

  let hadRollingContext = false;
  const rollingContextEnabled = process.env.HELM_LITELLM_ROLLING_CONTEXT === '1';
  if (
    rollingContextEnabled
    && modelField === 'litellm'
    && injectMode !== 'bootstrap'
    && !opts.skipRollingContext
  ) {
    const timelinePath = path || conversationId;
    const { prefix, hadContext } = await loadRollingContextPrefix(timelinePath, { locale: lang });
    if (prefix) {
      text = `${prefix}${text}`;
      hadRollingContext = hadContext;
    }
  }

  const convModel = await getConversationModel(conversationId);
  const model = convModel || (modelField === 'litellm' ? claudeModel : composerModel);
  const body = adapter.buildInjectBody({
    conversationName: name,
    message: text,
    attachments,
    model: modelField === 'passthrough' ? undefined : model,
    thinking: modelField === 'litellm' ? claudeThinking : undefined,
  });
  const data = await apiFetch(target, '/api/inject', {
    method: 'POST',
    body: JSON.stringify(body),
    timeout: 120000,
  });
  return {
    ok: true,
    id: data.id,
    conversation: data.conversation,
    path,
    plugin: target.pluginId || target.name,
    kind: adapter.kind,
    model: data.model || model,
    composer_id: data.composer_id || data.chat_id || data.session_id,
    run_id: data.run_id || null,
    hadRollingContext,
    stdout: `OK → ${target.pluginId || target.name} · ${path || conversationKey(target.name, user, data.conversation)}`,
  };
}

export async function resetCliSession(conversationId) {
  const target = await resolveActiveTarget(conversationId);
  if (!target) throw new Error('Nœud CLI introuvable');
  const adapter = getAdapterForPlugin({ kind: target.kind, id: target.pluginId });
  const name = bridgeConversationName(conversationId);
  const data = await adapter.resetSession({
    target,
    conversationName: name,
    apiFetch,
  });
  return { ok: true, ...data, kind: adapter.kind };
}

/** Delete a registered conversation on the CLI node that owns the path. */
export async function deleteCliConversation(conversationId) {
  const parsed = parseConversationId(conversationId);
  const target = parsed.target;
  if (!target) throw new Error('Nœud CLI introuvable');
  const name = parsed.conversation || bridgeConversationName(conversationId);
  if (!name) throw new Error('conversation requise');
  const data = await apiFetch(target, '/api/conversations/delete', {
    method: 'POST',
    body: JSON.stringify({ conversation: name }),
  });
  return { ok: true, conversation: name, path: parsed.path || conversationId, ...data };
}

export async function stopCliRun(conversationId, { all = false } = {}) {
  const target = all
    ? (await resolveActiveTarget(conversationId)) || nodes()[0]
    : await resolveActiveTarget(conversationId);
  if (!target) throw new Error('Nœud CLI introuvable');
  const adapter = getAdapterForPlugin({ kind: target.kind, id: target.pluginId });
  const name = bridgeConversationName(conversationId);
  const data = await adapter.stopRun({
    target,
    conversationName: name,
    apiFetch,
  }, { all });
  return { ok: true, ...data, kind: adapter.kind, plugin: target.pluginId || target.name };
}

export async function bridgeEventsUrl(conversationId) {
  const t = await resolveActiveTarget(conversationId);
  if (!t?.url) throw new Error('Nœud SSE introuvable');
  return `${t.url.replace(/\/$/, '')}/api/events`;
}

export async function bridgeApiToken(conversationId) {
  const t = await resolveActiveTarget(conversationId);
  return t?.token || '';
}

export function findNode(nameOrId) {
  const list = nodes();
  if (!nameOrId) return list[0] || null;
  const sel = String(nameOrId).trim();
  const byName = list.find((n) => n.name === sel);
  if (byName) return byName;
  if (sel.includes('/') || sel.includes(':')) {
    const prefix = sel.split(/[/:]/)[0];
    return list.find((n) => n.name === prefix) || null;
  }
  return list[0] || null;
}

export function cliNodes() {
  return nodes().map((n) => ({
    name: n.name,
    user: nodeUser(n),
    url: n.url,
    kind: 'cursor',
  }));
}
