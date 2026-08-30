/**
 * Optional queue consumer: dispatches PENDING jobs of type `agent.inject` to a bridge.
 * Enabled with QUEUE_AUTO_DISPATCH=1.
 *
 * Job params (POST /api/jobs):
 * {
 *   "type": "agent.inject",
 *   "payload": {
 *     "message": "What to do (required)",
 *     "conversation": "optional-slug",
 *     "bridgeUrl": "http://127.0.0.1:4340",
 *     "model": "opencode/nemotron-3.5-lightning-free",
 *     "context": "optional instructions"
 *   },
 *   "totalSteps": 2
 * }
 *
 * ── What "done" means here ─────────────────────────────────────────────────
 * An acknowledgement is not a result. The bridge answers `ok` as soon as it has
 * started the agent; the real outcome only arrives later, in a `done` event
 * carrying an exit code. This consumer therefore follows the run to its end
 * before concluding.
 *
 * Deliberate corollary: work whose end cannot be observed stays `RUNNING`. A
 * pending job beats an invented success — the latter is what poisons a control
 * chain, because it propagates.
 */

import { taskFromPayload } from './task-frame.js';

/**
 * Effective priority of a waiting job.
 *
 * A pure priority order starves: a low-priority job can be overtaken forever.
 * A pure arrival order (FIFO) ignores urgency. Aging reconciles the two —
 *
 *     effective = declared priority + ⌊ waited / agingSeconds ⌋
 *
 * The second term grows without bound, so **every waiting job eventually
 * outranks every newcomer**. Starvation is not made unlikely, it is made
 * impossible, and the proof is one line. `agingSeconds` sets how fast patience
 * converts into rank: small means "fair queue", large means "obey priority".
 */
export function effectivePriority(job, now = Date.now(), agingSeconds = 60) {
  const declared = Number(job.payload?.priority ?? 5);
  const waitedMs = now - new Date(job.createdAt).getTime();
  return declared + Math.floor(waitedMs / 1000 / Math.max(1, agingSeconds));
}

/**
 * Picks the next job to start, or `null` when no lane should be filled.
 *
 * Two rules, in order:
 *
 * 1. **One running job per conversation.** A pod never occupies two lanes.
 *    This is the same invariant the maestro applies when it beats, enforced
 *    again here because the queue is the one that must be right about it — and
 *    it buys fairness for free: no pod can crowd the others out.
 * 2. **Highest effective priority wins**, arrival order breaking ties so the
 *    choice stays deterministic and replayable from the log.
 */
export function selectNext(pending, runningConversations, now = Date.now(), agingSeconds = 60) {
  const eligible = pending.filter((j) => !runningConversations.has(j.payload?.conversation ?? j.id));
  if (!eligible.length) return null;
  return eligible.reduce((best, j) => {
    const a = effectivePriority(j, now, agingSeconds);
    const b = effectivePriority(best, now, agingSeconds);
    if (a !== b) return a > b ? j : best;
    return String(j.createdAt) < String(best.createdAt) ? j : best;
  });
}

/**
 * The events that end a run, and what each one tells us.
 *
 * Bridges do not share a vocabulary: `bridge-agy` says `done` with an
 * `exit_code`, `bridge-opencode` says `response_complete` with an `exit`, and
 * cursor-agent says `result` with an `is_error` boolean. Three CLIs, three
 * dialects, and there will be a fourth. The
 * queue must not learn either dialect in its logic — it reads this table, and a
 * new bridge is one line here rather than a branch somewhere in the flow.
 *
 * An entry returning `exitCode: undefined` means "ended, outcome unknown", and
 * the job stays RUNNING rather than being declared either way.
 *
 * `run_complete` is deliberately absent. It follows `response_complete` and
 * carries no outcome of its own; treating it as terminal would mean inventing a
 * success for any run that emitted nothing else.
 */
const TERMINAL_EVENTS = {
  done: (e) => ({ exitCode: e.exit_code }),
  response_complete: (e) => ({
    exitCode: e.exit ?? 0,
    answer: typeof e.text === 'string' ? e.text : null,
  }),
  run_aborted: (e) => ({ exitCode: 1, reason: e.reason || 'aborted' }),
  // cursor-agent's own dialect, should a bridge forward it verbatim:
  // `{ type: 'result', subtype: 'success', is_error: false }`.
  result: (e) => ({ exitCode: e.is_error ? 1 : 0, reason: e.is_error ? (e.result || 'error') : undefined }),
};

/** Follows the bridge event stream and resolves on the run's terminal event. */
function followViaSse({ fetchImpl, target, conversation, headers }) {
  const url = `${target}/api/events?conversation=${encodeURIComponent(conversation)}`;
  let cancel = () => {};

  // This promise must never reject.
  //
  // Subscribing happens *before* injecting, so a short run cannot finish before
  // anyone listens. The cost of that ordering: if the subscription itself fails,
  // the rejection exists before anything awaits it — and an unhandled rejection
  // kills the process. Observed on gbs-test, where one unreachable bridge took
  // down the whole queue: ECONNREFUSED, and the most critical brick in the
  // control plane was gone.
  //
  // A bridge we cannot reach is exactly the case the design already has a word
  // for: unobservable. So it returns that, and the job stays RUNNING with the
  // reason recorded, instead of the queue dying and taking every other job's
  // supervision with it.
  const done = (async () => {
   try {
    const res = await fetchImpl(url, { headers });
    const reader = res.body?.getReader?.();
    // A bridge without an event stream is not observable: say so, rather than
    // assume everything went well.
    if (!reader) return { observable: false };

    cancel = () => reader.cancel().catch(() => {});
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) return { observable: true, ended: true };
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
        const terminal = TERMINAL_EVENTS[evt.type];
        if (terminal) {
          cancel();
          return { observable: true, event: evt.type, runId: evt.run_id || null, ...terminal(evt) };
        }
      }
    }
   } catch (err) {
     return { observable: false, reason: err.cause?.code || err.message };
   }
  })();

  return { done, cancel: () => cancel() };
}

export function startQueueAgentWorker({
  queue,
  bridgeUrl = process.env.QUEUE_BRIDGE_URL || 'http://127.0.0.1:4340',
  bridgeToken = process.env.QUEUE_BRIDGE_TOKEN || process.env.BRIDGE_AUTH_TOKEN || '',
  pollMs = Number(process.env.QUEUE_POLL_MS || 2000),
  // How many jobs may run at once. One by default: a queue that quietly
  // parallelises on a machine that cannot take it is worse than a slow one.
  concurrency: initialConcurrency = Math.max(1, Number(process.env.QUEUE_CONCURRENCY || 1)),
  // How fast waiting converts into rank. See `effectivePriority`.
  agingSeconds = Math.max(1, Number(process.env.QUEUE_AGING_SECONDS || 60)),
  // How long a lane will wait for a run's terminal event before giving up.
  // A hung event stream once held the only lane forever: the job sat RUNNING,
  // every later job sat PENDING, and only a container restart freed the queue
  // (v1.13.11 sealing run, incident 2). Same epistemology as adoptOrphans:
  // giving up is not inventing an outcome — it is saying nobody watches anymore.
  runMaxSeconds = Math.max(0.05, Number(process.env.QUEUE_RUN_MAX_SECONDS || 900)),
  fetchImpl = fetch,
  followImpl = followViaSse,
} = {}) {
  if (!queue) throw new Error('queue is required');
  let stopped = false;
  // Width is set from outside — see lanes.js. The child holds the value and
  // publishes it; it never chooses it.
  let concurrency = initialConcurrency;

  // Lanes, not a single slot. How many is a deployment parameter: a modest VPS
  // runs one, a well-sized server runs four. Same image, same code — Rule 32
  // says a brick that only works at one scale is not a base.
  const running = new Map(); // job id → conversation

  /**
   * Jobs left RUNNING by a worker that no longer exists.
   *
   * This does not contradict "work whose end cannot be observed stays RUNNING".
   * That invariant forbids **inventing a success**; it does not require pretending
   * a run is still watched when the process watching it is gone. An orphan's end
   * will never be observed by anyone, and saying so is a fact, not a guess.
   *
   * Leaving them is worse than it looks: each one occupies its pod's exclusivity
   * for ever, so that pod never beats again, and each one inflates `inFlight`,
   * so every capacity reading built on it is wrong. A stale RUNNING job is a
   * measurement poisoning itself.
   */
  function adoptOrphans() {
    const orphans = queue.listJobs({ status: 'RUNNING' })
      .filter((j) => j.type === 'agent.inject' && !running.has(j.id));
    for (const job of orphans) {
      queue.updateJobProgress(job.id, {
        status: 'FAILED',
        error: 'orphaned by restart — the worker watching this run is gone, its outcome is unknowable',
        progress: 100,
        step: 2,
        result: { ...(job.result || {}), orphaned: true },
      });
    }
    if (orphans.length) console.log(`[queue-worker] ${orphans.length} orphan(s) from a previous worker, marked failed`);
    return orphans.length;
  }

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (bridgeToken) h.Authorization = `Bearer ${bridgeToken}`;
    return h;
  }

  async function processOne(job) {
    const payload = job.payload || {};

    // A job may be a bare injection, or a framed task carrying its perimeter,
    // its finish line and the standing rules. The frame is built in one place
    // (task-frame.js) so a task arrives under the same contract whether it came
    // through the queue or through the CLI router.
    let message;
    try {
      message = taskFromPayload(payload) || String(payload.message || '').trim();
    } catch (err) {
      queue.updateJobProgress(job.id, {
        status: 'FAILED', progress: 100,
        error: `malformed task: ${err.message}`,
      });
      return;
    }
    if (!message) {
      queue.updateJobProgress(job.id, { status: 'FAILED', error: 'payload.message required', progress: 100 });
      return;
    }
    const target = (payload.bridgeUrl || bridgeUrl).replace(/\/$/, '');
    const conversation = payload.conversation || `queue-${job.id}`;
    // Stamp when work actually began. Without it, "service time" would be
    // measured from creation and would silently include queue wait — inflating
    // under load, which is precisely when the measure matters most.
    const startedAt = new Date().toISOString();
    queue.updateJobProgress(job.id, { status: 'RUNNING', progress: 10, step: 1, result: { startedAt } });

    // Subscribe before injecting: a short run could otherwise finish before we
    // are listening, leaving us waiting on an event that already went by.
    const follower = followImpl({ fetchImpl, target, conversation, headers: authHeaders() });

    const res = await fetchImpl(`${target}/api/inject`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        conversation,
        message,
        context: payload.context || null,
        model: payload.model || undefined,
        // Stated in the frame, and handed to the bridge so it can bound the CLI
        // for real (`--add-dir`). Instruction alone is not containment.
        perimeter: payload.perimeter || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok !== true) {
      follower.cancel();
      queue.updateJobProgress(job.id, {
        status: 'FAILED',
        error: data.error || `inject HTTP ${res.status}`,
        progress: 100,
        step: 2,
      });
      return;
    }

    const result = {
      startedAt,
      run_id: data.runId || data.run_id || data.id || null,
      conversation: data.conversation || conversation,
      model: data.model || null,
      bridge: target,
    };
    // Accepted, so started — but not finished. Progress says where we stand.
    queue.updateJobProgress(job.id, { status: 'RUNNING', progress: 50, step: 1, result });

    let outcome;
    const GAVE_UP = Symbol('gave-up');
    let watchTimer;
    try {
      outcome = await Promise.race([
        follower.done,
        new Promise((resolve) => {
          watchTimer = setTimeout(() => resolve(GAVE_UP), runMaxSeconds * 1000);
          watchTimer.unref?.();
        }),
      ]);
    } catch (err) {
      queue.updateJobProgress(job.id, {
        status: 'RUNNING', progress: 50, step: 1,
        result: { ...result, unobserved: `event stream interrupted: ${err.message}` },
      });
      return;
    } finally {
      clearTimeout(watchTimer);
    }

    if (outcome === GAVE_UP) {
      follower.cancel();
      queue.updateJobProgress(job.id, {
        status: 'FAILED',
        progress: 100,
        step: 2,
        error: `no terminal event after ${runMaxSeconds}s — the watcher gave up; the outcome is unknowable`,
        result: { ...result, unobserved: `gave up after ${runMaxSeconds}s without a terminal event` },
      });
      return;
    }

    if (!outcome || outcome.observable === false || outcome.exitCode === undefined) {
      queue.updateJobProgress(job.id, {
        status: 'RUNNING', progress: 50, step: 1,
        // Say which kind of blindness this is. "No event stream" and "the bridge
        // refused the connection" call for different actions, and a generic
        // reason sends the reader to the wrong place.
        result: {
          ...result,
          unobserved: outcome?.reason
            ? `could not observe the run: ${outcome.reason}`
            : 'the bridge exposes no event stream',
        },
      });
      return;
    }

    const ok = outcome.exitCode === 0;
    queue.updateJobProgress(job.id, {
      status: ok ? 'COMPLETED' : 'FAILED',
      progress: 100,
      step: 2,
      ...(ok ? {} : { error: `agent exit ${outcome.exitCode}` }),
      result: {
        ...result,
        exit_code: outcome.exitCode,
        ...(outcome.answer ? { answer: outcome.answer } : {}),
      },
    });
  }


  function tick() {
    if (stopped) return;
    try {
      while (running.size < concurrency) {
        const pending = queue.listJobs({ status: 'PENDING' }).filter((j) => j.type === 'agent.inject');
        const next = selectNext(pending, new Set(running.values()), Date.now(), agingSeconds);
        if (!next) return;

        running.set(next.id, next.payload?.conversation ?? next.id);
        // Deliberately not awaited: filling a lane must not block the others.
        processOne(next)
          .catch((err) => console.error('[queue-worker]', err.message))
          .finally(() => running.delete(next.id));
      }
    } catch (err) {
      console.error('[queue-worker]', err.message);
    }
  }

  // Before filling any lane, settle what a previous worker left behind.
  adoptOrphans();

  const timer = setInterval(tick, pollMs);
  tick();
  console.log(`[queue-worker] auto-dispatch ON → ${bridgeUrl} (${concurrency} lane${concurrency > 1 ? 's' : ''}, poll ${pollMs}ms, aging ${agingSeconds}s)`);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    lanes: () => concurrency,
    /**
     * Applies a width decided above. Bounded here as a last line of defence:
     * a parent is trusted to decide, not to be free of bugs.
     */
     setLanes(n) {
      const next = Math.max(1, Math.min(64, Math.floor(Number(n))));
      if (!Number.isFinite(next)) throw new Error('lanes must be a number');
      const before = concurrency;
      concurrency = next;
      if (next !== before) console.log(`[queue-worker] lanes ${before} → ${next} (set from above)`);
      // Widening takes effect at once; narrowing lets running jobs finish, since
      // a lane is only released when its job ends.
      tick();
      return { before, lanes: next };
    },
  };
}
