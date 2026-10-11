/**
 * The receiving side of evidence, real end to end, for live tests: Vault on
 * its private database issuing unit credentials over HTTP, and Logger on its
 * private database authorizing every ingest against Vault — the same code the
 * entrypoints run (VaultUnitIdentity, runtimeAuthorizer, runtimeCredentialClient,
 * MariaDbLoggerStore, createLoggerServer). Nothing here is a stand-in: a test
 * that passes has had its evidence accepted by the real Logger.
 *
 * The parent's part — registering each unit's incarnation, grants and
 * bootstrap digest in Vault's database, and pinning Vault's public key — is
 * done through the administrative (root) path, as a universe birth would.
 *
 * Intent: software/packages/pkg-logger/INTENT.md#authenticated-http-boundary
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { adminQuery, liveEnv, resetUnit, unitDb } from '../../../pkg-db/test/live/live-env.mjs';
import { MariaDbVaultStore } from '../../../pkg-vault/mariadb-store.js';
import { VaultUnitIdentity } from '../../../pkg-vault/unit-identity.js';
import { createVaultServer } from '../../../pkg-vault/index.js';
import { registrationStatement, signingPublicKeyPem } from '../../../pkg-vault/unit-registration.js';
import { MariaDbLoggerStore } from '../../mariadb-store.js';
import { createLoggerServer } from '../../index.js';
import { runtimeAuthorizer, runtimeCredentialClient } from '../../../pkg-auth/runtime-identity.js';

export const UNIVERSE = '550e8400-e29b-41d4-a716-446655440000';

const listen = (server) => new Promise((resolve) => server.once('listening', resolve));
const close = (server) => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });

/**
 * @param {object} [options]
 * @param {string[]} [options.units] - units registered, each with a logger:ingest grant
 * @param {Record<string, Record<string, string[]>>} [options.grants] - a unit's
 *   audience → scopes, instead of the default { logger: ['logger:ingest'] }
 */
export async function startEvidenceStack({ units = ['vault', 'queue', 'maestro'], grants = {} } = {}) {
  const { workDir } = liveEnv();
  await resetUnit('vault');
  await resetUnit('logger');
  const dir = fs.mkdtempSync(path.join(workDir, 'stack-'));

  const masterKey = crypto.randomBytes(32).toString('hex');
  const vaultStore = await MariaDbVaultStore.open({ masterKey, slug: 'vault', db: unitDb() });
  const identityService = new VaultUnitIdentity({ pool: vaultStore.pool, masterKey: vaultStore.masterKey, universe: UNIVERSE });
  const vaultServer = createVaultServer({
    port: 0, host: '127.0.0.1', vaultStore, identityService, vaultToken: crypto.randomBytes(16).toString('hex'),
  });
  await listen(vaultServer);
  const vaultUrl = `http://127.0.0.1:${vaultServer.address().port}`;

  // The parent pins the key it derives from the master key — not one the
  // running Vault hands out — and registers each incarnation after Vault's
  // identity is born, through the administrative path.
  const publicKeyFile = path.join(dir, 'vault-public.pem');
  fs.writeFileSync(publicKeyFile, signingPublicKeyPem({ masterKey, universe: UNIVERSE }), { mode: 0o444 });

  const envs = {};
  for (const unit of units) {
    const bootstrap = crypto.randomBytes(32).toString('hex');
    const bootstrapFile = path.join(dir, `${unit}-bootstrap`);
    fs.writeFileSync(bootstrapFile, bootstrap, { mode: 0o600 });
    const incarnation = `${unit}-live-1`;
    const { sql, params } = registrationStatement({
      universe: UNIVERSE, unit, incarnation, grants: grants[unit] || { logger: ['logger:ingest'] }, bootstrapToken: bootstrap, ttlSeconds: 3600,
    });
    await adminQuery(`USE vault; ${sql}`, params);
    envs[unit] = {
      VAULT_URL: vaultUrl,
      UNIT_AUTH_PUBLIC_KEY_FILE: publicKeyFile,
      UNIT_BOOTSTRAP_TOKEN_FILE: bootstrapFile,
      SHAPER_UNIT_INCARNATION: incarnation,
      SHAPER_UNIVERSE_ID: UNIVERSE,
      SHAPER_UNIT_SLUG: unit,
    };
  }

  const loggerStore = await MariaDbLoggerStore.open({ slug: 'logger', db: unitDb() });
  const authorizeRequest = runtimeAuthorizer({
    VAULT_URL: vaultUrl, UNIT_AUTH_PUBLIC_KEY_FILE: publicKeyFile, SHAPER_UNIVERSE_ID: UNIVERSE, SHAPER_UNIT_SLUG: 'logger',
  });
  let loggerServer = null;
  let loggerPort = 0;
  const startLogger = async () => {
    loggerServer = createLoggerServer({ port: loggerPort, host: '127.0.0.1', store: loggerStore, authorizeRequest });
    await listen(loggerServer);
    loggerPort = loggerServer.address().port;
  };
  await startLogger();

  return {
    vaultStore,
    identityService,
    vaultUrl,
    loggerUrl: `http://127.0.0.1:${loggerPort}`,
    env: (unit) => ({ ...envs[unit] }),
    credentials: (unit, audience = 'logger') => {
      const client = runtimeCredentialClient(envs[unit]);
      return () => client.headers(audience);
    },
    /** The real runtimeAuthorizer a unit serving `audience` runs, checking at this Vault. */
    authorizer: (audience) => runtimeAuthorizer({
      VAULT_URL: vaultUrl, UNIT_AUTH_PUBLIC_KEY_FILE: publicKeyFile, SHAPER_UNIVERSE_ID: UNIVERSE, SHAPER_UNIT_SLUG: audience,
    }),
    /** A Logger outage: the HTTP service stops; its database stays. */
    async stopLogger() { await close(loggerServer); loggerServer = null; },
    async startLogger() { await startLogger(); },
    /** Logger's own record, read through the administrative path. */
    async loggerEvents(where = '1=1', params = []) {
      return adminQuery(`SELECT id, pod, event, level, correlation_id, execution_id, source_event_id, data
        FROM logger.events WHERE ${where} ORDER BY received_at, id`, params);
    },
    async close() {
      if (loggerServer) await close(loggerServer);
      await close(vaultServer);
      await loggerStore.close();
      await vaultStore.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
