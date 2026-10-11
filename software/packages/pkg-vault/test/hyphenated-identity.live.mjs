/**
 * Live (real private MariaDB): a hyphenated functional slug — `brick-voice`,
 * as the Clinic kit names its units — is one name everywhere, with no alias
 * (DECISIONS-20261011 §K): the root path births its database and account with
 * the unit runtime's own statements and observes exactly the declared grants;
 * pkg-db opens it and the server confirms the identity; Vault registers it,
 * stores it, issues it a credential for a hyphenated audience and checks it.
 *
 * Run through software/packages/pkg-db/test/live/run-live.mjs.
 * Intent: software/packages/pkg-auth/INTENT.md#vault-signed-unit-identities
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { adminConnection, adminQuery, liveEnv, resetUnit, unitDb } from '../../pkg-db/test/live/live-env.mjs';
import { openUnitDb } from '../../pkg-db/pool.js';
import {
  assertGrants, createAccountSql, createDatabaseSql, grantsObservationSql, grantsSql,
} from '../../../runtime/unit-mariadb/lib.mjs';
import { MariaDbVaultStore } from '../mariadb-store.js';
import { VaultUnitIdentity } from '../unit-identity.js';
import { registrationStatement } from '../unit-registration.js';

const SLUG = 'brick-voice';
const UNIVERSE = '550e8400-e29b-41d4-a716-446655440000';
let vaultStore;

before(async () => {
  await resetUnit('vault');
  vaultStore = await MariaDbVaultStore.open({ masterKey: crypto.randomBytes(32).toString('hex'), slug: 'vault', db: unitDb() });
});
after(async () => {
  await vaultStore?.close();
  await adminQuery(`DROP DATABASE IF EXISTS \`${SLUG}\``);
  await adminQuery(`DROP USER IF EXISTS '${SLUG}'@'localhost'`);
});

describe('a hyphenated functional slug is one name everywhere', () => {
  it('the root path births its database and account, quoted, with exactly the declared grants', async () => {
    const password = crypto.randomBytes(32).toString('hex');
    const admin = await adminConnection();
    try {
      await admin.query(createDatabaseSql(SLUG));
      await admin.query(createAccountSql(SLUG, password));
      await admin.query(grantsSql(SLUG));
      const [rows] = await admin.query({ sql: grantsObservationSql(SLUG), rowsAsArray: true });
      assertGrants(rows.map((r) => r.join('\t')).join('\n'), SLUG);
      await admin.query(`USE \`${SLUG}\`; CREATE TABLE schema_meta (unit VARCHAR(64) PRIMARY KEY, version INT NOT NULL);
        INSERT INTO schema_meta VALUES ('${SLUG}', 1)`);
    } finally {
      await admin.end();
    }
    const passwd = path.join(liveEnv().appsRoot, SLUG, 'etc/mysql/localhost/passwd');
    fs.mkdirSync(path.dirname(passwd), { recursive: true, mode: 0o700 });
    fs.writeFileSync(passwd, `${password}\n`, { mode: 0o600 });
  });

  it('pkg-db opens it, and the server says it is brick-voice@localhost on brick-voice', async () => {
    const { pool, config } = await openUnitDb({ slug: SLUG, ...unitDb() });
    try {
      assert.deepEqual([config.user, config.database], [SLUG, SLUG]);
      const [[row]] = await pool.query('SELECT CURRENT_USER() AS who, DATABASE() AS db, (SELECT version FROM schema_meta WHERE unit = ?) AS v', [SLUG]);
      assert.deepEqual({ ...row }, { who: `${SLUG}@localhost`, db: SLUG, v: 1 });
      await assert.rejects(pool.query('CREATE TABLE ddl_refused (i INT)'), /denied/);
    } finally {
      await pool.end();
    }
  });

  it('Vault registers it, stores it, and issues and checks its credential for a hyphenated audience', async () => {
    const bootstrapToken = crypto.randomBytes(32).toString('hex');
    const { sql, params } = registrationStatement({ universe: UNIVERSE, unit: SLUG, incarnation: `${SLUG}-1`,
      grants: { 'brick-ipbx': ['ipbx:callctx:claim'] }, bootstrapToken, ttlSeconds: 3600 });
    await adminQuery(`USE vault; ${sql}`, params);
    const identity = new VaultUnitIdentity({ pool: vaultStore.pool, masterKey: vaultStore.masterKey, universe: UNIVERSE });
    const { token, claims } = await identity.issue({ unit: SLUG, incarnation: `${SLUG}-1`, audience: 'brick-ipbx', bootstrapToken });
    assert.deepEqual([claims.unit, claims.audience, claims.scopes], [SLUG, 'brick-ipbx', ['ipbx:callctx:claim']]);
    assert.equal((await identity.check(token, 'brick-ipbx')).credentialId, claims.credentialId);
    const [stored] = await adminQuery(`SELECT i.unit_id AS unit, c.audience, c.unit_id AS credentialUnit FROM vault.unit_identities i
      JOIN vault.unit_credentials c ON c.universe_id = i.universe_id AND c.unit_id = i.unit_id WHERE c.credential_id = ?`, [claims.credentialId]);
    assert.deepEqual({ ...stored }, { unit: SLUG, audience: 'brick-ipbx', credentialUnit: SLUG });
    await assert.rejects(identity.issue({ unit: 'brick_voice', incarnation: `${SLUG}-1`, audience: 'brick-ipbx', bootstrapToken }),
      { code: 'IDENTITY_ISSUE_DENIED' }, 'no alias: brick_voice is another unit');
  });
});
