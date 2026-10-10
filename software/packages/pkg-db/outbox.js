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

/**
 * deliver must return a contract-validated durable recipient receipt,
 * and honor the supplied AbortSignal. Tokens belong to deliver, never the row.
 * A row lock excludes concurrent relays. A lost response/commit leaves the same
 * sourceEventId pending, so the recipient must deduplicate it on retry.
 */
export async function relayOutbox(pool, { deliver, maxEvents = 10, timeoutMs = 3000 } = {}) {
  if (typeof deliver !== 'function' || !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 100
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new OutboxError('OUTBOX_RELAY_INVALID');
  }
  let delivered = 0, deferred = 0;
  for (let i = 0; i < maxEvents; i++) {
    const outcome = await withTransaction(pool, async (conn) => {
      const [rows] = await conn.query(`SELECT event_id, body, body_digest, attempts FROM event_outbox
        WHERE delivered_at IS NULL AND receipt IS NULL AND next_attempt_at <= UTC_TIMESTAMP(3)
        ORDER BY created_at, event_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!rows.length) return 'empty';
      const row = rows[0];
      const body = Buffer.isBuffer(row.body) ? row.body.toString('utf8') : row.body;
      if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BYTES || digest(body) !== row.body_digest) {
        throw new OutboxError('OUTBOX_ROW_INVALID');
      }
      let event;
      try { event = JSON.parse(body); } catch { throw new OutboxError('OUTBOX_ROW_INVALID'); }
      if (event?.sourceEventId !== row.event_id) throw new OutboxError('OUTBOX_ROW_INVALID');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let receipt;
      try {
        receipt = await deliver(event, controller.signal);
        if (controller.signal.aborted || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)
            || Buffer.byteLength(JSON.stringify(receipt)) > MAX_BYTES) {
          throw new OutboxError('OUTBOX_RECEIPT_INVALID');
        }
      } catch {
        // A typed debt marker, never remote response text or credential content.
        const delay = Math.min(300, 2 ** Math.min(8, Number(row.attempts) || 0));
        await conn.execute(`UPDATE event_outbox SET attempts = attempts + 1,
          last_error = 'DELIVERY_UNCONFIRMED', next_attempt_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
          WHERE event_id = ? AND receipt IS NULL`, [delay, row.event_id]);
        return 'deferred';
      } finally { clearTimeout(timer); }
      await conn.execute(`UPDATE event_outbox SET receipt = ?, delivered_at = UTC_TIMESTAMP(3),
        attempts = attempts + 1, last_error = NULL WHERE event_id = ? AND receipt IS NULL`,
      [JSON.stringify(receipt), row.event_id]);
      return 'delivered';
    });
    if (outcome === 'empty') break;
    if (outcome === 'delivered') delivered++; else deferred++;
  }
  return { delivered, deferred };
}

/**
 * What a unit can say about its own evidence debt: how much is still owed and
 * since when. A down Logger is observable here, never silent.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<{ pending: number, oldestPendingAt: string|null, retrying: number, delivered: number }>}
 */
export async function outboxStatus(pool) {
  const [[row]] = await pool.query(`SELECT
      COALESCE(SUM(receipt IS NULL), 0) AS pending,
      COALESCE(SUM(receipt IS NULL AND attempts > 0), 0) AS retrying,
      COALESCE(SUM(receipt IS NOT NULL), 0) AS delivered,
      MIN(CASE WHEN receipt IS NULL THEN created_at END) AS oldest
    FROM event_outbox`);
  const oldest = row.oldest ? new Date(`${String(row.oldest).replace(' ', 'T')}Z`) : null;
  return {
    pending: Number(row.pending),
    retrying: Number(row.retrying),
    delivered: Number(row.delivered),
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
 * `credentials()` runs before the relay opens its transaction: obtaining a
 * credential may itself append evidence to this outbox (Vault issuing to
 * itself), and it must not do so while the relay holds a row lock.
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
  const last = { at: null, delivered: 0, deferred: 0, error: null };
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
    pending = (async () => {
      let headers;
      try {
        headers = await credentials();
      } catch (err) {
        last.error = err?.code || 'IDENTITY_UNAVAILABLE';
        say({ event: 'EVIDENCE_CREDENTIAL_UNAVAILABLE', code: last.error });
        return null;
      }
      try {
        const result = await relayOutbox(pool, {
          maxEvents: settings.maxEvents,
          timeoutMs: settings.timeoutMs,
          deliver: (entry, signal) => deliver(entry, signal, headers),
        });
        Object.assign(last, { at: new Date().toISOString(), ...result, error: null });
        if (result.deferred) say({ event: 'EVIDENCE_DELIVERY_DEFERRED', code: 'DELIVERY_UNCONFIRMED' });
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
