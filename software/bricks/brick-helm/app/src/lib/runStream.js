import { toolResultFromEvent } from './toolFormat.js';
import { stripLeadingVoiceAck } from './voiceAckStrip.js';

const genId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export function convNameFromPath(path) {
  const raw = String(path || '');
  const idx = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf(':'));
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

function streamKey(event) {
  return event.composer_id || event.chat_id || event.run_id || 'default';
}

function lastRunningRun(items) {
  if (!Array.isArray(items) || !items.length) return null;
  let lastHuman = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'human') {
      lastHuman = i;
      break;
    }
  }
  // Stream events belong to the current turn — not a stale prime run before the human.
  if (lastHuman >= 0) {
    for (let i = items.length - 1; i > lastHuman; i--) {
      if (items[i].type === 'run' && items[i].status === 'running') return items[i];
    }
  }
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'run' && items[i].status === 'running') return items[i];
  }
  return null;
}

function upsertBlock(blocks, type, patch) {
  const idx = blocks.findIndex((b) => b.type === type && (patch.id ? b.id === patch.id : b.streaming));
  if (idx >= 0) {
    const next = [...blocks];
    next[idx] = { ...next[idx], ...patch };
    return next;
  }
  return [...blocks, { id: genId(), ...patch }];
}

/**
 * Thinking must stay before the assistant answer (late thinking events must not append after).
 */
function upsertThinkingBlock(blocks, patch) {
  const streamingIdx = blocks.findIndex((b) => b.type === 'thinking' && b.streaming);
  if (streamingIdx >= 0) {
    const next = [...blocks];
    next[streamingIdx] = { ...next[streamingIdx], ...patch };
    return next;
  }

  const firstAssistant = blocks.findIndex((b) => b.type === 'assistant');
  if (firstAssistant >= 0) {
    // Prefer extending the last thinking that still sits before the answer
    for (let i = firstAssistant - 1; i >= 0; i--) {
      if (blocks[i].type === 'thinking') {
        const next = [...blocks];
        next[i] = {
          ...next[i],
          ...patch,
          text: patch.text != null ? patch.text : next[i].text,
          streaming: patch.streaming !== undefined ? patch.streaming : next[i].streaming,
        };
        return next;
      }
    }
    const next = [...blocks];
    next.splice(firstAssistant, 0, { id: genId(), type: 'thinking', ...patch });
    return next;
  }

  const lastThinking = [...blocks].map((b, i) => ({ b, i })).reverse().find((x) => x.b.type === 'thinking');
  if (lastThinking) {
    const next = [...blocks];
    next[lastThinking.i] = { ...next[lastThinking.i], ...patch };
    return next;
  }

  return [...blocks, { id: genId(), type: 'thinking', ...patch }];
}

function appendThinkingDelta(blocks, delta) {
  if (!delta) return blocks;
  const streamingIdx = blocks.findIndex((b) => b.type === 'thinking' && b.streaming);
  if (streamingIdx >= 0) {
    const cur = blocks[streamingIdx].text || '';
    if (delta === cur || (cur && delta.startsWith(cur))) {
      const next = [...blocks];
      next[streamingIdx] = {
        ...next[streamingIdx],
        text: delta.length >= cur.length ? delta : cur,
      };
      return next;
    }
    if (cur && cur.endsWith(delta)) return blocks;
    const next = [...blocks];
    next[streamingIdx] = { ...next[streamingIdx], text: cur + delta };
    return next;
  }

  const firstAssistant = blocks.findIndex((b) => b.type === 'assistant');
  if (firstAssistant >= 0) {
    for (let i = firstAssistant - 1; i >= 0; i--) {
      if (blocks[i].type === 'thinking') {
        const cur = blocks[i].text || '';
        const next = [...blocks];
        next[i] = { ...next[i], text: cur + delta, streaming: false };
        return next;
      }
    }
    const next = [...blocks];
    next.splice(firstAssistant, 0, {
      id: genId(),
      type: 'thinking',
      text: delta,
      streaming: false,
    });
    return next;
  }

  return [...blocks, {
    id: genId(),
    type: 'thinking',
    text: delta,
    streaming: true,
  }];
}

function appendDelta(blocks, type, delta, extra = {}) {
  if (!delta) return blocks;
  if (type === 'thinking') return appendThinkingDelta(blocks, delta);
  const idx = blocks.findIndex((b) => b.type === type && b.streaming);
  if (idx >= 0) {
    const cur = blocks[idx].text || '';
    // Bridge sometimes returns the full snapshot as a "delta" → do not duplicate
    if (delta === cur || (cur && delta.startsWith(cur))) {
      const next = [...blocks];
      next[idx] = { ...next[idx], text: delta.length >= cur.length ? delta : cur };
      return next;
    }
    if (cur && cur.endsWith(delta)) return blocks;
    const next = [...blocks];
    next[idx] = { ...next[idx], text: cur + delta };
    return next;
  }
  return [...blocks, { id: genId(), type, text: delta, streaming: true, ...extra }];
}

/**
 * Collapse duplicated stream text:
 * - exact full message ×2
 * - repeated chunks (A+A+B+B → A+B) seen with Grok voice turns
 */
function undoubleText(text, previous = '') {
  let t = String(text || '');
  if (!t) return previous || '';
  const prev = String(previous || '');
  if (prev && t === prev + prev) return prev;

  const half = Math.floor(t.length / 2);
  if (half >= 12 && t.length === half * 2 && t.slice(0, half) === t.slice(half)) {
    return t.slice(0, half);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let len = Math.floor(t.length / 2); len >= 12; len -= 1) {
      if (t.slice(0, len) === t.slice(len, len * 2)) {
        t = t.slice(0, len) + t.slice(len * 2);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    for (let len = Math.floor(t.length / 2); len >= 12; len -= 1) {
      if (t.length >= len * 2 && t.slice(-len) === t.slice(-len * 2, -len)) {
        t = t.slice(0, -len);
        changed = true;
        break;
      }
    }
  }
  return t;
}

/** Mark matching (or oldest same-type) running tool as done when tool_complete arrives. */
function closeRunningToolBlocks(blocks, { callId = '', result = '', tool = '' } = {}) {
  const list = Array.isArray(blocks) ? blocks.slice() : [];
  const id = String(callId || '');
  const wantTool = String(tool || '').trim()
    ? String(tool).charAt(0).toLowerCase() + String(tool).slice(1)
    : '';

  let matched = false;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.type !== 'tool' || b.status !== 'running') continue;
    if (id && b.id === id) {
      list[i] = { ...b, status: 'done', ...(result ? { result } : {}) };
      matched = true;
      break;
    }
  }
  if (matched) return list;

  // Missing/mismatched call_id — prefer oldest running tool of the same kind.
  if (wantTool) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.type !== 'tool' || b.status !== 'running') continue;
      const name = String(b.tool || '');
      const norm = name.charAt(0).toLowerCase() + name.slice(1);
      if (norm === wantTool) {
        list[i] = { ...b, status: 'done', ...(result ? { result } : {}) };
        return list;
      }
    }
  }

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.type === 'tool' && b.status === 'running') {
      list[i] = { ...b, status: 'done', ...(result ? { result } : {}) };
      break;
    }
  }
  return list;
}

function closeAllRunningTools(blocks) {
  return (blocks || []).map((b) => (
    b.type === 'tool' && b.status === 'running'
      ? { ...b, status: 'done' }
      : b
  ));
}

function stopStreamingThinking(blocks) {
  return (blocks || []).map((b) => (
    b.type === 'thinking' && b.streaming
      ? { ...b, streaming: false }
      : b
  ));
}

function lastRun(items) {
  for (let i = (items || []).length - 1; i >= 0; i--) {
    if (items[i].type === 'run') return items[i];
  }
  return null;
}

function setRun(items, runId, patch) {
  return items.map((it) => (it.type === 'run' && it.id === runId ? { ...it, ...patch } : it));
}

function ensureRunningRun(items, key = 'default') {
  const run = lastRunningRun(items);
  if (run) return items;
  const id = genId();
  const now = Date.now();
  return [...items, {
    type: 'run',
    id,
    streamId: key,
    status: 'running',
    blocks: [],
    time: now,
    updatedAt: now,
  }];
}

function patchRunningRun(items, patchFn) {
  const run = lastRunningRun(items);
  if (run) {
    const patch = patchFn(run) || {};
    return setRun(items, run.id, { ...patch, updatedAt: Date.now() });
  }

  // Never attach stream events to an empty conversation (post-clear prime / idle SSE).
  if (!items.some((it) => it.type === 'human')) return items;

  // No live run: only create one if the timeline has never had a run (first event race).
  // Never spawn a ghost run after a completed turn — that left orphan "en cours" spinners.
  if (items.some((it) => it.type === 'run')) return items;

  const base = ensureRunningRun(items);
  const created = lastRunningRun(base);
  if (!created) return items;
  const patch = patchFn(created) || {};
  return setRun(base, created.id, { ...patch, updatedAt: Date.now() });
}

function findLastRunningRunIndex(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'run' && items[i].status === 'running') return i;
  }
  return -1;
}

/** Move thinking blocks that landed after the assistant back before it. */
export function relocateLateThinking(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return blocks || [];
  const firstAi = blocks.findIndex((b) => b.type === 'assistant');
  if (firstAi < 0) return blocks;
  const late = [];
  const kept = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i > firstAi && blocks[i].type === 'thinking') late.push({ ...blocks[i], streaming: false });
    else kept.push(blocks[i]);
  }
  if (!late.length) return blocks;
  const ai = kept.findIndex((b) => b.type === 'assistant');
  if (ai < 0) return [...late, ...kept];
  return [...kept.slice(0, ai), ...late, ...kept.slice(ai)];
}

/** Finalizes a run: stops streaming, status done. */
export function finalizeRunningRun(run, event = {}) {
  if (!run || run.type !== 'run') return run;
  const voiceTurn = Boolean(run.voiceTurn);
  let blocks = (run.blocks || []).map((b) => {
    let text = b.text;
    if (b.type === 'assistant' && event.text && event.type === 'response_complete') {
      text = undoubleText(event.text, b.text);
    }
    if (b.type === 'assistant' && voiceTurn && text) {
      text = stripLeadingVoiceAck(text);
    }
    return {
      ...b,
      streaming: false,
      ...(text !== undefined && b.type === 'assistant' ? { text } : {}),
      // Close every open tool (shell, read, edit, grep, …) — not only shell.
      ...(b.type === 'tool' && b.status !== 'done' && b.status !== 'error'
        ? { status: 'done' }
        : {}),
    };
  });
  const hasAssistant = blocks.some((b) => b.type === 'assistant' && b.text);
  if (!hasAssistant && event.text && event.type === 'response_complete') {
    const text = voiceTurn
      ? stripLeadingVoiceAck(undoubleText(event.text))
      : undoubleText(event.text);
    blocks = [...blocks, {
      id: genId(),
      type: 'assistant',
      text,
      streaming: false,
    }];
  }
  blocks = relocateLateThinking(blocks);
  return {
    ...run,
    status: 'done',
    streamId: streamKey(event) || run.streamId,
    blocks,
  };
}

/** Drop empty runs left by SSE init after a conversation clear (no human yet). */
function stripOrphanEmptyRuns(items) {
  if (!Array.isArray(items) || !items.length) return [];
  let seenHuman = false;
  const out = items.filter((it) => {
    if (it.type === 'human') {
      seenHuman = true;
      return true;
    }
    if (it.type === 'run' && !seenHuman && !it.prime) {
      const blocks = it.blocks || [];
      const empty = !blocks.length || !blocks.some((b) => (
        (b.type === 'assistant' && String(b.text || '').trim())
        || (b.type === 'thinking' && String(b.text || '').trim())
        || b.type === 'tool'
        || (b.type === 'log' && String(b.text || '').trim())
      ));
      if (empty) return false;
    }
    return true;
  });
  return out.length === items.length ? items : out;
}

/** Repairs persisted timelines (stuck streaming). */
export function sanitizeTimeline(items) {
  if (!Array.isArray(items)) return [];
  const stripped = stripOrphanEmptyRuns(items);
  let changed = stripped !== items;
  const next = stripped.map((it) => {
    if (it.type !== 'run') return it;
    if (it.status !== 'done' && it.status !== 'aborted') return it;

    let blocksChanged = false;
    const blocks = relocateLateThinking((it.blocks || []).map((b) => {
      let nextBlock = b;
      if (b.streaming) {
        nextBlock = { ...nextBlock, streaming: false };
        blocksChanged = true;
      }
      if (b.type === 'tool' && b.status !== 'done' && b.status !== 'error') {
        nextBlock = { ...nextBlock, status: 'done', streaming: false };
        blocksChanged = true;
      }
      return nextBlock;
    }));
    if (!blocksChanged && blocks === it.blocks) return it;
    // relocateLateThinking may return a new array even if unchanged — compare tool statuses
    const sameTools = (it.blocks || []).length === blocks.length
      && (it.blocks || []).every((b, i) => (
        b === blocks[i]
        || (b.type === blocks[i].type
          && b.status === blocks[i].status
          && Boolean(b.streaming) === Boolean(blocks[i].streaming))
      ));
    if (sameTools && !blocksChanged) return it;
    changed = true;
    return { ...it, blocks };
  });
  return changed ? next : items;
}

/**
 * Applies a bridge SSE event → timeline (human + multi-block runs).
 * @returns {Array} new timeline
 */
export function applyStreamEvent(items, event) {
  if (event.type === 'ping' || event.type === 'connected') return items;

  if (event.type === 'system' && event.subtype === 'init') {
    return patchRunningRun(items, (run) => ({
      model: event.model || run.model,
    }));
  }

  if (event.type === 'thinking') {
    return patchRunningRun(items, (run) => {
      let blocks = run.blocks;
      if (event.subtype === 'completed') {
        blocks = blocks.map((b) => (
          b.type === 'thinking' ? { ...b, streaming: false } : b
        ));
        return { blocks };
      }
      if (event.delta) {
        blocks = appendThinkingDelta(blocks, event.delta);
      } else if (event.text) {
        blocks = upsertThinkingBlock(blocks, { text: event.text, streaming: true });
      }
      return { blocks };
    });
  }

  if (event.type === 'tool') {
    const toolName = event.tool || 'tool';
    const toolId = event.call_id
      ? String(event.call_id)
      : `tool-${toolName}-${Date.now()}`;
    return patchRunningRun(items, (run) => {
      let blocks = stopStreamingThinking(run.blocks || []);
      const nextBlock = {
        id: toolId,
        type: 'tool',
        tool: toolName,
        input: event.input || '',
        command: event.command || null,
        cwd: event.cwd || null,
        status: 'running',
      };
      // Upsert by call_id — never append duplicates (was flooding “Terminal terminé”).
      const existing = blocks.findIndex((b) => b.type === 'tool' && b.id === toolId);
      if (existing >= 0) {
        blocks = blocks.slice();
        const prev = blocks[existing];
        blocks[existing] = {
          ...prev,
          ...nextBlock,
          status: prev.status === 'done' || prev.status === 'error' ? prev.status : 'running',
          result: prev.result,
        };
        return { blocks };
      }
      // Same shell command already running → ignore echo / duplicate start.
      if (
        toolName === 'shell'
        && nextBlock.command
        && blocks.some((b) => (
          b.type === 'tool'
          && b.tool === 'shell'
          && b.status === 'running'
          && b.command === nextBlock.command
        ))
      ) {
        return { blocks };
      }
      return { blocks: [...blocks, nextBlock] };
    });
  }

  if (event.type === 'tool_complete') {
    const callId = event.call_id;
    const result = toolResultFromEvent(event);
    const tool = event.tool || '';
    // Prefer live run; else last run (late complete after response_complete).
    const run = lastRunningRun(items) || lastRun(items);
    if (!run) return items;
    return setRun(items, run.id, {
      blocks: closeRunningToolBlocks(run.blocks, { callId, result, tool }),
    });
  }

  if (event.type === 'log' && event.text) {
    return patchRunningRun(items, (run) => ({
      blocks: [...run.blocks, {
        id: genId(),
        type: 'log',
        text: event.text,
      }],
    }));
  }

  if (event.type === 'run_aborted') {
    // Stop actions update the local timeline synchronously. A late SSE event from
    // a previous run has no run identifier and must not abort a newly injected run.
    return items;
  }

  if (event.type === 'response') {
    const key = streamKey(event);
    return patchRunningRun(items, (run) => {
      // Assistant text means tools/thinking for this step are finished — stop their spinners.
      let blocks = closeAllRunningTools(stopStreamingThinking(run.blocks));
      const idx = blocks.findIndex((b) => b.type === 'assistant' && b.streaming);
      const cur = idx >= 0 ? (blocks[idx].text || '') : '';
      let absolute = event.text ? undoubleText(event.text, cur) : '';
      if (absolute && run.voiceTurn) absolute = stripLeadingVoiceAck(absolute);

      // Absolute text from bridge takes priority if it extends (or corrects) the buffer
      if (absolute && (!cur || absolute.startsWith(cur) || cur.startsWith(absolute) || run.voiceTurn)) {
        if (absolute.length >= cur.length || (run.voiceTurn && absolute !== cur)) {
          if (idx >= 0) {
            blocks = [...blocks];
            blocks[idx] = { ...blocks[idx], text: absolute };
          } else if (absolute) {
            blocks = [...blocks, {
              id: genId(),
              type: 'assistant',
              text: absolute,
              streaming: true,
            }];
          }
        }
      } else if (event.delta) {
        blocks = appendDelta(blocks, 'assistant', event.delta);
        if (run.voiceTurn) {
          const aIdx = blocks.findIndex((b) => b.type === 'assistant' && b.streaming);
          if (aIdx >= 0 && blocks[aIdx].text) {
            blocks = [...blocks];
            blocks[aIdx] = {
              ...blocks[aIdx],
              text: stripLeadingVoiceAck(blocks[aIdx].text),
            };
          }
        }
      }

      blocks = blocks.map((b) => (
        b.type === 'thinking' && b.streaming ? { ...b, streaming: false } : b
      ));
      return { streamId: key, blocks };
    });
  }

  if (event.type === 'response_complete') {
    const idx = findLastRunningRunIndex(items);
    if (idx < 0) return items;
    const next = [...items];
    next[idx] = finalizeRunningRun(items[idx], event);
    return next;
  }

  if (event.type === 'run_complete') {
    return items.map((it) => (
      it.type === 'run' && it.status === 'running' ? finalizeRunningRun(it, event) : it
    ));
  }

  return items;
}

/** Marks in-progress runs as aborted (user stop). */
export function abortRunningRuns(items, reason = 'stopped') {
  const label = reason === 'stopped' ? 'Arrêté par l\'utilisateur' : `Arrêté (${reason})`;
  return items.map((it) => {
    if (it.type !== 'run' || it.status !== 'running') return it;
    const blocks = it.blocks.map((b) => ({
      ...b,
      streaming: false,
      ...(b.type === 'tool' && b.status !== 'done' && b.status !== 'error' ? { status: 'done' } : {}),
    }));
    return {
      ...it,
      status: 'aborted',
      blocks: [
        ...blocks,
        {
          type: 'system',
          id: genId(),
          text: label,
        },
      ],
    };
  });
}

/**
 * Adds the human turn + queued run. `opts.humanId` / `opts.runId`
 * allow client and server to produce items with matching ids
 * (server timeline = source of truth, convergent local display).
 */
export function pushHuman(items, text, images = [], opts = {}) {
  const runId = opts.runId || genId();
  const humanId = opts.humanId || genId();
  const imgs = images.map((img) => ({
    id: img.id || genId(),
    url: img.url || img.dataUrl,
    name: img.name || 'image',
    ...(img.kind ? { kind: img.kind } : {}),
  }));
  return {
    timeline: [
      ...items,
      {
        type: 'human',
        id: humanId,
        text: text || '',
        images: imgs,
        time: Date.now(),
      },
      {
        type: 'run',
        id: runId,
        streamId: `pending-${runId}`,
        status: 'running',
        ...(opts.voiceTurn ? { voiceTurn: true } : {}),
        blocks: [],
        time: Date.now(),
      },
    ],
    runId,
    humanId,
  };
}

/**
 * Insert Groq voice ack between the latest human message and its Composer run.
 * Distinct timeline item — never merged into the assistant block.
 */
export function insertVoiceAck(items, text) {
  const ackText = String(text || '').trim();
  if (!ackText || !Array.isArray(items) || !items.length) return items;

  const out = items.slice();
  let humanIdx = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].type === 'human') {
      humanIdx = i;
      break;
    }
  }
  if (humanIdx < 0) return items;

  const insertAt = humanIdx + 1;
  // Update existing ack for this turn (placeholder → final text)
  if (out[insertAt]?.type === 'voice_ack') {
    if (out[insertAt].text === ackText) return items;
    out[insertAt] = { ...out[insertAt], text: ackText, time: Date.now() };
    return out;
  }

  out.splice(insertAt, 0, {
    type: 'voice_ack',
    id: genId(),
    text: ackText,
    time: Date.now(),
  });
  return out;
}

/**
 * True when the latest user turn only has a Groq ack in flight (save race), not a full history.
 */
function isInflightVoiceTurn(items) {
  if (!Array.isArray(items) || !items.length) return false;
  let lastHuman = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'human') {
      lastHuman = i;
      break;
    }
  }
  if (lastHuman < 0) return false;
  const tail = items.slice(lastHuman + 1);
  if (!tail.some((it) => it.type === 'voice_ack')) return false;
  return !tail.some((it) => it.type === 'run' && it.status === 'done');
}

/**
 * Merge local + server timelines without dropping Groq voice_ack bubbles.
 * Server save can race behind the ack insert — never let that wipe the bubble.
 * When the server is empty (conversation cleared), never resurrect a full local history.
 */
/** True when a prime run has a visible greeting (briefing done). */
export function primeBriefingReady(run) {
  if (!run || run.type !== 'run' || !run.prime) return false;
  if (run.status !== 'done') return false;
  return (run.blocks || []).some((b) => (
    b.type === 'assistant' && String(b.text || '').trim()
  ));
}

/** True when prime is still waiting for its first greeting. */
export function primeBriefingPending(run) {
  if (!run || run.type !== 'run' || !run.prime) return false;
  if (run.status !== 'running') return false;
  return !(run.blocks || []).some((b) => (
    b.type === 'assistant' && String(b.text || '').trim()
  ));
}

/**
 * After response_complete, replace local timeline when server briefing finished
 * but the browser still shows an empty running prime (SSE race / bridge restart).
 */
export function shouldReplaceTimelineAfterComplete(local, server) {
  const a = Array.isArray(local) ? local : [];
  const b = Array.isArray(server) ? server : [];
  const localPrime = a.find((it) => it.type === 'run' && it.prime);
  const serverPrime = b.find((it) => it.type === 'run' && it.prime);
  if (!localPrime || !serverPrime) return false;
  return primeBriefingReady(serverPrime) && primeBriefingPending(localPrime);
}

export function mergeTimelinesPreferVoiceAck(local, server) {
  const a = Array.isArray(local) ? local : [];
  const b = Array.isArray(server) ? server : [];
  if (!a.length) return sanitizeTimeline(b);
  if (!b.length) {
    if (isInflightVoiceTurn(a) || isPresentationRunning(a)) return sanitizeTimeline(a);
    return sanitizeTimeline([]);
  }

  // Fresh clear+prime on server: never resurrect a longer pre-clear local history.
  const serverFreshPrime = b.length === 1 && b[0]?.type === 'run' && b[0]?.prime;
  if (serverFreshPrime && a.length > 1) {
    const localHasSamePrime = a.some((it) => it?.id && it.id === b[0].id);
    if (!localHasSamePrime) return sanitizeTimeline(b);
  }

  // Briefing finished on server while local still shows an empty running prime.
  if (a.length === 1 && b.length === 1) {
    const aRun = a[0];
    const bRun = b[0];
    if (aRun?.type === 'run' && bRun?.type === 'run' && aRun.prime && bRun.prime) {
      const aReady = primeBriefingReady(aRun);
      const bReady = primeBriefingReady(bRun);
      if (aReady && !bReady) return sanitizeTimeline(a);
      if (bReady && !aReady) return sanitizeTimeline(b);
    }
  }

  let base;
  let other;
  if (a.length > b.length) {
    base = a.slice();
    other = b;
  } else if (b.length > a.length) {
    base = b.slice();
    other = a;
  } else {
    const aHasRun = a.some((it) => it.type === 'run');
    const bHasRun = b.some((it) => it.type === 'run');
    const aHasAck = a.some((it) => it.type === 'voice_ack');
    const bHasAck = b.some((it) => it.type === 'voice_ack');
    if (bHasRun && !aHasRun) {
      base = b.slice();
      other = a;
    } else if (aHasAck && !bHasAck) {
      base = a.slice();
      other = b;
    } else {
      base = a.slice();
      other = b;
    }
  }

  // Re-inject any voice_ack from the shorter side that base is missing after each human.
  for (let i = 0; i < other.length; i++) {
    if (other[i].type !== 'voice_ack') continue;
    const ack = other[i];
    const already = base.some((it) => it.type === 'voice_ack' && it.id === ack.id);
    if (already) continue;
    const sameText = base.some((it) => (
      it.type === 'voice_ack' && String(it.text || '').trim() === String(ack.text || '').trim()
    ));
    if (sameText) continue;
    // Place after nearest preceding human from other
    let humanText = '';
    for (let j = i - 1; j >= 0; j--) {
      if (other[j].type === 'human') {
        humanText = String(other[j].text || '').trim();
        break;
      }
    }
    let inserted = false;
    if (humanText) {
      for (let k = base.length - 1; k >= 0; k--) {
        if (base[k].type === 'human' && String(base[k].text || '').trim() === humanText) {
          if (base[k + 1]?.type !== 'voice_ack') {
            base.splice(k + 1, 0, { ...ack });
          }
          inserted = true;
          break;
        }
      }
    }
    if (!inserted) {
      // Fallback: append before last run if any
      let runIdx = -1;
      for (let k = base.length - 1; k >= 0; k--) {
        if (base[k].type === 'run') { runIdx = k; break; }
      }
      if (runIdx >= 0) base.splice(runIdx, 0, { ...ack });
      else base.push({ ...ack });
    }
  }

  return sanitizeTimeline(base);
}

/** Empty shell after tab refresh / bridge never started. */
const STUCK_EMPTY_RUN_MS = 2 * 60_000;
/** Idle with no stream activity — Cursor agent turns often last many minutes. */
const STUCK_RUN_MS = 45 * 60_000;
const STUCK_PRIME_MS = 3 * 60_000;

function runLastActivityMs(run) {
  const updated = Number(run?.updatedAt) || 0;
  if (updated) return updated;
  // Fallback: latest block timestamp if present, else run start time.
  let latest = Number(run?.time) || 0;
  for (const b of run?.blocks || []) {
    const t = Number(b?.time) || 0;
    if (t > latest) latest = t;
  }
  return latest;
}

/**
 * Abort runs truly stuck after refresh or bridge hang.
 * Uses last activity (updatedAt), NOT start time — long agent turns must not be killed at 45s.
 */
export function sanitizeStuckRuns(items, { now = Date.now() } = {}) {
  if (!Array.isArray(items) || !items.length) return items;
  let changed = false;
  const next = items.map((it) => {
    if (it.type !== 'run' || it.status !== 'running') return it;
    const activity = runLastActivityMs(it);
    if (!activity) return it;
    const age = now - activity;
    const empty = isEmptyRunShell(it);
    const limit = it.prime
      ? STUCK_PRIME_MS
      : (empty ? STUCK_EMPTY_RUN_MS : STUCK_RUN_MS);
    if (age < limit) return it;
    changed = true;
    if (it.prime) {
      const [settled] = settlePrimeRunsBeforeTurn([it]);
      if (settled && settled.status !== 'running') return settled;
    }
    return abortRunningRuns([it], 'session expirée')[0];
  });
  return changed ? next : items;
}

/** Undo false "session expirée" aborts on persisted timelines (pre-fix stuck-run logic). */
export function repairExpiredAbortedRuns(items) {
  if (!Array.isArray(items) || !items.length) return items;
  let changed = false;
  const next = [];
  for (const it of items) {
    if (it.type !== 'run' || it.status !== 'aborted') {
      next.push(it);
      continue;
    }
    const blocks = it.blocks || [];
    const hasExpired = blocks.some((b) => (
      b.type === 'system' && /session expirée/i.test(String(b.text || ''))
    ));
    if (!hasExpired) {
      next.push(it);
      continue;
    }
    const cleaned = blocks.filter((b) => !(
      b.type === 'system' && /session expirée/i.test(String(b.text || ''))
    ));
    const hasContent = cleaned.some((b) => (
      (b.type === 'assistant' && String(b.text || '').trim())
      || (b.type === 'thinking' && String(b.text || '').trim())
      || b.type === 'tool'
      || (b.type === 'log' && String(b.text || '').trim())
    ));
    changed = true;
    if (!hasContent) continue;
    next.push({ ...it, status: 'done', blocks: cleaned });
  }
  return changed ? next : items;
}

/**
 * Assistant block that should receive live karaoke highlighting.
 * While a run is streaming, only its assistant qualifies — never an older message.
 */
export function resolveLiveKaraokeBlockId(items) {
  const list = Array.isArray(items) ? items : [];

  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (item?.type !== 'run' || item.status !== 'running') continue;
    const blocks = item.blocks || [];
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j];
      if (b?.type !== 'assistant') continue;
      if (b.streaming || String(b.text || '').trim()) return b.id;
    }
    return '';
  }

  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (item?.type !== 'run' || !Array.isArray(item.blocks)) continue;
    for (let j = item.blocks.length - 1; j >= 0; j--) {
      const b = item.blocks[j];
      if (b?.type === 'assistant' && String(b.text || '').trim()) return b.id;
    }
  }
  return '';
}

/** True if a presentation (prime) run is still streaming. */
export function isPresentationRunning(items) {
  if (!Array.isArray(items)) return false;
  return items.some((it) => (
    it.type === 'run' && it.prime && it.status === 'running'
  ));
}

/** Alias — presentation runs use the prime flag. */
export function isPresentationRun(run) {
  return Boolean(run?.type === 'run' && run.prime);
}

/** True if this run is an empty shell (outline with no useful content). */
export function isEmptyRunShell(run) {
  if (!run || run.type !== 'run') return false;
  const blocks = run.blocks || [];
  if (!blocks.length) return true;
  return !blocks.some((b) => (
    (b.type === 'assistant' && String(b.text || '').trim())
    || (b.type === 'thinking' && String(b.text || '').trim())
    || b.type === 'tool'
    || (b.type === 'log' && String(b.text || '').trim())
    || (b.type === 'system' && String(b.text || '').trim())
  ));
}

/** Close running presentation runs when the user starts a new turn. */
export function settlePrimeRunsBeforeTurn(items) {
  if (!Array.isArray(items) || !items.length) return items;
  let changed = false;
  const next = items.map((it) => {
    if (it.type !== 'run' || !it.prime || it.status !== 'running') return it;
    changed = true;
    if (isEmptyRunShell(it)) {
      return { ...it, status: 'aborted' };
    }
    const blocks = (it.blocks || []).map((b) => ({ ...b, streaming: false }));
    return { ...it, status: 'done', blocks };
  });
  return changed ? next : items;
}

/** In-progress run with actual activity (not merely running status between two events). */
export function isRunActive(run) {
  if (!run || run.type !== 'run' || run.status !== 'running') return false;
  const blocks = run.blocks || [];
  if (!blocks.length) return true;
  return blocks.some((b) => (
    (b.type === 'thinking' && b.streaming)
    || (b.type === 'tool' && b.status === 'running')
    || (b.type === 'assistant' && b.streaming)
  ));
}

export function isStreaming(items) {
  return items.some((it) => it.type === 'run' && isRunActive(it));
}

/** Final assistant text of a completed run. */
function assistantTextFromRun(run) {
  if (!run || run.type !== 'run') return '';
  const blocks = run.blocks || [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'assistant' && b.text) return b.text;
  }
  return '';
}

function exchangeLabels(locale = 'fr') {
  const lang = String(locale || 'fr').slice(0, 2).toLowerCase();
  if (lang === 'en') return { user: 'User', assistant: 'Assistant' };
  if (lang === 'es') return { user: 'Usuario', assistant: 'Asistente' };
  return { user: 'Utilisateur', assistant: 'Assistant' };
}

function exchangeLines(items, locale = 'fr') {
  const { user, assistant } = exchangeLabels(locale);
  const lines = [];
  for (const item of items) {
    if (item.type === 'human' && item.text?.trim()) {
      lines.push(`${user}: ${item.text.trim()}`);
    }
    if (item.type === 'run') {
      const reply = assistantTextFromRun(item);
      if (reply.trim()) lines.push(`${assistant}: ${reply.trim()}`);
    }
  }
  return lines;
}

function lastHumanIndex(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.type === 'human') return i;
  }
  return -1;
}

function rollingContextHeader(locale = 'fr') {
  const lang = String(locale || 'fr').slice(0, 2).toLowerCase();
  if (lang === 'en') {
    return '[Conversation history — retain this context for your reply]\n';
  }
  if (lang === 'es') {
    return '[Historial de conversación — conserva este contexto para tu respuesta]\n';
  }
  return '[Historique de conversation — retiens ce contexte pour ta réponse]\n';
}

function truncateExchangeLines(lines, maxChars) {
  const limit = Number(maxChars) > 0 ? Number(maxChars) : 12000;
  if (!lines.length) return lines;
  let body = lines.join('\n\n');
  if (body.length <= limit) return lines;
  let trimmed = [...lines];
  while (trimmed.length > 1 && body.length > limit) {
    trimmed.shift();
    body = trimmed.join('\n\n');
  }
  return trimmed;
}

/**
 * Rolling chat history for stateless models (LiteLLM / OpenRouter via --bare).
 * Excludes the latest human turn (current message) by default.
 */
export function buildRollingContextPrefix(items, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const locale = opts.locale || 'fr';
  const maxChars = opts.maxChars ?? 12000;
  const excludeLastHuman = opts.excludeLastHuman !== false;

  let slice = list;
  if (excludeLastHuman) {
    const idx = lastHumanIndex(list);
    if (idx <= 0) return '';
    slice = list.slice(0, idx);
  }

  const lines = truncateExchangeLines(exchangeLines(slice, locale), maxChars);
  if (!lines.length) return '';
  return `${rollingContextHeader(locale)}${lines.join('\n\n')}\n\n---\n\n`;
}

/** Conversation context before a human message (for resume after edit). */
export function buildContextPrefix(items, humanIndex) {
  if (humanIndex <= 0) return '';
  const lines = exchangeLines(items.slice(0, humanIndex));
  if (!lines.length) return '';
  return `[Contexte précédent — reprise après modification d'un message]\n${lines.join('\n\n')}\n\n---\n\n`;
}

/** Keeps only entries up to the target human message (inclusive). */
export function truncateFromHuman(items, humanId) {
  const idx = items.findIndex((it) => it.type === 'human' && it.id === humanId);
  if (idx < 0) return { ok: false, timeline: items, index: -1 };
  return { ok: true, timeline: items.slice(0, idx + 1), index: idx };
}

/**
 * Modifies a user message, drops subsequent turns, adds a new run.
 * @returns injectText — text to send to the CLI (with context if needed)
 */
export function prepareResendFromHuman(items, humanId, newText, newImages, opts = {}) {
  const { ok, timeline, index } = truncateFromHuman(items, humanId);
  if (!ok) return { ok: false };

  const updated = [...timeline];
  updated[index] = {
    ...updated[index],
    text: newText || '',
    images: newImages ?? updated[index].images ?? [],
    edited_at: Date.now(),
  };

  const contextPrefix = buildContextPrefix(updated, index);
  const runId = opts.runId || genId();
  const nextTimeline = [
    ...updated,
    {
      type: 'run',
      id: runId,
      streamId: `pending-${runId}`,
      status: 'running',
      blocks: [],
      time: Date.now(),
    },
  ];

  const injectText = `${contextPrefix}${newText || ''}`.trim();
  return {
    ok: true,
    timeline: nextTimeline,
    runId,
    injectText,
    hadContext: Boolean(contextPrefix),
  };
}

/** Full timeline normalization on load / merge / persist. */
export function normalizeTimelineItems(items, opts) {
  if (!Array.isArray(items)) return [];
  return sanitizeStuckRuns(repairExpiredAbortedRuns(sanitizeTimeline(items)), opts);
}
