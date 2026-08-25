/**
 * @package @shaper/auth
 * Bearer token verification for SHAPER OS HTTP services (Rule 8).
 */

/**
 * Extract Bearer token from an HTTP request or headers object.
 * @param {import('node:http').IncomingMessage|{ headers?: Record<string, string|undefined> }} req
 * @returns {string|null}
 */
export function extractBearerToken(req) {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = String(raw).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Verify Bearer token against expected value. Empty expected = auth disabled.
 * @param {import('node:http').IncomingMessage|{ headers?: Record<string, string|undefined> }} req
 * @param {string} expectedToken
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function verifyBearerToken(req, expectedToken) {
  if (!expectedToken) return { ok: true };
  const token = extractBearerToken(req);
  if (!token) return { ok: false, status: 401, error: 'Missing Bearer token' };
  if (token !== expectedToken) return { ok: false, status: 403, error: 'Invalid Bearer token' };
  return { ok: true };
}

/**
 * Build auth headers for outbound fetch calls.
 * @param {string} [token]
 * @returns {Record<string, string>}
 */
export function bearerAuthHeaders(token) {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
