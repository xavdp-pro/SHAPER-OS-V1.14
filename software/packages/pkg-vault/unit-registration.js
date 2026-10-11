#!/usr/bin/env node
/**
 * @file unit-registration.js
 * @package @shaper/pkg-vault
 * @description The parent's two steps that let units hold Vault-signed
 * credentials, as a library and a command. The parent — the universe's
 * construction path, holding the master key and administering Vault's MariaDB
 * through root — runs them; no unit runs them.
 *
 *   public-key   prints Vault's Ed25519 signing public key (PEM, not a secret),
 *                derived from the master key and the universe, for the parent
 *                to pin as each consumer's UNIT_AUTH_PUBLIC_KEY_FILE.
 *   register     writes a fresh bootstrap token to a 0600 file for the unit and
 *                prints the one SQL statement root applies to Vault's database
 *                (`mariadb vault < statement`): the incarnation, its exact
 *                audience → scope grants, the token's SHA-256 and its expiry.
 *                The token itself never reaches SQL, the terminal or a log.
 *
 *   VAULT_MASTER_KEY_FILE=… SHAPER_UNIVERSE_ID=<uuid> node unit-registration.js public-key
 *   SHAPER_UNIVERSE_ID=<uuid> node unit-registration.js register \
 *     --unit queue --incarnation queue-1 --grant logger=logger:ingest \
 *     --bootstrap-file /apps/queue/etc/identity/bootstrap [--ttl-seconds 2592000]
 *
 * Re-registering the same live incarnation redelivers a bootstrap and keeps
 * the epoch; a new incarnation, or the re-registration of a revoked one, bumps
 * the epoch, so credentials issued before stop being current at once.
 *
 * Intent: software/packages/pkg-vault/INTENT.md#parent-registration
 */
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMasterKey } from './index.js';
import { deriveSigningKey } from './unit-identity.js';
import { UNIT_NAME_PATTERN } from '../pkg-auth/unit-credentials.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = UNIT_NAME_PATTERN;
const ID = /^[A-Za-z0-9._:-]{1,190}$/;
export const DEFAULT_BOOTSTRAP_TTL_SECONDS = 30 * 24 * 3600;

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** Vault's signing public key for one universe, as the PEM consumers pin. */
export function signingPublicKeyPem({ masterKey, universe }) {
  if (typeof universe !== 'string' || !UUID.test(universe)) fail('IDENTITY_POLICY_MISSING', 'SHAPER_UNIVERSE_ID must be a UUID');
  return createPublicKey(deriveSigningKey(normalizeMasterKey(masterKey), universe)).export({ type: 'spki', format: 'pem' });
}

/**
 * The registration of one unit incarnation, as one statement root applies.
 * Every value is validated against the grammar Vault itself enforces, so the
 * literal SQL carries no injection surface and no secret.
 *
 * @param {object} options
 * @param {string} options.universe
 * @param {string} options.unit
 * @param {string} options.incarnation
 * @param {Record<string, string[]>} options.grants - audience → exact scopes
 * @param {string} options.bootstrapToken - 64 hex characters; only its digest is used
 * @param {number} [options.ttlSeconds]
 * @returns {{ sql: string, params: unknown[], text: string }}
 */
export function registrationStatement({ universe, unit, incarnation, grants, bootstrapToken, ttlSeconds = DEFAULT_BOOTSTRAP_TTL_SECONDS }) {
  if (typeof universe !== 'string' || !UUID.test(universe)) fail('REGISTRATION_INVALID', 'universe must be a UUID');
  if (typeof unit !== 'string' || !NAME.test(unit)) fail('REGISTRATION_INVALID', 'unit must be a functional slug');
  if (typeof incarnation !== 'string' || !ID.test(incarnation)) fail('REGISTRATION_INVALID', 'incarnation must match [A-Za-z0-9._:-]{1,190}');
  if (!grants || typeof grants !== 'object' || Array.isArray(grants) || !Object.keys(grants).length) {
    fail('REGISTRATION_INVALID', 'at least one audience grant is required');
  }
  for (const [audience, scopes] of Object.entries(grants)) {
    if (!NAME.test(audience) || !Array.isArray(scopes) || !scopes.length
        || !scopes.every((s) => typeof s === 'string' && ID.test(s) && !s.includes('*'))) {
      fail('REGISTRATION_INVALID', 'grants map an audience slug to exact, non-wildcard scopes');
    }
  }
  if (typeof bootstrapToken !== 'string' || !/^[0-9a-f]{64}$/.test(bootstrapToken)) fail('REGISTRATION_INVALID', 'bootstrap token must be 64 hex characters');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 366 * 24 * 3600) fail('REGISTRATION_INVALID', 'ttl must be 60 s to 366 days');
  const digest = createHash('sha256').update(bootstrapToken).digest('hex');
  const grantsJson = JSON.stringify(grants);
  // epoch is evaluated before incarnation is overwritten (left to right).
  const sql = `INSERT INTO unit_identities
  (universe_id, unit_id, incarnation, epoch, grants, bootstrap_digest, bootstrap_expires_at, revoked)
  VALUES (?, ?, ?, 1, ?, ?, TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)), FALSE)
  ON DUPLICATE KEY UPDATE epoch = IF(incarnation = VALUES(incarnation) AND NOT revoked, epoch, epoch + 1),
    incarnation = VALUES(incarnation), grants = VALUES(grants), bootstrap_digest = VALUES(bootstrap_digest),
    bootstrap_expires_at = VALUES(bootstrap_expires_at), revoked = FALSE`;
  const params = [universe, unit, incarnation, grantsJson, digest, ttlSeconds];
  const literal = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`);
  let i = 0;
  const text = `${sql.replace(/\?/g, () => literal(params[i++]))};\n`;
  return { sql, params, text };
}

/** A fresh bootstrap token, written owner-only; refuses to overwrite one. */
export function writeBootstrapToken(file) {
  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, token, { mode: 0o600, flag: 'wx' });
  return token;
}

function parseGrants(values) {
  const grants = {};
  for (const value of values) {
    const [audience, scope] = value.split('=');
    if (!audience || !scope) fail('REGISTRATION_INVALID', `--grant takes audience=scope; got ${value}`);
    (grants[audience] ||= []).push(scope);
  }
  return grants;
}

function cli(argv, env) {
  const [command, ...rest] = argv;
  if (command === 'public-key') {
    const file = env.VAULT_MASTER_KEY_FILE;
    if (!file) fail('VAULT_MASTER_KEY_FILE_REQUIRED', 'VAULT_MASTER_KEY_FILE is required');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.mode & 0o077) fail('VAULT_KEY_FILE_UNTRUSTED', 'the master-key file must be a private regular file');
    process.stdout.write(signingPublicKeyPem({ masterKey: fs.readFileSync(file, 'utf8').trim(), universe: env.SHAPER_UNIVERSE_ID }));
    return;
  }
  if (command === 'register') {
    const options = { grants: [] };
    for (let i = 0; i < rest.length; i += 2) {
      const [flag, value] = [rest[i], rest[i + 1]];
      if (value === undefined) fail('REGISTRATION_INVALID', `${flag} needs a value`);
      if (flag === '--unit') options.unit = value;
      else if (flag === '--incarnation') options.incarnation = value;
      else if (flag === '--grant') options.grants.push(value);
      else if (flag === '--bootstrap-file') options.bootstrapFile = value;
      else if (flag === '--ttl-seconds') options.ttlSeconds = Number(value);
      else fail('REGISTRATION_INVALID', `unknown option ${flag}`);
    }
    if (!options.bootstrapFile) fail('REGISTRATION_INVALID', '--bootstrap-file is required');
    const grants = parseGrants(options.grants);
    // Validate everything before the token file exists.
    registrationStatement({ universe: env.SHAPER_UNIVERSE_ID, unit: options.unit, incarnation: options.incarnation,
      grants, bootstrapToken: '0'.repeat(64), ttlSeconds: options.ttlSeconds });
    const bootstrapToken = writeBootstrapToken(options.bootstrapFile);
    process.stdout.write(registrationStatement({ universe: env.SHAPER_UNIVERSE_ID, unit: options.unit,
      incarnation: options.incarnation, grants, bootstrapToken, ttlSeconds: options.ttlSeconds }).text);
    return;
  }
  fail('USAGE', 'usage: unit-registration.js public-key | register --unit <slug> --incarnation <id> --grant <audience>=<scope> --bootstrap-file <path> [--ttl-seconds <n>]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    cli(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(`[unit-registration] ${err.code || 'ERROR'}: ${err.message}`);
    process.exit(1);
  }
}
