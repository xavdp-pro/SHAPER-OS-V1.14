/**
 * Ships client breadcrumbs to the server log — a phone has no devtools, so
 * audio/voice issues are otherwise invisible. Batched: audio paths fire bursts.
 */
const FLUSH_MS = 1200;
const MAX_BATCH = 40;

let queue = [];
let timer = 0;

async function flush() {
  timer = 0;
  if (!queue.length) return;
  const entries = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  try {
    await fetch('/api/dev/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ entries }),
    });
  } catch {
    /* logging must never break the feature it observes */
  }
  if (queue.length && !timer) timer = window.setTimeout(flush, FLUSH_MS);
}

/**
 * @param {string} tag short channel, e.g. 'audio' or 'voice'
 * @param {string} msg what happened
 * @param {unknown} [data] small JSON-serialisable payload
 */
export function debugLog(tag, msg, data = null) {
  try {
    queue.push({ tag, msg, data });
    if (queue.length > 200) queue = queue.slice(-200);
    console.log(`[${tag}] ${msg}`, data ?? '');
    if (!timer) timer = window.setTimeout(flush, FLUSH_MS);
  } catch {
    /* ignore */
  }
}

/** Send immediately — use before an action that may suspend the page. */
export function debugLogFlush() {
  if (timer) {
    window.clearTimeout(timer);
    timer = 0;
  }
  return flush();
}
