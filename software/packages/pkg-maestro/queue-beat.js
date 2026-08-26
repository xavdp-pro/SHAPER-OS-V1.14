/**
 * A beat handler that enqueues instead of dispatching.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The maestro's mandate is cadence: it decides **when** a pod should act. It
 * has no business deciding **how** the work runs, nor pronouncing on whether it
 * succeeded — it cannot observe that anyway, because the agent finishes long
 * after the beat returns.
 *
 * Calling a bridge directly forces the maestro to do all three, and it does the
 * third one badly: the bridge answers "accepted" and the beat records a success
 * that nobody verified. Worse, dispatch then happens in two places — the
 * maestro's beats and the queue's jobs — so there is no single ledger of what
 * ran, at what cost, with what outcome.
 *
 * Enqueueing restores one entry point. The maestro says "now"; the queue owns
 * dispatch, follows the run to its `done` event, records the verdict, and is
 * the only place that has to be right about it.
 *
 * ── The contract this handler honours ──────────────────────────────────────
 * A beat reports whether the **beat** happened, not whether the **work**
 * succeeded — that answer belongs to the job, and arrives later. So this
 * handler returns `ok: true` for "the job is queued", never for "the agent
 * finished well". Conflating the two is the very confusion it removes.
 */
import { ingestLog } from '../pkg-logger/ingest-client.js';

/**
 * The pod's still-open job, if it has one.
 *
 * PENDING and RUNNING both count as open. RUNNING is the obvious case; PENDING
 * matters just as much, because a job waiting its turn means the queue has not
 * even caught up with the previous beat.
 *
 * A queue we cannot question answers `null`: better to risk one duplicate beat
 * than to silence a pod because its bookkeeping was briefly unreachable.
 */
async function outstandingJob({ fetchImpl, target, headers, conversation }) {
  try {
    const res = await fetchImpl(`${target}/api/jobs`, { headers });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return (body.jobs || []).find((j) => j.payload?.conversation === conversation
      && (j.status === 'PENDING' || j.status === 'RUNNING')) || null;
  } catch {
    return null;
  }
}

export function createQueueBeatHandler({
  queueUrl,
  authToken = '',
  loggerUrl = null,
  fetchImpl = fetch,
} = {}) {
  if (!queueUrl) throw new Error('queueUrl is required');
  const target = queueUrl.replace(/\/$/, '');

  return async function queueBeatHandler(entry) {
    const slug = entry.slug;
    const message = entry.beatMessage
      || `Scheduled beat for ${slug}. Do the work this pod is registered for, then stop.`;

    await ingestLog({
      loggerUrl,
      pod: 'maestro',
      event: 'BEAT_ENQUEUED',
      correlationId: slug,
      data: { slug, kind: entry.kind || 'bridge', queue: target },
      fetchImpl,
    });

    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    // ── At most one outstanding job per pod ────────────────────────────────
    // A cadence says "act every N seconds", not "queue work every N seconds".
    // If the previous run is still going, enqueueing another does not make the
    // pod act on time — it builds a backlog that grows silently and drifts
    // further behind with every beat. Twelve stacked label reads are not
    // twelve times the freshness; they are one useful read and eleven wasted
    // agent calls.
    //
    // So a beat that finds its pod still busy is **skipped and recorded as
    // skipped**. The lateness becomes visible in the log instead of hiding in
    // a queue depth, which is exactly the information needed to decide whether
    // to shorten the work or lengthen the cadence.
    const open = await outstandingJob({ fetchImpl, target, headers, conversation: slug });
    if (open) {
      await ingestLog({
        loggerUrl,
        pod: slug,
        event: 'BEAT_SKIPPED',
        level: 'WARN',
        correlationId: open.id,
        data: { reason: 'previous_run_still_open', jobId: open.id, since: open.createdAt },
        fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'previous_run_still_open', jobId: open.id, processed: 0 };
    }

    let res;
    try {
      res = await fetchImpl(`${target}/api/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'agent.inject',
          totalSteps: 2,
          payload: {
            message,
            conversation: slug,
            // The pod names its own bridge and model; the queue only carries them.
            bridgeUrl: entry.bridgeUrl || undefined,
            model: entry.model || undefined,
            context: entry.contextPath || undefined,
          },
        }),
      });
    } catch (err) {
      // An unreachable queue is a missed beat, not a failed job. Say which.
      await ingestLog({
        loggerUrl,
        pod: slug,
        event: 'BEAT_SKIPPED',
        level: 'WARN',
        correlationId: slug,
        data: { reason: 'queue_unreachable', queue: target, error: err.message },
        fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'queue_unreachable', processed: 0 };
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.job?.id) {
      await ingestLog({
        loggerUrl,
        pod: slug,
        event: 'BEAT_SKIPPED',
        level: 'WARN',
        correlationId: slug,
        data: { reason: 'enqueue_rejected', status: res.status, queue: target },
        fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'enqueue_rejected', processed: 0 };
    }

    // Queued, and that is all this handler is entitled to claim.
    return { ok: true, enqueued: true, jobId: body.job.id, queue: target, processed: 0 };
  };
}
