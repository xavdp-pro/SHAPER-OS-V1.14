// Intent: software/runtime/unit-mariadb/INTENT.md
// The order of birth, with the root path played by a recording double: the
// statements are not executed (that is the universe proof's job), but which
// statements are sent, and in which order, is exactly what the supervisor does.
import assert from 'node:assert/strict';
import test from 'node:test';
import { birthOrKeep } from '../birth.mjs';
import { EXIT, expectedGrants, readConfig } from '../lib.mjs';

const PW = 'c'.repeat(64);
const config = (extra = {}) => readConfig({
  SHAPER_UNIT_SLUG: 'queue',
  UNIT_UID: '10640',
  UNIT_ENGINE_UID: '10641',
  UNIT_SCHEMA_FILE: '/apps/queue/app/packages/pkg-queue/sql/schema.sql',
  UNIT_SCHEMA_VERSION: '1',
  ...extra,
});

/**
 * @param {object} world
 * @param {string} [world.principals]  what mariadb-install-db left
 * @param {string} [world.admin]       the predicate's row
 * @param {Array<[number, boolean, number|null]>} [world.retained] successive [tables, hasMeta, version] observations
 * @param {boolean} [world.credential]   false: the password file does not authenticate the account
 * @param {boolean} [world.granted]      the account already holds its grants (a retained datadir)
 * @param {string} [world.grants]
 */
function double(world = {}) {
  const calls = [];
  const retained = [...(world.retained || [[0, false, null], [6, true, 1]])];
  let current = retained[0];
  // As a real server answers: authenticating needs the account and its
  // password; opening the unit database needs its grants (else ERROR 1044).
  let granted = world.granted ?? false;
  const ops = {
    async rootSql(sql, { what } = {}) {
      calls.push({ kind: 'sql', what, sql });
      if (what === 'converge the unit grants') granted = true;
      if (what === 'read the accounts mariadb-install-db created') return world.principals ?? 'root\tlocalhost\t0\nmariadb.sys\tlocalhost\t0\nmysql\tlocalhost\t0\n';
      if (what === 'observe the administrative accounts') return world.admin ?? '1\t1\t\n';
      if (what === 'observe the retained database') {
        current = retained.length > 1 ? retained.shift() : retained[0];
        return `1\t${current[0]}\t${current[1] ? 1 : 0}\n`;
      }
      if (what === 'read schema_meta') return current[2] === null ? '' : `${current[2]}\n`;
      if (what === 'observe the unit grants') return world.grants ?? `${expectedGrants('queue').join('\n')}\n`;
      return '';
    },
    async loadSchema() { calls.push({ kind: 'loadSchema' }); },
    async loadDump() { calls.push({ kind: 'loadDump' }); },
    async checkCredential({ database = true } = {}) {
      calls.push({ kind: database ? 'opens database' : 'authenticates' });
      if (world.credential === false) return { ok: false, detail: "ERROR 1045 (28000): Access denied for user 'queue'@'localhost'" };
      if (database && (!granted || world.opens === false)) return { ok: false, detail: "ERROR 1044 (42000): Access denied for user 'queue'@'localhost' to database 'queue'" };
      return { ok: true, detail: '' };
    },
  };
  return { ops, calls };
}

const MUTATION = /\b(CREATE|ALTER|DROP|GRANT|REVOKE|DELETE|INSERT|UPDATE)\b/;
const mutations = (calls) => calls.filter((c) => c.kind === 'loadSchema' || c.kind === 'loadDump'
  || (c.kind === 'sql' && !/^observe|^read/.test(c.what) && MUTATION.test(c.sql)));
const index = (calls, predicate) => calls.findIndex(predicate);

test('first birth: hardening, then the administrative check, then schema, account, credential and grants', async () => {
  const { ops, calls } = double();
  const result = await birthOrKeep({ config: config(), fresh: true, password: PW, ops });
  assert.deepEqual(result, { schema: 'applied', version: 1 });
  const order = calls.map((c) => c.what || c.kind);
  assert.deepEqual(order, [
    'read the accounts mariadb-install-db created',
    'first-birth hardening',
    'observe the administrative accounts',
    'observe the retained database',
    'create the unit database',
    'loadSchema',
    'observe the retained database',
    'read schema_meta',
    'ensure the unit account',
    'authenticates',
    'converge the unit grants',
    'observe the unit grants',
    'opens database',
  ]);
  const hardening = calls.find((c) => c.what === 'first-birth hardening').sql;
  assert.match(hardening, /DROP USER IF EXISTS 'mysql'@'localhost'/);
  assert.match(hardening, /ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket/);
  assert.match(calls.find((c) => c.what === 'ensure the unit account').sql, new RegExp(`IDENTIFIED BY '${PW}'`));
});

test('a first birth succeeds against a server that refuses the database before the grants (CT121, ERROR 1044)', async () => {
  // Non-regression: the credential was checked against the unit database
  // before the grants converged, so every first birth refused (exit 9), and
  // each restart of the container then found a retained schema and refused again.
  const { ops, calls } = double();
  assert.deepEqual(await birthOrKeep({ config: config(), fresh: true, password: PW, ops }), { schema: 'applied', version: 1 });
  const second = double({ retained: [[6, true, 1]], granted: true });
  assert.deepEqual(await birthOrKeep({ config: config(), fresh: false, password: PW, ops: second.ops }), { schema: 'retained', version: 1 });
  assert.ok(index(calls, (c) => c.kind === 'authenticates') < index(calls, (c) => c.what === 'converge the unit grants'));
  assert.ok(index(calls, (c) => c.kind === 'opens database') > index(calls, (c) => c.what === 'observe the unit grants'));
});

test('an account that authenticates but still cannot open its database after the grants refuses (exit 10)', async () => {
  const { ops } = double({ retained: [[6, true, 1]], opens: false });
  await assert.rejects(birthOrKeep({ config: config(), fresh: false, password: PW, ops }),
    (err) => err.code === 'GRANTS_MISMATCH' && err.exitCode === EXIT.GRANTS && /does not open queue/.test(err.message));
});

test('a retained database at the declared version re-applies nothing and keeps the account', async () => {
  const { ops, calls } = double({ retained: [[6, true, 1]], granted: true });
  const result = await birthOrKeep({ config: config(), fresh: false, password: PW, ops });
  assert.deepEqual(result, { schema: 'retained', version: 1 });
  assert.equal(index(calls, (c) => c.what === 'first-birth hardening'), -1, 'no hardening outside first birth');
  assert.equal(index(calls, (c) => c.kind === 'loadSchema'), -1, 'no DDL at restart');
  assert.equal(index(calls, (c) => c.what === 'create the unit database'), -1);
  assert.match(calls.find((c) => c.what === 'ensure the unit account').sql, /CREATE USER IF NOT EXISTS/);
});

test('unsafe retained administrative accounts refuse (exit 8) before any grant or schema statement', async () => {
  for (const admin of ['0\t1\troot@%\n', '0\t2\t\n', '', 'garbage\n']) {
    const { ops, calls } = double({ admin, retained: [[6, true, 1]] });
    await assert.rejects(birthOrKeep({ config: config(), fresh: false, password: PW, ops }),
      (err) => err.code === 'ADMIN_AUTHENTICATION_MISMATCH' && err.exitCode === EXIT.ADMIN);
    assert.deepEqual(mutations(calls), [], `admin row ${JSON.stringify(admin)} must stop before any mutation`);
  }
});

test('the refusal names the unexpected principals, never an authentication string', async () => {
  const { ops } = double({ admin: '0\t1\thealthcheck@localhost,root@::1\n', retained: [[6, true, 1]] });
  await assert.rejects(birthOrKeep({ config: config(), fresh: false, password: PW, ops }),
    (err) => /healthcheck@localhost, root@::1/.test(err.message) && !err.message.includes(PW));
});

test('a retained schema of another version refuses (exit 7) before any grant or schema statement', async () => {
  for (const retained of [[[6, true, 2]], [[6, true, null]], [[6, false, null]]]) {
    const { ops, calls } = double({ retained });
    await assert.rejects(birthOrKeep({ config: config(), fresh: false, password: PW, ops }),
      (err) => err.code === 'SCHEMA_VERSION_MISMATCH' && err.exitCode === EXIT.SCHEMA_VERSION);
    assert.deepEqual(mutations(calls), []);
  }
});

test('an installed schema that does not record the declared version refuses (exit 7) before the account', async () => {
  const { ops, calls } = double({ retained: [[0, false, null], [6, true, 2]] });
  await assert.rejects(birthOrKeep({ config: config(), fresh: true, password: PW, ops }), (err) => err.exitCode === EXIT.SCHEMA_VERSION);
  assert.equal(index(calls, (c) => c.what === 'ensure the unit account'), -1);
});

test('a password file that does not open the retained account refuses (exit 9) and grants nothing', async () => {
  const { ops, calls } = double({ retained: [[6, true, 1]], credential: false });
  await assert.rejects(birthOrKeep({ config: config(), fresh: false, password: PW, ops }),
    (err) => err.code === 'CREDENTIAL_MISMATCH' && err.exitCode === EXIT.CREDENTIAL && /never done at start/.test(err.message));
  assert.equal(index(calls, (c) => c.what === 'converge the unit grants'), -1);
  assert.equal(calls.filter((c) => /ALTER USER|SET PASSWORD/.test(c.sql || '')).length, 0, 'no silent rotation');
});

test('grants that are not exactly DML on the unit database refuse (exit 10)', async () => {
  const grants = `${expectedGrants('queue').join('\n')}\nschema\tqueue\tCREATE\tNO\n`;
  const { ops } = double({ retained: [[6, true, 1]], grants });
  await assert.rejects(birthOrKeep({ config: config(), fresh: false, password: PW, ops }),
    (err) => err.code === 'GRANTS_MISMATCH' && err.exitCode === EXIT.GRANTS);
});

test('restore into a fresh datadir loads the dump instead of the image schema', async () => {
  const { ops, calls } = double();
  const result = await birthOrKeep({ config: config({ UNIT_RESTORE_DUMP: '/apps/queue/sav/restore/queue.sql' }), fresh: true, password: PW, ops });
  assert.equal(result.schema, 'restored');
  assert.notEqual(index(calls, (c) => c.kind === 'loadDump'), -1);
  assert.equal(index(calls, (c) => c.kind === 'loadSchema'), -1);
});

test('a restore dump is refused by a database that already has tables', async () => {
  const { ops, calls } = double({ retained: [[6, true, 1]] });
  await assert.rejects(birthOrKeep({ config: config({ UNIT_RESTORE_DUMP: '/apps/queue/sav/restore/queue.sql' }), fresh: false, password: PW, ops }),
    (err) => err.code === 'RESTORE_REQUIRES_FRESH_DATADIR');
  assert.deepEqual(mutations(calls), []);
});

test('a stop requested during birth ends it at the next step boundary', async () => {
  const { ops, calls } = double();
  let stop = false;
  const abort = () => { if (stop) throw Object.assign(new Error('stop'), { code: 'STOP_REQUESTED' }); };
  const original = ops.rootSql;
  ops.rootSql = async (sql, o) => {
    const out = await original(sql, o);
    if (o.what === 'observe the administrative accounts') stop = true;
    return out;
  };
  await assert.rejects(birthOrKeep({ config: config(), fresh: true, password: PW, ops, abort }), (err) => err.code === 'STOP_REQUESTED');
  assert.equal(index(calls, (c) => c.what === 'observe the retained database'), -1);
});
