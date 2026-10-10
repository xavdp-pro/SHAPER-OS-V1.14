/** Bounded rejection of secret-bearing event inputs; no payload in errors. */
const forbiddenFields = new Set([
  'password', 'passwd', 'secret', 'secretvalue', 'clientsecret', 'masterkey',
  'privatekey', 'apikey', 'authorization', 'credential', 'credentials',
  'cookie', 'setcookie', 'sessionid', 'connectionstring', 'dsn',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'sessiontoken',
  'base64', 'binary', 'rawbytes', 'buffer',
]);
const credential = /(?:-----BEGIN (?:[A-Z0-9 ]* )?PRIVATE KEY-----|\b(?:Bearer|Basic)\s+\S+|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{20,})?|\b(?:sk[-_]|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{16,}|[a-z][a-z0-9+.-]*:\/\/[^\s/?#]+:[^\s/?#]+@|\b(?:password|passwd|client_secret|api_key|access_token|refresh_token)\s*[=:]\s*\S+)/i;
const refuse = (code) => { const error = new Error(code); error.code = code; throw error; };
/** Recognizable secrets cannot enter even ignored metadata or nested arrays. */
export function assertPublicEvent(entry) {
  const pending = [{ value: entry, depth: 0 }]; const seen = new WeakSet();
  let nodes = 0, bytes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (++nodes > 10000 || depth > 32) refuse('EVENT_STRUCTURE_TOO_LARGE');
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value);
      if (bytes > 2097152) refuse('EVENT_STRUCTURE_TOO_LARGE');
      if (credential.test(value)) refuse('EVENT_SECRET_DENIED');
      continue;
    }
    if (value === null || value === undefined || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value))) continue;
    if (typeof value !== 'object') refuse('EVENT_NON_JSON_DENIED');
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) refuse('EVENT_BINARY_DENIED');
    if (seen.has(value)) refuse('EVENT_NON_JSON_DENIED'); seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) refuse('EVENT_NON_JSON_DENIED');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (descriptors.type?.value === 'Buffer' && descriptors.data) refuse('EVENT_BINARY_DENIED');
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, 'value')) refuse('EVENT_NON_JSON_DENIED');
      if (forbiddenFields.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) refuse('EVENT_SECRET_DENIED');
      bytes += Buffer.byteLength(key);
      if (bytes > 2097152) refuse('EVENT_STRUCTURE_TOO_LARGE');
      pending.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
}
