/** Durable delivery debt owned by one functional unit's private MariaDB. */
import { createHash, randomUUID } from 'node:crypto';
import { withTransaction } from './pool.js';

const MAX_BYTES = 65536;
const digest = (text) => createHash('sha256').update(text).digest('hex');

export class OutboxError extends Error {
  constructor(code) { super(code); this.name = 'OutboxError'; this.code = code; }
}

/** Call inside the transaction that writes the owning state. No network I/O. */
export async function appendOutbox(conn, event, { eventId = randomUUID() } = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
      || typeof eventId !== 'string' || !/^[A-Za-z0-9._:-]{1,190}$/.test(eventId)) {
    throw new OutboxError('OUTBOX_EVENT_INVALID');
  }
  const body = JSON.stringify({ ...event, sourceEventId: eventId });
  if (Buffer.byteLength(body) > MAX_BYTES) throw new OutboxError('OUTBOX_EVENT_TOO_LARGE');
  await conn.execute(`INSERT INTO event_outbox
    (event_id, body, body_digest) VALUES (?, ?, ?)`, [eventId, body, digest(body)]);
  return eventId;
}

/** How long a claimed row stays out of other relays' reach beyond its deadline. */
export const LEASE_MARGIN_SECONDS = 5;
/** How long a damaged row is set aside before it is looked at again. */
export const INVALID_ROW_RETRY_SECONDS = 300;

/**
 * Claims the oldest due row in a short transaction of its own: the row is read
 * under a READ COMMITTED locking read (no gap locks, so writers of the unit
 * never wait on the relay), its next attempt is pushed past the delivery
 * deadline — a lease — and the transaction commits before anything is sent.
 * A damaged row is marked OUTBOX_ROW_INVALID and set aside, never sent.
 * @returns {Promise<null | { invalid: true } | { row: object, event: object }>}
 */
async function claimNext(pool, leaseSeconds) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [rows] = await conn.query(`SELECT event_id, body, body_digest, attempts FROM event_outbox
      WHERE delivered_at IS NULL AND receipt IS NULL AND next_attempt_at <= UTC_TIMESTAMP(3)
      ORDER BY created_at, event_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!rows.length) {
      await conn.commit();
      return null;
    }
    const row = rows[0];
    const body = Buffer.isBuffer(row.body) ? row.body.toString('utf8') : row.body;
    let event = null;
    if (typeof body === 'string' && Buffer.byteLength(body) <= MAX_BYTES && digest(body) === row.body_digest) {
      try { event = JSON.parse(body); } catch { event = null; }
    }
    if (!event || event.sourceEventId !== row.event_id) {
      // Kept as it is for whoever repairs it; it stays owed and observable.
      await conn.execute(`UPDATE event_outbox SET last_error = 'OUTBOX_ROW_INVALID',
        next_attempt_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)) WHERE event_id = ? AND receipt IS NULL`,
      [INVALID_ROW_RETRY_SECONDS, row.event_id]);
      await conn.commit();
      return { invalid: true };
    }
    await conn.execute(`UPDATE event_outbox SET next_attempt_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
      WHERE event_id = ? AND receipt IS NULL`, [leaseSeconds, row.event_id]);
    await conn.commit();
    return { row, event };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Delivers due rows one by one. Each row is claimed in a short transaction
 * (claimNext), sent with no connection or lock held, then settled in another
 * short transaction: the receipt is stored, or the attempt is counted and the
 * row comes due again after a capped backoff (1 s doubling to 256 s).
 *
 * deliver must return a contract-validated durable recipient receipt and honor
 * the supplied AbortSignal. Tokens belong to deliver, never the row. A relay
 * that dies between claim and settlement leaves the row leased until its
 * deadline plus LEASE_MARGIN_SECONDS, then due again under the same
 * sourceEventId, so the recipient must deduplicate it on retry. A damaged row
 * is counted in `invalid` (present only when non-zero) and does not stop the
 * rows behind it. `shouldStop` is asked between rows, so a closing lane does
 * not start another send.
 */
export async function relayOutbox(pool, { deliver, maxEvents = 10, timeoutMs = 3000, shouldStop = () => false } = {}) {
  if (typeof deliver !== 'function' || typeof shouldStop !== 'function' || !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 100
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new OutboxError('OUTBOX_RELAY_INVALID');
  }
  const leaseSeconds = Math.ceil(timeoutMs / 1000) + LEASE_MARGIN_SECONDS;
  let delivered = 0, deferred = 0, invalid = 0;
  for (let i = 0; i < maxEvents && !shouldStop(); i++) {
    const claimed = await claimNext(pool, leaseSeconds);
    if (!claimed) break;
    if (claimed.invalid) { invalid++; continue; }
    const { row, event } = claimed;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let receipt = null;
    try {
      receipt = await deliver(event, controller.signal);
      if (controller.signal.aborted || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)
          || Buffer.byteLength(JSON.stringify(receipt)) > MAX_BYTES) {
        receipt = null;
      }
    } catch {
      // A typed debt marker, never remote response text or credential content.
      receipt = null;
    } finally {
      clearTimeout(timer);
    }
    if (receipt) {
      await withTransaction(pool, (conn) => conn.execute(`UPDATE event_outbox SET receipt = ?, delivered_at = UTC_TIMESTAMP(3),
        attempts = attempts + 1, last_error = NULL WHERE event_id = ? AND receipt IS NULL`,
      [JSON.stringify(receipt), row.event_id]));
      delivered++;
    } else {
      const delay = Math.min(300, 2 ** Math.min(8, Number(row.attempts) || 0));
      await withTransaction(pool, (conn) => conn.execute(`UPDATE event_outbox SET attempts = attempts + 1,
        last_error = 'DELIVERY_UNCONFIRMED', next_attempt_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
        WHERE event_id = ? AND receipt IS NULL`, [delay, row.event_id]));
      deferred++;
    }
  }
  return invalid ? { delivered, deferred, invalid } : { delivered, deferred };
}

/**
 * Whether a row is due for delivery now: one read of the ready index, no lock
 * and no transaction. The lane asks it before obtaining a credential, so an
 * idle unit asks Vault for nothing (DECISIONS-20261011 §C). A row set aside as
 * OUTBOX_ROW_INVALID is not deliverable work: it never draws a credential on
 * its own (it stays owed and counted in outboxStatus, and is looked at again
 * with the next deliverable row, or once repaired and its mark cleared).
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasDueEvidence(pool) {
  const [rows] = await pool.query(`SELECT 1 AS due FROM event_outbox
    WHERE delivered_at IS NULL AND receipt IS NULL AND next_attempt_at <= UTC_TIMESTAMP(3)
      AND (last_error IS NULL OR last_error <> 'OUTBOX_ROW_INVALID') LIMIT 1`);
  return rows.length > 0;
}

/** Days a delivered, receipted row is kept before it may be removed. */
export const DELIVERED_RETENTION_DAYS = 30;
/**
 * How far before a recovery point's snapshot a delivery must lie for that
 * point to hold it: the settling transaction commits after its timestamp.
 */
export const RECOVERY_POINT_MARGIN_MINUTES = 5;

/**
 * Removes delivered evidence a unit no longer needs to hold, and nothing else
 * (DECISIONS-20261011 §C, the unit's dataLifecycle): a row goes only when it
 * carries Logger's verified receipt (stored by the relay only after deliverLog
 * matched the claim), was delivered more than `retentionDays` ago, and a
 * recovery point recorded by the administrative path after a verified restore
 * was taken after that delivery — so the row survives in that dump. A row still
 * owed, set aside as invalid, or failed is never removed; without any recovery
 * point nothing is removed. Bounded per call.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ retentionDays?: number, limit?: number }} [options]
 * @returns {Promise<{ removed: number, coveredUntil: string|null }>}
 */
export async function pruneDeliveredOutbox(pool, { retentionDays = DELIVERED_RETENTION_DAYS, limit = 500 } = {}) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || !Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new OutboxError('OUTBOX_PRUNE_INVALID');
  }
  const [[point]] = await pool.query('SELECT MAX(snapshot_at) AS covered FROM recovery_points');
  if (!point || !point.covered) return { removed: 0, coveredUntil: null };
  const [result] = await pool.query(`DELETE FROM event_outbox
    WHERE receipt IS NOT NULL AND delivered_at IS NOT NULL AND last_error IS NULL
      AND JSON_VALUE(receipt, '$.id') IS NOT NULL
      AND delivered_at < TIMESTAMPADD(DAY, -?, UTC_TIMESTAMP(3))
      AND delivered_at < TIMESTAMPADD(MINUTE, -?, ?)
    ORDER BY delivered_at LIMIT ?`, [retentionDays, RECOVERY_POINT_MARGIN_MINUTES, point.covered, limit]);
  return { removed: Number(result.affectedRows) || 0, coveredUntil: String(point.covered) };
}

/**
 * A unit's periodic housekeeping, for a service lifecycle: each named job runs
 * once per interval, one round at a time, its outcome kept for vitals and
 * reported only when it removed something or failed. Started after listening,
 * closed before the database closes.
 *
 * @param {object} options
 * @param {Record<string, () => Promise<object>>} options.jobs
 * @param {(event: object) => void} [options.report]
 * @param {number} [options.intervalMs=3600000]
 * @param {number} [options.firstDelayMs=60000]
 */
export function createMaintenanceLane({ jobs, report = () => {}, intervalMs = 3600000, firstDelayMs = 60000 } = {}) {
  if (!jobs || typeof jobs !== 'object' || !Object.values(jobs).every((j) => typeof j === 'function')) {
    throw new OutboxError('MAINTENANCE_LANE_INVALID');
  }
  const every = bounded(intervalMs, 3600000, 1000, 86400000, 'MAINTENANCE_LANE_INVALID');
  const first = bounded(firstDelayMs, 60000, 0, 86400000, 'MAINTENANCE_LANE_INVALID');
  const last = {};
  let pending = null, timer = null, starter = null, stopping = false;
  const round = () => {
    if (stopping) return Promise.resolve(null);
    if (pending) return pending;
    pending = (async () => {
      for (const [name, job] of Object.entries(jobs)) {
        if (stopping) break;
        try {
          const result = await job();
          last[name] = { at: new Date().toISOString(), ...result };
          if (result && Number(result.removed) > 0) report({ event: 'MAINTENANCE_DONE', job: name, removed: Number(result.removed) });
        } catch (err) {
          last[name] = { at: new Date().toISOString(), error: err?.code || 'MAINTENANCE_FAILED' };
          report({ event: 'MAINTENANCE_FAILED', job: name, code: err?.code || 'MAINTENANCE_FAILED' });
        }
      }
      return { ...last };
    })().finally(() => { pending = null; });
    return pending;
  };
  return {
    last,
    round,
    start() {
      if (stopping || timer || starter) return;
      starter = setTimeout(() => { starter = null; if (stopping) return; timer = setInterval(round, every); timer.unref?.(); void round(); }, first);
      starter.unref?.();
    },
    async close() {
      stopping = true;
      if (starter) clearTimeout(starter);
      if (timer) clearInterval(timer);
      starter = null; timer = null;
      await (pending ?? Promise.resolve()).catch(() => {});
    },
  };
}

/**
 * What a unit can say about its own evidence debt: how much is still owed and
 * since when. A down Logger is observable here, never silent.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<{ pending: number, oldestPendingAt: string|null, retrying: number, delivered: number, invalid: number }>}
 */
export async function outboxStatus(pool) {
  const [[row]] = await pool.query(`SELECT
      COALESCE(SUM(receipt IS NULL), 0) AS pending,
      COALESCE(SUM(receipt IS NULL AND attempts > 0), 0) AS retrying,
      COALESCE(SUM(receipt IS NOT NULL), 0) AS delivered,
      COALESCE(SUM(receipt IS NULL AND last_error = 'OUTBOX_ROW_INVALID'), 0) AS invalid,
      MIN(CASE WHEN receipt IS NULL THEN created_at END) AS oldest
    FROM event_outbox`);
  const oldest = row.oldest ? new Date(`${String(row.oldest).replace(' ', 'T')}Z`) : null;
  return {
    pending: Number(row.pending),
    retrying: Number(row.retrying),
    delivered: Number(row.delivered),
    invalid: Number(row.invalid),
    oldestPendingAt: oldest && !Number.isNaN(oldest.getTime()) ? oldest.toISOString() : null,
  };
}

const bounded = (value, fallback, min, max, code) => {
  const n = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new OutboxError(code);
  return n;
};

/**
 * One non-overlapping delivery lane over a unit's outbox, for a service
 * lifecycle: start after listening, close before the database closes.
 *
 * A round first asks whether any row is due (hasDueEvidence); only then is
 * `credentials()` called, so a unit with nothing to deliver obtains no
 * credential (DECISIONS-20261011 §C). The credential client caches and renews
 * before expiry. `credentials()` runs before the relay opens its transaction:
 * obtaining a credential may itself append evidence to this outbox (Vault
 * issuing to itself), and it must not do so while the relay holds a row lock.
 * A refused or unavailable credential is retried after a backoff (two
 * intervals, doubling to one minute), never on every tick: a unit Vault
 * refuses does not hammer Vault, nor fill Vault's refusal evidence.
 * `deliver(entry, signal, headers)` returns a verified recipient receipt or
 * throws; anything else leaves the debt in place for a later attempt.
 *
 * @param {object} options
 * @param {import('mysql2/promise').Pool} options.pool
 * @param {(entry: object, signal: AbortSignal, headers: object) => Promise<object>} options.deliver
 * @param {() => Promise<object>} [options.credentials] - transport headers, never stored
 * @param {(event: object) => void} [options.report] - typed lane events, never response text
 * @param {number} [options.intervalMs=2000]
 * @param {number} [options.maxEvents=10]
 * @param {number} [options.timeoutMs=3000]
 * @param {number} [options.shutdownMs=15000]
 * @param {() => number} [options.now=Date.now]
 */
export function createEvidenceRelay({
  pool,
  deliver,
  credentials = async () => ({}),
  report = () => {},
  intervalMs = 2000,
  maxEvents = 10,
  timeoutMs = 3000,
  shutdownMs = 15000,
  now = Date.now,
} = {}) {
  if (!pool || typeof deliver !== 'function' || typeof credentials !== 'function') {
    throw new OutboxError('OUTBOX_RELAY_INVALID');
  }
  const settings = Object.freeze({
    intervalMs: bounded(intervalMs, 2000, 100, 60000, 'OUTBOX_RELAY_INVALID'),
    maxEvents: bounded(maxEvents, 10, 1, 100, 'OUTBOX_RELAY_INVALID'),
    timeoutMs: bounded(timeoutMs, 3000, 1, 30000, 'OUTBOX_RELAY_INVALID'),
    shutdownMs: bounded(shutdownMs, 15000, 100, 60000, 'OUTBOX_RELAY_INVALID'),
  });
  let pending = null;
  let timer = null;
  let stopping = false;
  let closed = null;
  let credentialFailures = 0;
  let credentialRetryAt = 0;
  const last = { at: null, delivered: 0, deferred: 0, error: null, idle: false };
  // A lane that keeps failing the same way says so once, then again when the
  // reason changes or after it has recovered: observable, not a flood.
  let lastReported = null;
  const say = (event) => {
    const key = `${event.event}:${event.code ?? ''}`;
    if (key === lastReported) return;
    lastReported = key;
    report(event);
  };

  const tick = () => {
    if (stopping) return Promise.resolve(null);
    if (pending) return pending;
    if (now() < credentialRetryAt) return Promise.resolve(null);
    pending = (async () => {
      try {
        if (!(await hasDueEvidence(pool))) {
          Object.assign(last, { at: new Date().toISOString(), delivered: 0, deferred: 0, invalid: 0, idle: true });
          return { delivered: 0, deferred: 0 };
        }
      } catch (err) {
        last.error = err?.code || 'DELIVERY_UNCONFIRMED';
        say({ event: 'EVIDENCE_RELAY_UNAVAILABLE', code: last.error });
        return null;
      }
      let headers;
      try {
        headers = await credentials();
        credentialFailures = 0;
        credentialRetryAt = 0;
      } catch (err) {
        last.error = err?.code || 'IDENTITY_UNAVAILABLE';
        credentialFailures += 1;
        credentialRetryAt = now() + Math.min(60000, settings.intervalMs * 2 ** Math.min(credentialFailures, 10));
        say({ event: 'EVIDENCE_CREDENTIAL_UNAVAILABLE', code: last.error });
        return null;
      }
      try {
        const result = await relayOutbox(pool, {
          maxEvents: settings.maxEvents,
          timeoutMs: settings.timeoutMs,
          shouldStop: () => stopping,
          deliver: (entry, signal) => deliver(entry, signal, headers),
        });
        Object.assign(last, { at: new Date().toISOString(), invalid: 0, ...result, error: null, idle: false });
        if (result.invalid) say({ event: 'EVIDENCE_ROW_INVALID', code: 'OUTBOX_ROW_INVALID' });
        else if (result.deferred) say({ event: 'EVIDENCE_DELIVERY_DEFERRED', code: 'DELIVERY_UNCONFIRMED' });
        else if (lastReported !== null) {
          lastReported = null;
          report({ event: 'EVIDENCE_DELIVERY_RESUMED', delivered: result.delivered });
        }
        return result;
      } catch (err) {
        last.error = err?.code || 'DELIVERY_UNCONFIRMED';
        say({ event: 'EVIDENCE_RELAY_UNAVAILABLE', code: last.error });
        return null;
      }
    })().finally(() => { pending = null; });
    return pending;
  };

  return {
    settings,
    last,
    tick,
    start() {
      if (stopping || timer) return;
      timer = setInterval(tick, settings.intervalMs);
      timer.unref?.();
      void tick();
    },
    /** Stops the lane and waits for the batch in flight, bounded. */
    close() {
      if (closed) return closed;
      stopping = true;
      if (timer) clearInterval(timer);
      timer = null;
      closed = (async () => {
        let deadline;
        try {
          await Promise.race([
            pending ?? Promise.resolve(),
            new Promise((_, reject) => {
              deadline = setTimeout(() => reject(new OutboxError('OUTBOX_RELAY_SHUTDOWN_UNCONFIRMED')), settings.shutdownMs);
            }),
          ]);
        } finally {
          clearTimeout(deadline);
        }
      })();
      return closed;
    },
  };
}
