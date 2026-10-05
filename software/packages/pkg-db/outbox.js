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
