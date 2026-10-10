/**
 * @file evidence-runtime.js
 * @package @shaper/pkg-vault
 * @description The Vault's evidence relay: the debt its mutations and
 * issuances committed to the private outbox is delivered to Logger, retried
 * until Logger's receipt matches the claim, and never cleared on HTTP success
 * alone. No credential, key or secret value enters the outbox.
 *
 * Vault issues its own logger-audience credential in-process, under the
 * incarnation and grant the parent registered for unit `vault` — exactly the
 * renewal path every other unit uses, without a request to itself. Issuance
 * appends evidence to this same outbox, so the credential is obtained before
 * the relay opens its transaction.
 *
 * Adapted from the reference branch (14f2253) without its signed-receipt
 * transport: the receipt is verified as Logger answers it today (claim and
 * event digests, deliverLog).
 *
 * Intent: software/packages/pkg-vault/INTENT.md#evidence-relay
 */
import { createEvidenceRelay } from '../pkg-db/outbox.js';
import { deliverLog } from '../pkg-logger/ingest-client.js';
import { runtimeCredentialClient } from '../pkg-auth/runtime-identity.js';

const fail = (code, message) => { throw Object.assign(new Error(message || code), { code }); };

/**
 * Reads and checks the relay's declared inputs. Every one is required: a Vault
 * that commits evidence it can never deliver is refused at start.
 * @param {Record<string, string|undefined>} env
 */
export function evidenceRelaySettings(env) {
  if ((env.SHAPER_UNIT_SLUG ?? 'vault') !== 'vault') fail('VAULT_RELAY_IDENTITY_REQUIRED', 'the Vault relays under its own unit, vault');
  let url;
  try { url = new URL(env.LOGGER_URL); } catch { fail('VAULT_LOGGER_ENDPOINT_REQUIRED', 'LOGGER_URL is required with VAULT_STORE=mariadb: committed evidence is owed to Logger'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search
      || !['/', '/api/ingest'].includes(url.pathname)) {
    fail('VAULT_LOGGER_ENDPOINT_INVALID', 'LOGGER_URL must be a plain http(s) base or /api/ingest URL, without credentials, query or fragment');
  }
  return Object.freeze({
    loggerUrl: url.href,
    intervalMs: env.VAULT_RELAY_INTERVAL_MS,
    maxEvents: env.VAULT_RELAY_BATCH,
    timeoutMs: env.VAULT_RELAY_TIMEOUT_MS,
    shutdownMs: env.VAULT_SHUTDOWN_TIMEOUT_MS,
  });
}

/**
 * @param {object} options
 * @param {import('mysql2/promise').Pool} options.pool
 * @param {{ issue: Function, publicKey: import('node:crypto').KeyObject }} options.identityService
 * @param {Record<string, string|undefined>} [options.env]
 * @param {(event: object) => void} [options.report]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createVaultEvidenceRelay({ pool, identityService, env = process.env, report = () => {}, fetchImpl = fetch }) {
  const settings = evidenceRelaySettings(env);
  const identityEnv = { ...env, SHAPER_UNIT_SLUG: 'vault' };
  const client = runtimeCredentialClient(identityEnv, fetchImpl, {
    issuer: (ask) => identityService.issue(ask),
    publicKey: identityService.publicKey,
  });
  return createEvidenceRelay({
    pool,
    credentials: () => client.headers('logger'),
    deliver: (entry, signal, headers) => deliverLog({ loggerUrl: settings.loggerUrl, entry, signal, headers, fetchImpl }),
    report,
    intervalMs: settings.intervalMs,
    maxEvents: settings.maxEvents,
    timeoutMs: settings.timeoutMs,
    shutdownMs: settings.shutdownMs,
  });
}
