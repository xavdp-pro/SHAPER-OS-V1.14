/**
 * Server-side timeline authority.
 *
 * Consumes the bridge SSE feed (one persistent connection per CLI node),
 * applies events with the SAME reducer as the browser (src/lib/runStream.js)
 * and persists the result. Browsers keep applying events locally for instant
 * display, but the stored timeline is written here — never by clients.
 *
 * Event contract (bridge): every run event carries { conversation, run_id, seq }.
 * The builder links each bridge run_id to the timeline run item created at
 * inject time, and DROPS events from stale runs instead of guessing.
 */
import {
  applyStreamEvent,
  sanitizeTimeline,
  settlePrimeRunsBeforeTurn,
  pushHuman,
  insertVoiceAck,
  prepareResendFromHuman,
} from '../../src/lib/runStream.js';
import { loadTimeline, saveTimeline } from './timelineStore.js';
import { broadcastTimelineSync } from './consoleSyncHub.js';
import { config } from '../config.js';
import { conversationKey } from './bridgeClient.js';
import { listAgentPlugins } from './agentPlugins.js';

const SAVE_DEBOUNCE_MS = 700;
const RECONNECT_MS = 3000;

/**
 * helm-v2 routes events from SEVERAL sources (cursor bridge per machine +
 * claude bridge global). The inject route registers run_id → full path here,
 * so events reach the right timeline regardless of which bridge emitted them.
 * @type {Map<string, string>} bridge run_id → conversation path
 */
const runPathIndex = new Map();

function indexRunPath(runId, path) {
  if (!runId || !path) return;
  runPathIndex.set(String(runId), path);
  if (runPathIndex.size > 128) {
    const first = runPathIndex.keys().next().value;
    runPathIndex.delete(first);
  }
}

/**
 * @typedef {object} ConvState
 * @property {Array|null} items          in-memory timeline (null = reload from disk)
 * @property {string} currentBridgeRunId bridge run currently linked to the live run item
 * @property {string} pendingRunItemId   run item written by inject, waiting for its bridge run
 * @property {Map<string,string>} knownBridgeRuns bridge run_id → run item id
 * @property {ReturnType<typeof setTimeout>|null} saveTimer
 * @property {boolean} dirty
 */

/** @type {Map<string, ConvState>} keyed by full conversation path (node/user/name) */
const states = new Map();
let started = false;
/** @type {AbortController[]} */
const consumers = [];

function stateFor(path) {
  let st = states.get(path);
  if (!st) {
    st = {
      items: null,
      currentBridgeRunId: '',
      pendingRunItemId: '',
      knownBridgeRuns: new Map(),
      saveTimer: null,
      dirty: false,
    };
    states.set(path, st);
  }
  return st;
}

async function loadItems(path, st) {
  if (st.items === null) {
    st.items = (await loadTimeline(path)).items || [];
  }
  return st.items;
}

async function flushState(path, st) {
  st.saveTimer = null;
  if (!st.dirty) return;
  st.dirty = false;
  const items = sanitizeTimeline(st.items || []);
  st.items = items;
  // Server authority — bypasses stale-tab check on the store.
  const saved = await saveTimeline(path, items, { force: true });
  broadcastTimelineSync(path, {
    type: 'timeline_sync',
    conversation: path,
    updated_at: saved.updated_at,
    cleared: items.length === 0,
    item_count: items.length,
    source: 'server',
  });
}

/**
 * Persist state. `immediate` awaits the DB write; debounced mode fires later.
 * Returns a promise (await it when ordering matters).
 */
function persist(path, st, { immediate = false } = {}) {
  st.dirty = true;
  if (st.saveTimer && !immediate) return Promise.resolve();
  if (st.saveTimer) {
    clearTimeout(st.saveTimer);
    st.saveTimer = null;
  }
  if (immediate) return flushState(path, st);
  st.saveTimer = setTimeout(() => {
    flushState(path, st).catch((err) => {
      console.error(`[timelineBuilder] flush failed (${path}):`, err.message);
    });
  }, SAVE_DEBOUNCE_MS);
  return Promise.resolve();
}

/**
 * External write happened through the HTTP routes (clear, legacy client save).
 * Drop the memory cache so the next event reloads from disk.
 */
export function invalidateTimelineCache(path) {
  const st = states.get(path);
  if (!st) return;
  if (st.saveTimer) {
    clearTimeout(st.saveTimer);
    st.saveTimer = null;
  }
  st.items = null;
  st.dirty = false;
}

/**
 * The store was just written externally (sessionOrchestrator) with a pending
 * run — reload from disk and track it, without re-saving.
 */
export function adoptPendingRun(path, runItemId) {
  const st = stateFor(path);
  if (st.saveTimer) {
    clearTimeout(st.saveTimer);
    st.saveTimer = null;
  }
  st.items = null;
  st.dirty = false;
  st.pendingRunItemId = String(runItemId || '');
  st.currentBridgeRunId = '';
}

/** Register the run item created by an inject/prime — becomes the live run. */
export async function registerTurn(path, { items, runItemId }) {
  const st = stateFor(path);
  st.items = Array.isArray(items) ? items : await loadItems(path, st);
  st.pendingRunItemId = String(runItemId || '');
  st.currentBridgeRunId = '';
  await persist(path, st, { immediate: true });
}

/** Link the bridge run_id returned by /api/inject to the pending run item. */
export function linkBridgeRun(path, bridgeRunId) {
  if (!bridgeRunId) return;
  indexRunPath(bridgeRunId, path);
  const st = stateFor(path);
  st.currentBridgeRunId = String(bridgeRunId);
  if (st.pendingRunItemId) {
    st.knownBridgeRuns.set(st.currentBridgeRunId, st.pendingRunItemId);
  }
  if (st.knownBridgeRuns.size > 32) {
    const first = st.knownBridgeRuns.keys().next().value;
    st.knownBridgeRuns.delete(first);
  }
}

function abortedRun(run) {
  return {
    ...run,
    status: 'aborted',
    blocks: (run.blocks || []).map((b) => ({
      ...b,
      streaming: false,
      ...(b.type === 'tool' && b.status !== 'done' && b.status !== 'error' ? { status: 'done' } : {}),
    })),
  };
}

/** Abort every running run except `keepRunId` (protects a freshly injected turn). */
function abortStaleRuns(items, keepRunId) {
  let changed = false;
  const next = (items || []).map((it) => {
    if (it.type !== 'run' || it.status !== 'running' || it.id === keepRunId) return it;
    changed = true;
    return abortedRun(it);
  });
  return changed ? next : items;
}

/** Abort one specific run item if still running. */
function abortRunItem(items, runItemId) {
  if (!runItemId) return items;
  let changed = false;
  const next = (items || []).map((it) => {
    if (it.type !== 'run' || it.id !== runItemId || it.status !== 'running') return it;
    changed = true;
    return abortedRun(it);
  });
  return changed ? next : items;
}

/**
 * Decide if a bridge event belongs to the live run.
 * Returns 'apply' | 'drop'.
 */
function classifyEvent(st, event) {
  const runId = String(event.run_id || '');
  if (!runId) return 'apply'; // old bridge — backward compatible, reducer heuristics apply

  if (st.currentBridgeRunId && runId === st.currentBridgeRunId) return 'apply';

  if (!st.knownBridgeRuns.has(runId) && st.pendingRunItemId && !st.currentBridgeRunId) {
    // SSE beat the inject HTTP response — adopt this run for the pending item.
    st.currentBridgeRunId = runId;
    st.knownBridgeRuns.set(runId, st.pendingRunItemId);
    return 'apply';
  }

  if (!st.currentBridgeRunId && !st.pendingRunItemId) {
    // Server restarted mid-run: no mapping — accept and let the reducer place it.
    st.currentBridgeRunId = runId;
    return 'apply';
  }

  return 'drop'; // event from a stale/replaced run
}

/** Apply one bridge event to the stored timeline for `path`. */
export async function applyBridgeEventToStore(path, event) {
  if (!path || !event || event.type === 'ping' || event.type === 'connected') return;
  if (event.type === 'inject') return; // turn already written by the inject route

  const st = stateFor(path);

  if (event.type === 'run_aborted') {
    // Abort exactly what this run owns — never a newly injected turn.
    const runId = String(event.run_id || '');
    const items = await loadItems(path, st);
    let next = items;
    if (runId && st.knownBridgeRuns.has(runId)) {
      next = abortRunItem(items, st.knownBridgeRuns.get(runId));
    } else if (!runId || runId === st.currentBridgeRunId
      || (!st.currentBridgeRunId && !st.pendingRunItemId)) {
      next = abortStaleRuns(items, st.pendingRunItemId || '');
    }
    if (next !== items) {
      st.items = next;
      await persist(path, st, { immediate: true });
    }
    if (runId && runId === st.currentBridgeRunId) {
      st.currentBridgeRunId = '';
      st.pendingRunItemId = '';
    }
    return;
  }

  const verdict = classifyEvent(st, event);
  if (verdict === 'drop') return;

  const items = await loadItems(path, st);
  const next = applyStreamEvent(items, event);
  if (next === items) return;
  st.items = next;

  const terminal = event.type === 'response_complete' || event.type === 'run_complete';
  if (terminal) {
    if (String(event.run_id || '') === st.currentBridgeRunId || !event.run_id) {
      st.currentBridgeRunId = '';
      st.pendingRunItemId = '';
    }
  }
  await persist(path, st, { immediate: terminal });
}

/* ——— Turn writers (called by HTTP routes) ——— */

/** Write the human turn (+ optional voice ack) + pending run. Returns new items. */
export async function writeHumanTurn(path, {
  text = '', images = [], humanId = '', runId = '', voiceTurn = false, ackText = '',
} = {}) {
  const st = stateFor(path);
  const base = settlePrimeRunsBeforeTurn(await loadItems(path, st));
  let { timeline } = pushHuman(base, text, images, { humanId, runId, voiceTurn });
  if (ackText) timeline = insertVoiceAck(timeline, ackText);
  await registerTurn(path, { items: timeline, runItemId: runId });
  return timeline;
}

/** Edit + resend: truncate at human, rewrite it, open a run. Returns prepared or null. */
export async function writeResendTurn(path, {
  humanId, text = '', images, runId = '',
} = {}) {
  const st = stateFor(path);
  const items = await loadItems(path, st);
  const prepared = prepareResendFromHuman(items, humanId, text, images, { runId });
  if (!prepared.ok) return null;
  await registerTurn(path, { items: prepared.timeline, runItemId: prepared.runId || runId });
  return prepared;
}

/** Write the presentation (prime) run after a clear (appends if history exists). */
export async function writePrimeRun(path, { runId = '' } = {}) {
  const st = stateFor(path);
  st.items = null; // clear/reset just rewrote the store — reload from disk
  const existing = await loadItems(path, st);
  const id = runId || crypto.randomUUID();
  const primeRun = {
    type: 'run',
    id,
    streamId: `prime-${Date.now()}`,
    status: 'running',
    prime: true,
    blocks: [],
    time: Date.now(),
  };
  await registerTurn(path, { items: [...existing, primeRun], runItemId: id });
  return primeRun;
}

/** Bridge refused the inject after the turn was stored — abort + surface error. */
export async function writeTurnFailure(path, message) {
  const st = stateFor(path);
  const items = await loadItems(path, st);
  const aborted = abortStaleRuns(items, '');
  st.items = [
    ...aborted,
    { type: 'system', id: crypto.randomUUID(), text: String(message || 'Send failed') },
  ];
  st.currentBridgeRunId = '';
  st.pendingRunItemId = '';
  await persist(path, st, { immediate: true });
}

/** Mark running runs aborted after a user stop. */
export async function writeStopAll() {
  for (const [path, st] of states) {
    const items = st.items === null ? await loadItems(path, st) : st.items;
    const next = abortStaleRuns(items, '');
    if (next !== items) {
      st.items = next;
      st.currentBridgeRunId = '';
      st.pendingRunItemId = '';
      await persist(path, st, { immediate: true });
    }
  }
}

/* ——— Bridge SSE consumer ——— */

function nodeUser(node) {
  return node?.user || config.cli.defaultUser || 'zaza';
}

/**
 * Route an event to its conversation path: the run_id registry first
 * (multi-bridge safe), else machine/user/name from the source.
 */
function pathForEvent(source, event) {
  const viaRun = event.run_id ? runPathIndex.get(String(event.run_id)) : null;
  if (viaRun) return viaRun;
  return conversationKey(source.fallbackNode, source.fallbackUser, event.conversation);
}

async function consumeSource(source, signal) {
  const url = `${source.url.replace(/\/$/, '')}/api/events`;
  while (!signal.aborted) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${source.token}` },
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }
          if (!event?.conversation) continue;
          const path = pathForEvent(source, event);
          try {
            // Await keeps events applied strictly in arrival order (DB is async).
            await applyBridgeEventToStore(path, event);
          } catch (err) {
            console.error(`[timelineBuilder] apply failed (${path}):`, err.message);
          }
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      console.error(`[timelineBuilder] SSE ${source.name}: ${err.message} — retry ${RECONNECT_MS}ms`);
    }
    if (!signal.aborted) {
      await new Promise((r) => { setTimeout(r, RECONNECT_MS); });
    }
  }
}

/**
 * Event sources: every CLI node (cursor bridge per machine) + every agent
 * plugin (claude bridge, …), deduplicated by URL.
 */
function eventSources() {
  const primary = (config.cli.nodes || [])[0] || null;
  const sources = new Map();
  for (const node of config.cli.nodes || []) {
    if (!node?.url) continue;
    sources.set(node.url.replace(/\/$/, ''), {
      name: node.name,
      url: node.url,
      token: node.token || '',
      fallbackNode: node.name,
      fallbackUser: nodeUser(node),
    });
  }
  let plugins = [];
  try { plugins = listAgentPlugins(); } catch { /* env absent */ }
  for (const plugin of plugins) {
    const key = String(plugin.url || '').replace(/\/$/, '');
    if (!key || sources.has(key)) continue;
    sources.set(key, {
      name: plugin.id,
      url: plugin.url,
      token: plugin.token || '',
      // Claude conversations share the machine-based paths of the primary node.
      fallbackNode: primary?.name || plugin.id,
      fallbackUser: primary ? nodeUser(primary) : (config.cli.defaultUser || 'zaza'),
    });
  }
  return [...sources.values()];
}

/** Start one SSE consumer per unique bridge URL (nodes + plugins). Idempotent. */
export function startTimelineBuilder() {
  if (started) return;
  started = true;
  for (const source of eventSources()) {
    const controller = new AbortController();
    consumers.push(controller);
    consumeSource(source, controller.signal);
    console.log(`[timelineBuilder] consuming bridge events from ${source.name} (${source.url})`);
  }
}

export function stopTimelineBuilder() {
  for (const c of consumers) c.abort();
  consumers.length = 0;
  started = false;
}
