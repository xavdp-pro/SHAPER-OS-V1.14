import {
  isPresentationRunning,
  mergeTimelinesPreferVoiceAck,
  normalizeTimelineItems,
} from './runStream.js';

export const SESSION_SAVE_GUARD_MS = 12_000;
/** Brief window after timeline wipe — block stale SSE only when no prime is running. */
export const SESSION_STALE_SSE_GUARD_MS = 3_000;

/** True when a run has visible assistant text. */
export function hasAssistantContent(run) {
  if (!run || run.type !== 'run') return false;
  return (run.blocks || []).some((b) => (
    b.type === 'assistant' && String(b.text || '').trim()
  ));
}

/**
 * Whether the session still needs a briefing greeting.
 * Retries when only a failed/aborted prime exists (no assistant reply).
 */
export function shouldPrimeSession(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return true;
  if (list.some((it) => it.type === 'human')) return false;
  if (list.some((it) => it.type === 'run' && !it.prime && hasAssistantContent(it))) return false;
  if (list.some((it) => it.type === 'run' && !it.prime)) return false;
  const primes = list.filter((it) => it.type === 'run' && it.prime);
  if (!primes.length) return true;
  if (primes.some((r) => r.status === 'running')) return false;
  return primes.every((r) => !hasAssistantContent(r));
}

/** Timeline has a prime run and no human message yet — briefing-only session. */
export function isPrimeOnlyTimeline(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.some((it) => it.type === 'human')) return false;
  return list.some((it) => it.type === 'run' && it.prime);
}

/** Prime run that finished with a visible greeting (presentation text shown). */
export function getCompletedPrimeRun(items) {
  const list = Array.isArray(items) ? items : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const it = list[i];
    if (it?.type !== 'run' || !it.prime) continue;
    if (it.status === 'running') return null;
    if (hasAssistantContent(it)) return it;
  }
  return null;
}

/**
 * Auto-speak presentation only when the prime stream just finished in this session.
 * Never on F5 / cold load of an already-read timeline (even with posts after).
 */
export function shouldAutoSpeakPresentation({ wasPresenting = false, presenting = false, items } = {}) {
  if (presenting) return false;
  if (!wasPresenting) return false;
  if (!isPrimeOnlyTimeline(items)) return false;
  return Boolean(getCompletedPrimeRun(items));
}

/** First assistant block with text on a prime / presentation run. */
export function getPrimeAssistantBlock(run) {
  if (!run?.prime || !Array.isArray(run.blocks)) return null;
  for (const block of run.blocks) {
    if (block?.type === 'assistant' && String(block.text || '').trim()) return block;
  }
  return null;
}

const helpNudgeKey = (path) => `helm2-help-nudge-seen:${String(path || '').trim()}`;

/** Auto-dismiss help « ? » pulse after 10 seconds. */
export const HELP_NUDGE_AUTO_DISMISS_MS = 10 * 1000;

export function isHelpNudgeSeen(path, primeRunId) {
  if (!path || !primeRunId) return false;
  try {
    return localStorage.getItem(helpNudgeKey(path)) === String(primeRunId);
  } catch {
    return false;
  }
}

export function markHelpNudgeSeen(path, primeRunId) {
  if (!path || !primeRunId) return;
  try {
    localStorage.setItem(helpNudgeKey(path), String(primeRunId));
  } catch {
    /* ignore */
  }
}

/**
 * Prime briefing voice still playing — defer help nudge until idle.
 * When speaker + karaoke are on, wait for TTS/karaoke to finish after text stream.
 */
export function isPrimeVoicePending(items, {
  voicePlaybackOn = false,
  karaokeOn = false,
  voicePlaying = false,
  voiceBusy = false,
  karaokeWordsLength = 0,
} = {}) {
  if (!voicePlaybackOn || !karaokeOn) return false;
  if (!voicePlaying && !voiceBusy && karaokeWordsLength <= 0) return false;
  if (!Array.isArray(items) || items.some((it) => it.type === 'human')) return false;
  return items.some((it) => (
    it.type === 'run'
    && it.prime
    && (it.status === 'running' || hasAssistantContent(it))
  ));
}

/** Text stream and/or prime TTS still in progress. */
export function isPresentationActive(items, voiceOpts = {}) {
  return isPresentationRunning(items) || isPrimeVoicePending(items, voiceOpts);
}

/** Help « ? » glow — never during briefing stream or deferred prime voice. */
export function isHelpHighlightAllowed(items, {
  helpNudge = false,
  helpOpen = false,
  presentationActive = false,
  voicePlaybackOn = false,
  karaokeOn = false,
  voicePlaying = false,
  voiceBusy = false,
  karaokeWordsLength = 0,
} = {}) {
  if (!helpNudge || helpOpen || presentationActive) return false;
  if (isPrimeVoicePending(items, {
    voicePlaybackOn,
    karaokeOn,
    voicePlaying,
    voiceBusy,
    karaokeWordsLength,
  })) return false;
  return true;
}

/**
 * Merge local + server timelines when opening a conversation.
 * Server is authoritative except during in-flight presentation or clear.
 */
export function mergeTimelineOnLoad(local, server, {
  clearing = false,
  path = '',
  activePath = '',
} = {}) {
  const localItems = Array.isArray(local) ? local : [];
  const serverItems = Array.isArray(server) ? server : [];

  if (serverItems.length === 0) {
    const keepLocal = isPresentationRunning(localItems)
      || localItems.some((it) => it.type === 'voice_ack' && it.status === 'pending');
    return keepLocal ? normalizeTimelineItems(localItems) : [];
  }

  if (clearing && path === activePath && !localItems.length) {
    return [];
  }

  if (!localItems.length) {
    return normalizeTimelineItems(serverItems);
  }

  return normalizeTimelineItems(mergeTimelinesPreferVoiceAck(localItems, serverItems));
}

/**
 * @param {unknown[]} items
 */
export function shouldAutoPrimeSession(items) {
  return shouldPrimeSession(items);
}

/**
 * Apply orchestrated session API timeline payload to local state shape.
 * @param {TimelinePayload | null | undefined} payload
 */
export function timelineItemsFromSessionResponse(payload) {
  if (!payload) return [];
  const items = payload.items ?? payload;
  return Array.isArray(items) ? normalizeTimelineItems(items) : [];
}
