import fs from 'node:fs';
import path from 'node:path';
import {
  stopCliRun, resetCliSession, injectMessage, parseConversationId,
} from './bridgeClient.js';
import { resolveSessionWorkspace } from '../config.js';
import { digestContext } from './contextDigest.js';
import {
  markContextBootstrapped, clearContextBootstrap,
} from './contextSession.js';
import { getAdapterForPlugin, getAgentAdapter } from './agentAdapters/index.js';
import { getAgentPlugin } from './agentPlugins.js';
import { getSettings, getAppName } from './settingsStore.js';
import { getUser } from './usersStore.js';
import { buildSessionPrimeMessage } from './sessionPrime.js';
import { normalizeLocale } from './locale.js';
import { deleteTimeline, saveTimeline as saveTimelineFile } from './timelineStore.js';

function saveTimeline(conversation, items) {
  // Orchestrator writes always win over stale browser tabs.
  return saveTimelineFile(conversation, items, { force: true });
}
import { broadcastTimelineSync } from './consoleSyncHub.js';
import { buildPrimeTimelineRun } from './timelinePrime.js';
import {
  adoptPendingRun, linkBridgeRun, invalidateTimelineCache,
} from './timelineBuilder.js';
import { notifyDemoActivity } from './demoNotifyMail.js';
import { rememberDemoRequest } from './demoActivityWatch.js';

async function resolvePluginMeta() {
  const settings = await getSettings().catch(() => ({}));
  const plugin = getAgentPlugin(settings.agentPlugin);
  const adapter = getAdapterForPlugin(plugin);
  return {
    pluginId: plugin?.id || adapter.kind,
    kind: adapter.kind,
    name: plugin?.name || adapter.kind,
    capabilities: { ...adapter.capabilities },
  };
}

async function buildPrimeMessage(req, contextPath = '', engineLabel = '') {
  const userId = Number(req.user?.sub);
  const user = userId ? await getUser(userId) : null;
  const lang = normalizeLocale(req.body?.lang);
  const firstName = String(user?.firstName || user?.first_name || '').trim();
  const greetName = firstName
    || String(user?.name || '').trim().split(/\s+/)[0]
    || '';
  return buildSessionPrimeMessage({
    briefing: user?.briefing || '',
    userName: greetName,
    firstName,
    locale: lang,
    appName: await getAppName(),
    contextPath,
    engineLabel,
  });
}

function formatDemoUserLabel(user) {
  if (!user) return '';
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    || String(user.name || '').trim();
  const email = String(user.email || '').trim();
  return [full, email].filter(Boolean).join(' · ');
}

function notifyTimeline(conversation, payload, clientId) {
  broadcastTimelineSync(conversation, {
    type: 'timeline_sync',
    conversation,
    ...payload,
  }, { excludeClientId: clientId });
}

function workspaceForConversation(conversation) {
  const parsed = parseConversationId(conversation);
  const resolved = resolveSessionWorkspace(parsed.conversation, parsed.node || '');
  if (resolved) return resolved;
  const name = String(parsed.conversation || 'default').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  const candidates = [
    path.join('/data/opencode-ws', name),
    path.join('/data/workspaces', name),
    path.join('/root/UNIV9/sav/opencode-ws', name),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join('/data/opencode-ws', name);
}

async function prepareContextDigest(req, conversation, lang, engineLabel = '') {
  const userId = Number(req.user?.sub);
  const user = userId ? await getUser(userId) : null;
  const workspaceCwd = workspaceForConversation(conversation);
  return digestContext({
    workspaceCwd,
    briefing: user?.briefing || '',
    locale: lang,
    engineLabel,
  });
}

/**
 * Save prime run to timeline, inject briefing into CLI, return unified payload.
 * @param {import('express').Request} req
 * @param {string} conversation
 * @param {{ clientId?: string, saveTimeline?: boolean }} [opts]
 */
export async function orchestrateSessionPrime(req, conversation, opts = {}) {
  const clientId = String(opts.clientId || req.headers['x-helm-client-id'] || '').trim();
  const lang = normalizeLocale(req.body?.lang);
  const plugin = await resolvePluginMeta();

  let timeline = null;
  const introRun = buildPrimeTimelineRun();
  if (opts.saveTimeline !== false) {
    timeline = await saveTimeline(conversation, [introRun]);
    // Le builder serveur rattache les événements bridge à ce run de présentation.
    adoptPendingRun(conversation, introRun.id);
    notifyTimeline(conversation, {
      updated_at: timeline.updated_at,
      cleared: false,
      item_count: 1,
      primed: true,
    }, clientId);
  }

  const t0 = Date.now();
  const digest = await prepareContextDigest(req, conversation, lang, plugin.name);
  const tDigest = Date.now();
  const message = await buildPrimeMessage(req, digest?.path || '', plugin.name);
  const tMessage = Date.now();
  const dbUser = Number(req.user?.sub) ? await getUser(Number(req.user.sub)).catch(() => null) : null;
  const userLabel = formatDemoUserLabel(dbUser)
    || req.user?.email
    || req.user?.name
    || String(req.user?.sub || 'user');
  rememberDemoRequest({
    conversation,
    lang,
    user: userLabel,
    message: '[session prime]',
  });
  void notifyDemoActivity({
    kind: 'prime',
    lang,
    conversation,
    user: userLabel,
    text: `Session primed (briefing loaded).\n\n${String(message).slice(0, 500)}`,
    meta: dbUser ? {
      firstName: dbUser.firstName || undefined,
      lastName: dbUser.lastName || undefined,
      email: dbUser.email || undefined,
    } : undefined,
  });
  const inject = await injectMessage(message, conversation, [], lang, {
    injectMode: 'bootstrap',
  });
  const tInject = Date.now();
  // The greeting feels slow — log where the time actually goes, since the CLI
  // still has to read CONTEXT.md and generate after this call returns.
  console.log('[prime] timings ms:', JSON.stringify({
    digest: tDigest - t0,
    message: tMessage - tDigest,
    inject: tInject - tMessage,
    total: tInject - t0,
    contextChars: String(message || '').length,
  }));
  markContextBootstrapped(conversation, workspaceForConversation(conversation), digest?.hash || '', lang);

  if (opts.saveTimeline !== false && inject.composer_id) {
    const linked = {
      ...introRun,
      streamId: inject.composer_id || inject.id,
      model: inject.model || undefined,
    };
    timeline = await saveTimeline(conversation, [linked]);
    adoptPendingRun(conversation, introRun.id);
    notifyTimeline(conversation, {
      updated_at: timeline.updated_at,
      cleared: false,
      item_count: 1,
      primed: true,
    }, clientId);
  }
  if (opts.saveTimeline !== false && inject.run_id) {
    linkBridgeRun(conversation, inject.run_id);
  }

  return {
    ok: true,
    primed: true,
    timeline,
    inject,
    plugin,
  };
}

/**
 * Reset CLI session; optionally prime with operator briefing.
 * @param {import('express').Request} req
 * @param {string} conversation
 * @param {{ prime?: boolean, clientId?: string }} [opts]
 */
export async function orchestrateSessionReset(req, conversation, opts = {}) {
  const plugin = await resolvePluginMeta();
  clearContextBootstrap(conversation, workspaceForConversation(conversation));
  const reset = await resetCliSession(conversation);
  if (!opts.prime) {
    return { ok: true, reset, primed: false, plugin };
  }
  const primed = await orchestrateSessionPrime(req, conversation, {
    clientId: opts.clientId,
    saveTimeline: true,
  });
  return {
    ok: true,
    reset,
    primed: true,
    timeline: primed.timeline,
    inject: primed.inject,
    plugin,
  };
}

/**
 * Full conversation clear: stop CLI, wipe timeline, reset session, reload briefing.
 * Single orchestrated entry point for the UI.
 * @param {import('express').Request} req
 * @param {string} conversation
 * @param {{ clientId?: string }} [opts]
 */
export async function orchestrateConversationClear(req, conversation, opts = {}) {
  const clientId = String(opts.clientId || req.headers['x-helm-client-id'] || '').trim();
  const plugin = await resolvePluginMeta();

  try {
    await stopCliRun(conversation, { all: true });
  } catch {
    /* adapter may no-op (e.g. claude) */
  }

  // Wipe locally first — do NOT broadcast cleared:true here.
  // That event left other tabs (and racing clients) on an empty timeline forever,
  // because they never re-fetched the primed briefing that follows.
  const cleared = await deleteTimeline(conversation);
  invalidateTimelineCache(conversation);
  clearContextBootstrap(conversation, workspaceForConversation(conversation));

  let reset;
  try {
    reset = await resetCliSession(conversation);
  } catch (err) {
    notifyTimeline(conversation, {
      updated_at: cleared.updated_at,
      cleared: true,
      item_count: 0,
    }, clientId);
    throw err;
  }

  let primed;
  try {
    primed = await orchestrateSessionPrime(req, conversation, {
      clientId,
      saveTimeline: true,
    });
  } catch (err) {
    notifyTimeline(conversation, {
      updated_at: cleared.updated_at,
      cleared: true,
      item_count: 0,
    }, clientId);
    throw err;
  }

  notifyTimeline(conversation, {
    type: 'session_reborn',
    primed: true,
    cleared: true,
    item_count: Array.isArray(primed.timeline) ? primed.timeline.length : 0,
  }, clientId);

  return {
    ok: true,
    timeline: primed.timeline,
    session: {
      reset,
      primed: true,
      inject: primed.inject,
    },
    plugin,
  };
}

/** Expose adapter capabilities for status / settings without importing bridge internals. */
export async function getActiveAgentCapabilities() {
  return resolvePluginMeta();
}

export { getAgentAdapter };
