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
import { readTaskContext } from '../pkg-agent-runtime/context.js';
import { DEFAULT_JOB_TYPE } from './occurrence.js';

/**
 * The job a beat asks Queue to hold — one shape for both stores.
 *
 * `context` is the snapshot read when the beat became due; the job carries the
 * text itself, never a path that only exists inside this container.
 *
 * @param {object} entry - a registered task
 * @param {string|null} context
 * @returns {{ type: string, totalSteps: number, payload: object }}
 */
export function beatJobBody(entry, context) {
  const slug = entry.slug;
  const message = entry.instruction || entry.beatMessage
    || `Scheduled beat for ${slug}. Do the work this pod is registered for, then stop.`;
  return {
    type: entry.jobType || DEFAULT_JOB_TYPE,
    totalSteps: 2,
    payload: {
      message,
      conversation: slug,
      // The pod names its own bridge and model; the queue only carries them.
      bridgeUrl: entry.bridgeUrl || undefined,
      model: entry.model || undefined,
      // Carry an immutable snapshot in the job, never a path that only
      // exists inside this container. The queue already persists payloads.
      context: context || undefined,
    },
  };
}

/**
 * The exact request one occurrence sends to Queue, on every attempt.
 *
 * It is serialised once, when the occurrence becomes due, and stored with it:
 * a retry sends the same bytes under the same key, so Queue can recognise it
 * and answer with the job it already holds instead of a conflict.
 *
 * @param {object} entry - the schedule's normalized declaration
 * @param {string|null} context
 * @param {{ occurrenceId: string, scheduleId: string, revision: string, plannedAt: string }} occurrence
 * @returns {string} JSON text
 */
export function occurrenceRequestText(entry, context, { occurrenceId, scheduleId, revision, plannedAt }) {
  const body = beatJobBody(entry, context);
  body.payload.occurrenceId = occurrenceId;
  body.payload.scheduleId = scheduleId;
  body.payload.scheduleRevision = revision;
  body.payload.plannedAt = plannedAt;
  body.idempotencyKey = occurrenceId;
  return JSON.stringify(body);
}

/**
 * The pod's still-open job, if it has one.
 *
 * PENDING and RUNNING both count as open. RUNNING is the obvious case; PENDING
 * matters just as much, because a job waiting its turn means the queue has not
 * even caught up with the previous beat.
 *
 * A queue we cannot question answers `null`: better to risk one duplicate beat
 * than to silence a pod because its bookkeeping was briefly unreachable.
 *
 * Memory mode only (`MAESTRO_STORE=memory`, DEV scaffolding). Listing every job
 * to guess whether an earlier beat is still open is exactly what the durable
 * path no longer does: there, the previous occurrence's own Queue job is looked
 * up by its idempotency key (durable-scheduler.js).
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

    let context;
    try {
      context = readTaskContext(entry);
    } catch (err) {
      await ingestLog({
        loggerUrl, pod: slug, event: 'BEAT_SKIPPED', level: 'WARN', correlationId: slug,
        data: { reason: 'context_unreadable', path: entry.contextPath, error: err.message }, fetchImpl,
      });
      return { ok: false, skipped: true, reason: 'context_unreadable', processed: 0 };
    }

    let res;
    try {
      res = await fetchImpl(`${target}/api/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(beatJobBody(entry, context)),
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

    // The audit event is written AFTER the job exists, correlated to the job
    // id — not before, correlated to the slug. Until V1.13.1 this event fired
    // before createJob, so no audit line could ever join a queue job id and
    // the runbook's proof #4 was unsatisfiable by construction (found by all
    // five beta testers).
    await ingestLog({
      loggerUrl,
      pod: 'maestro',
      event: 'BEAT_ENQUEUED',
      correlationId: body.job.id,
      data: { slug, jobId: body.job.id, kind: entry.kind || 'bridge', queue: target },
      fetchImpl,
    });

    // Queued, and that is all this handler is entitled to claim.
    return { ok: true, enqueued: true, jobId: body.job.id, queue: target, processed: 0 };
  };
}
