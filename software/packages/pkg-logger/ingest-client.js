/**
 * HTTP ingest client — all bricks log through @shaper/pkg-logger.
 */

/**
 * @param {object} options
 * @param {string} options.loggerUrl - Base URL e.g. http://127.0.0.1:8520
 * @param {string} options.pod
 * @param {string} options.event
 * @param {object} [options.data]
 * @param {string} [options.level]
 * @param {string} [options.correlationId]
 * @param {string} [options.executionId]
 * @param {number} [options.durationMs]
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function ingestLog({
  loggerUrl,
  pod,
  event,
  data = {},
  level = 'INFO',
  correlationId = null,
  correlation_id = null,
  executionId = null,
  execution_id = null,
  durationMs = 0,
  duration_ms = null,
  fetchImpl = fetch,
} = {}) {
  if (!loggerUrl || !pod || !event) return null;
  const base = loggerUrl.replace(/\/$/, '');
  const url = base.endsWith('/api/ingest') ? base : `${base}/api/ingest`;
  const corrId = correlationId || correlation_id || data?.jobId || data?.correlationId || null;
  const execId = executionId || execution_id || null;
  const elapsed = duration_ms ?? durationMs ?? 0;

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pod,
        event,
        level,
        data,
        correlationId: corrId,
        correlation_id: corrId,
        executionId: execId,
        execution_id: execId,
        durationMs: elapsed,
        duration_ms: elapsed,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return json.record || null;
  } catch {
    return null;
  }
}
