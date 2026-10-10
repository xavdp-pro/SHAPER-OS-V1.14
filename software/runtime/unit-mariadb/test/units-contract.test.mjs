// Intent: software/runtime/unit-mariadb/INTENT.md
// The four base unit images, their Quadlet units and univ-minimal agree with
// each other and with this runtime: one declaration (brick.json), read the
// same way everywhere it is used. Static: what a build or a live run then
// proves is in image-check.mjs and univ-minimal/deploy/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(SOFTWARE, rel), 'utf8');
const UNITS = ['vault', 'logger', 'queue', 'maestro'];
const manifest = JSON.parse(read('universes/univ-minimal/manifest.json'));

function siblingImports(pkgDir) {
  const found = new Set();
  (function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'test' || entry.name === 'node_modules') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(abs); continue; }
      if (!/\.[cm]?js$/.test(entry.name)) continue;
      const text = fs.readFileSync(abs, 'utf8');
      for (const m of text.matchAll(/(?:from\s+|import\()\s*['"]\.\.\/([^/'"]+)\//g)) found.add(m[1]);
    }
  }(pkgDir));
  return found;
}

for (const slug of UNITS) {
  describe(`brick-${slug}`, () => {
    const brick = JSON.parse(read(`bricks/brick-${slug}/brick.json`));
    const cf = read(`bricks/brick-${slug}/Containerfile`);
    const quadlet = read(`bricks/brick-${slug}/cfg-${slug}.container`);
    const { unit } = brick;
    const app = `/apps/${slug}/app`;

    test('brick.json declares one name, two fixed ids, the in-unit database and an exact schema', () => {
      assert.equal(unit.slug, slug);
      assert.equal(unit.database, 'mariadb-in-unit');
      assert.ok(Number.isInteger(unit.uid) && unit.uid > 1000);
      assert.ok(Number.isInteger(unit.engineUid) && unit.engineUid > 1000 && unit.engineUid !== unit.uid);
      assert.equal(unit.schema, `${app}/packages/pkg-${slug}/sql/schema.sql`);
      assert.ok(Number.isInteger(unit.schemaVersion) && unit.schemaVersion >= 1);
      assert.deepEqual(brick.buildRuntime, ['unit-mariadb']);
    });

    test('the schema file, the store and brick.json name the same exact version', () => {
      const schema = read(`packages/pkg-${slug}/sql/schema.sql`);
      const m = new RegExp(`INSERT INTO schema_meta \\(unit, version\\) VALUES \\('${slug}', (\\d+)\\)`).exec(schema);
      assert.ok(m, 'the schema records its version');
      assert.equal(Number(m[1]), unit.schemaVersion);
      const store = read(`packages/pkg-${slug}/mariadb-store.js`);
      const c = new RegExp(`export const ${slug.toUpperCase()}_SCHEMA_VERSION = (\\d+);`).exec(store);
      assert.ok(c, 'the store declares the version it needs');
      assert.equal(Number(c[1]), unit.schemaVersion, 'the store would refuse what the image installs');
    });

    test('the Containerfile builds that declaration, and nothing else', () => {
      assert.match(cf, new RegExp(`^ARG UNIT_UID=${unit.uid}$`, 'm'));
      assert.match(cf, new RegExp(`^ARG ENGINE_UID=${unit.engineUid}$`, 'm'));
      for (const [k, v] of Object.entries({
        SHAPER_UNIT_SLUG: slug, SHAPER_DB_SOCKET: `/run/${slug}/mysqld.sock`, UNIT_UID: unit.uid,
        UNIT_ENGINE_UID: unit.engineUid, UNIT_SCHEMA_FILE: unit.schema, UNIT_SCHEMA_VERSION: unit.schemaVersion,
      })) assert.match(cf, new RegExp(`^\\s+${k}=${String(v).replace(/[.*/]/g, '\\$&')}( \\\\)?$`, 'm'), `ENV ${k}`);
      for (const [k, v] of Object.entries({
        slug, uid: unit.uid, 'engine-uid': unit.engineUid, database: unit.database, schema: unit.schema, 'schema-version': unit.schemaVersion,
      })) assert.ok(cf.includes(`LABEL org.shaper.unit.${k}="${v}"`), `LABEL org.shaper.unit.${k}`);
      assert.match(cf, new RegExp(`^WORKDIR ${app}/packages/pkg-${slug}$`, 'm'));
      assert.match(cf, /^ENTRYPOINT \["\/sbin\/tini", "--", "node", "\/usr\/local\/lib\/shaper\/unit-mariadb\/supervisor\.mjs"\]$/m);
      assert.match(cf, /^CMD \["node", "server\.js"\]$/m);
      assert.doesNotMatch(cf, /^USER /m, 'the supervisor is root and drops to each account itself');
      assert.match(cf, /COPY --from=shaper_base \/shaper\/runtime\/unit-mariadb\/ \/usr\/local\/lib\/shaper\/unit-mariadb\//);
      assert.match(cf, /RUN UNIT_IMPORT_CHECK="[^"]+" node \/usr\/local\/lib\/shaper\/unit-mariadb\/image-check\.mjs/);
    });

    test('the engine account exists with its fixed uid before the MariaDB package is installed', () => {
      const account = cf.indexOf('adduser -S -D -H -h /var/lib/mysql -s /sbin/nologin -u "${ENGINE_UID}" -G mysql mysql');
      const apk = cf.indexOf('apk add --no-cache mariadb mariadb-client tini');
      assert.ok(account > 0 && apk > account);
      assert.ok(cf.includes(`adduser -S -D -H -h /apps/${slug} -s /sbin/nologin -u "\${UNIT_UID}" -G ${slug} ${slug}`));
    });

    test('every package sits beside the others, where its sibling imports resolve', () => {
      for (const pkg of brick.buildPackages) {
        assert.ok(cf.includes(`COPY --from=shaper_base /shaper/packages/${pkg}/ ${app}/packages/${pkg}/`), `${pkg} copied`);
        for (const sibling of siblingImports(path.join(SOFTWARE, 'packages', pkg))) {
          assert.ok(brick.buildPackages.includes(sibling), `${pkg} imports ../${sibling}/, which the image does not carry`);
        }
      }
      assert.ok(cf.includes(`RUN cd ${app}/packages/pkg-db && npm ci --omit=dev`));
    });

    test('the Quadlet unit runs one container with the three volumes and the hardening', () => {
      assert.doesNotMatch(quadlet, /^User=/m);
      for (const v of ['etc/mysql', 'sav', 'log']) {
        assert.match(quadlet, new RegExp(`^Volume=/apps/${slug}/${v}:/apps/${slug}/${v}:Z$`, 'm'));
      }
      assert.doesNotMatch(quadlet, /^Volume=.*:\/run/m, 'the socket stays inside the container');
      assert.match(quadlet, /^DropCapability=all$/m);
      assert.match(quadlet, /^AddCapability=CHOWN DAC_OVERRIDE FOWNER KILL SETGID SETUID$/m);
      assert.match(quadlet, /^NoNewPrivileges=true$/m);
      assert.match(quadlet, /^HealthCmd=\/usr\/local\/bin\/unit-ready$/m);
      assert.match(quadlet, /^Network=host$/m);
      assert.match(quadlet, /^Environment=HOST=127\.0\.0\.1$/m);
      const directives = quadlet.split('\n').filter((l) => l && !l.startsWith('#')).join('\n');
      assert.doesNotMatch(directives, /ctr-\S*-mariadb|^PublishPort=/m, 'no database container, no published port');
    });

    test('univ-minimal declares the same unit', () => {
      const declared = manifest.bricks[`brick-${slug}`];
      assert.deepEqual(declared.database, {
        engine: 'mariadb', placement: 'in-unit', slug, uid: unit.uid, engineUid: unit.engineUid,
        schema: unit.schema, schemaVersion: unit.schemaVersion,
      });
      assert.match(cf, new RegExp(`^EXPOSE ${declared.port}$`, 'm'));
    });
  });
}

test('no two units share an account or an engine id', () => {
  const ids = UNITS.flatMap((s) => {
    const { unit } = JSON.parse(read(`bricks/brick-${s}/brick.json`));
    return [unit.uid, unit.engineUid];
  });
  assert.equal(new Set(ids).size, ids.length);
});

test('the base image carries the runtime; the tests run with the base suite', () => {
  assert.match(read('registry/Containerfile.base'), /^COPY runtime\/ \/shaper\/runtime\/$/m);
  assert.match(JSON.parse(read('package.json')).scripts.test, /runtime\/\*\/test\/\*\.test\.mjs/);
});

test('univ-minimal has no separate database container and no recursive ownership change', () => {
  const deploy = path.join(SOFTWARE, 'universes/univ-minimal/deploy');
  for (const name of fs.readdirSync(deploy)) {
    const text = fs.readFileSync(path.join(deploy, name), 'utf8');
    assert.doesNotMatch(text, /SHAPER_MARIADB_IMAGE|provision-unit-mariadb/, `${name} still speaks of the separate database`);
    assert.doesNotMatch(text, /chown\s+(-R|--recursive)/, `${name} changes ownership recursively`);
    const mentions = text.match(/ctr-\$\{?slug\}?-mariadb|ctr-[a-z$]+-mariadb/g) || [];
    if (name === 'podman-up.sh') assert.ok(mentions.length > 0, 'podman-up.sh refuses a leftover database container');
    else assert.deepEqual(mentions, [], `${name} addresses a database container`);
  }
  assert.ok(!fs.existsSync(path.join(SOFTWARE, 'scripts/provision-unit-mariadb.sh')));
  for (const name of fs.readdirSync(path.join(SOFTWARE, 'runtime/unit-mariadb')).filter((f) => f.endsWith('.mjs'))) {
    assert.doesNotMatch(read(`runtime/unit-mariadb/${name}`), /recursive:\s*true[^\n]*chown|chown[^\n]*-R/, name);
  }
});
