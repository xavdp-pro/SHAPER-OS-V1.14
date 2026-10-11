// Intent: software/runtime/unit-mariadb/INTENT.md
// The four base unit images, their Quadlet units and univ-minimal agree with
// each other and with this runtime: one declaration (brick.json), read the
// same way everywhere it is used. Static: what a build or a live run then
// proves is in image-check.mjs and univ-minimal/deploy/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(SOFTWARE, rel), 'utf8');
const UNITS = ['vault', 'logger', 'queue', 'maestro'];
const manifest = JSON.parse(read('universes/univ-minimal/manifest.json'));

// What each unit needs at run time, and from whom (pkg-auth, pkg-db outbox):
// Vault relays its evidence to Logger; Logger checks every credential at
// Vault; Queue and Maestro hold a credential from Vault and owe evidence to
// Logger, and Maestro submits every occurrence to Queue.
const RUNTIME_SERVICES = { vault: ['logger'], logger: ['vault'], queue: ['vault', 'logger'], maestro: ['vault', 'logger', 'queue'] };
// The identity inputs each unit's application reads (pkg-auth runtime-identity.js,
// the units' server.js). A unit with a bootstrap holds a credential; one with a
// pin verifies credentials, or the ones it receives.
const IDENTITY = {
  vault: { bootstrap: true, pin: false, vaultUrl: false, loggerUrl: true },
  logger: { bootstrap: false, pin: true, vaultUrl: true, loggerUrl: false },
  queue: { bootstrap: true, pin: true, vaultUrl: true, loggerUrl: true },
  maestro: { bootstrap: true, pin: true, vaultUrl: true, loggerUrl: true },
};

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
      assert.ok(unit.volumes.includes('etc/mysql') && unit.volumes.includes('sav'), 'the password and the datadir are persistent');
      assert.ok(unit.volumes.every((v) => ['etc/mysql', 'sav', 'log'].includes(v)) && new Set(unit.volumes).size === unit.volumes.length);
    });

    test('brick.json declares the services it needs at run time and the credential package it runs', () => {
      assert.deepEqual(brick.runtimeServices, RUNTIME_SERVICES[slug]);
      assert.ok(brick.buildPackages.includes('pkg-auth'), 'every base unit holds or checks a Vault-signed credential');
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
      const label = /^LABEL org\.shaper\.build-packages="([^"]+)"$/m.exec(cf);
      assert.ok(label, 'the image names the packages it carries');
      assert.deepEqual(label[1].split(' ').sort(), brick.buildPackages.map((p) => p.replace(/^pkg-/, '')).sort());
      if (!unit.volumes.includes('log')) assert.doesNotMatch(cf, /LOG_DIR=/, 'no log volume, no log directory preselected');
    });

    test('the image proves at build time that the credential path resolves', () => {
      const check = /RUN UNIT_IMPORT_CHECK="([^"]+)"/.exec(cf)[1].split(' ');
      assert.ok(check.includes(`${app}/packages/pkg-auth/runtime-identity.js`) || check.includes(`${app}/packages/pkg-vault/evidence-runtime.js`),
        'the unit imports its credential path at build time');
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

    test('the Quadlet unit runs one container with its declared volumes and the hardening', () => {
      assert.doesNotMatch(quadlet, /^User=/m);
      for (const v of ['etc/mysql', 'sav', 'log']) {
        const line = new RegExp(`^Volume=/apps/${slug}/${v}:/apps/${slug}/${v}:Z$`, 'm');
        if (unit.volumes.includes(v)) assert.match(quadlet, line, `${v} is declared`);
        else assert.doesNotMatch(quadlet, new RegExp(`^Volume=/apps/${slug}/${v}:`, 'm'), `${v} is not declared`);
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

    test('the Quadlet unit carries the identity inputs the application reads, and no secret', () => {
      const want = IDENTITY[slug];
      const env = (k) => new RegExp(`^Environment=${k}=(.+)$`, 'm').exec(quadlet)?.[1];
      assert.equal(env('SHAPER_UNIVERSE_ID'), '@UNIVERSE_ID@', 'the universe UUID is written at install, never the instance name');
      assert.match(quadlet, new RegExp(`^Volume=/apps/${slug}/etc/identity:/apps/${slug}/etc/identity:ro,Z$`, 'm'));
      assert.equal(env('UNIT_BOOTSTRAP_TOKEN_FILE'), want.bootstrap ? `/apps/${slug}/etc/identity/bootstrap` : undefined);
      assert.equal(env('SHAPER_UNIT_INCARNATION'), want.bootstrap ? '@INCARNATION@' : undefined);
      assert.equal(env('UNIT_AUTH_PUBLIC_KEY_FILE'), want.pin ? `/apps/${slug}/etc/identity/vault-signing.pub` : undefined);
      assert.equal(env('VAULT_URL'), want.vaultUrl ? `http://127.0.0.1:${manifest.bricks['brick-vault'].port}` : undefined);
      assert.equal(env('LOGGER_URL'), want.loggerUrl ? `http://127.0.0.1:${manifest.bricks['brick-logger'].port}` : undefined);
      assert.doesNotMatch(quadlet, /^Environment=(VAULT_TOKEN|VAULT_MASTER_KEY|MYSQL_PASSWORD|MYSQL_PWD)=/m, 'a secret never sits in a unit file');
    });

    test('univ-minimal declares the same unit', () => {
      const declared = manifest.bricks[`brick-${slug}`];
      assert.deepEqual(declared.database, {
        engine: 'mariadb', placement: 'in-unit', slug, uid: unit.uid, engineUid: unit.engineUid,
        schema: unit.schema, schemaVersion: unit.schemaVersion, volumes: unit.volumes,
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

describe("univ-minimal's probes read a real unit as it is (CT121 run of c4d9559)", () => {
  const deploy = path.join(SOFTWARE, 'universes/univ-minimal/deploy');
  const shim = path.join(SOFTWARE, 'universes/univ-minimal/test/rehearsal/jq-shim');
  const probes = (script, ...args) => spawnSync('bash', ['-c', `UNIVERSE=univ-minimal; APPS_ROOT=/apps; MANIFEST=/dev/null; source '${deploy}/unit-probes.sh'; ${script}`, '_', ...args], {
    env: { PATH: `${shim}:${process.env.PATH}` }, encoding: 'utf8' });
  const js = probes('printf %s "$UNIT_PROCESSES_JS"').stdout;
  const proc = (layout) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-proc-'));
    for (const [pid, ppid, uid, comm, argv] of layout) {
      fs.mkdirSync(path.join(dir, String(pid)));
      fs.writeFileSync(path.join(dir, String(pid), 'status'), `Name:\t${comm}\nPPid:\t${ppid}\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`);
      fs.writeFileSync(path.join(dir, String(pid), 'comm'), `${comm}\n`);
      fs.writeFileSync(path.join(dir, String(pid), 'cmdline'), `${argv.join('\0')}\0`);
    }
    return dir;
  };
  const SUP = '/usr/local/lib/shaper/unit-mariadb/supervisor.mjs';
  const SOCK = '/run/vault/mysqld.sock';
  // What `podman top univ-minimal-ctr-vault` showed on CT121.
  const ct121 = [
    [1, 0, 0, 'tini', ['/sbin/tini', '--', 'node', SUP, 'node', 'server.js']],
    [2, 1, 0, 'node', ['node', SUP, 'node', 'server.js']],
    [13, 2, 10611, 'mariadbd', ['mariadbd', '--no-defaults', '--datadir=/apps/vault/sav/mariadb', `--socket=${SOCK}`, '--pid-file=/run/vault/mysqld.pid', '--skip-networking']],
    [58, 2, 10610, 'node', ['node', 'server.js']],
  ];
  const facts = (layout) => {
    const dir = proc(layout);
    try {
      const r = spawnSync(process.execPath, ['-e', js, dir, SOCK], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const verdicts = (json) => probes(`v() { if "$@"; then echo "$1=yes"; else echo "$1=no"; fi; }
    v probe_supervisor_root "$1"; v probe_two_processes "$1" 10611 10610; v probe_no_root_application "$1"; v probe_engine_args "$1"
    echo "engine=$(engine_pid_of "$1")"`, json).stdout;

  test('tini, whose command line names the supervisor, is not taken for it', () => {
    const json = facts(ct121);
    const f = JSON.parse(json);
    assert.deepEqual([f.supervisorCount, f.supervisor, f.pid1, f.children, f.rootUnderSupervisor, f.enginePid, f.engineArgs],
      [1, '0:1', 'tini:0', 'mariadbd:10611,node:10610', 0, '13', true]);
    assert.equal(verdicts(json), 'probe_supervisor_root=yes\nprobe_two_processes=yes\nprobe_no_root_application=yes\nprobe_engine_args=yes\nengine=13\n');
  });

  test('the predicates still fail what they must', () => {
    const rootApp = ct121.map((p) => (p[0] === 58 ? [58, 2, 0, 'node', ['node', 'server.js']] : p));
    assert.match(verdicts(facts(rootApp)), /probe_two_processes=no\nprobe_no_root_application=no/);
    const noTini = ct121.map((p) => (p[0] === 1 ? [1, 0, 0, 'sh', ['sh']] : p));
    assert.match(verdicts(facts(noTini)), /probe_supervisor_root=no/);
    const networked = ct121.map((p) => (p[0] === 13 ? [13, 2, 10611, 'mariadbd', ['mariadbd', '--no-defaults', `--socket=${SOCK}`]] : p));
    assert.match(verdicts(facts(networked)), /probe_engine_args=no/);
    const twoSupervisors = [...ct121, [70, 1, 0, 'node', ['node', SUP]]];
    assert.match(verdicts(facts(twoSupervisors)), /probe_supervisor_root=no\nprobe_two_processes=no\nprobe_no_root_application=no/);
    assert.match(verdicts('{}'), /probe_supervisor_root=no\nprobe_two_processes=no\nprobe_no_root_application=no\nprobe_engine_args=no\nengine=\n/);
  });

  test('a renewal is counted from its per-identity lines, not its summary line', () => {
    const daily = '  maestro    current   bootstrap expires 2026-12-10T05:00:00.000000Z\n  vault      current   bootstrap expires 2026-12-10T05:00:00.000000Z\n'
      + '[renew-bootstraps] univ-minimal (uuid): 2 identities checked; renewed what expired within 7 day(s)\n';
    assert.equal(probes('echo "$(count_state "$1" renewed)|$(count_state "$1" current)"', daily).stdout, '0|2\n');
  });

  test('a refusal is read whole, never through a pipe that pipefail turns into a failure', () => {
    for (const name of fs.readdirSync(deploy).filter((n) => n.endsWith('.sh'))) {
      const text = fs.readFileSync(path.join(deploy, name), 'utf8');
      if (!/set -[a-z]*o pipefail/.test(text)) continue;
      for (const line of text.split('\n')) {
        if (/^\s*#/.test(line) || /bash -c/.test(line)) continue;
        assert.doesNotMatch(line, /\|\s*grep -(q|c|qx)\b/, `${name}: ${line.trim()}`);
      }
    }
    const proof = fs.readFileSync(path.join(deploy, 'proof.sh'), 'utf8');
    assert.match(proof, /\[\[ "\$\(foreign_sql [^\n]*\)" == \*'Access denied'\* \]\]/);
  });

  test('the drills look for the log lines the supervisor writes', () => {
    const supervisor = read('runtime/unit-mariadb/supervisor.mjs');
    assert.ok(supervisor.includes('password: generated once into ${file}'));
    assert.ok(fs.readFileSync(path.join(deploy, 'restore-drill.sh'), 'utf8').includes('"password: generated once into /apps/$s/etc/mysql/localhost/passwd"'));
    assert.ok(supervisor.includes('password: ${file} kept'));
  });

  test('skip_networking is compared by its truth: CONCAT spells it ON', () => {
    assert.match(fs.readFileSync(path.join(deploy, 'proof.sh'), 'utf8'), /SELECT CONCAT\(IF\(@@skip_networking, 1, 0\), '\|', @@socket\)/);
  });
});

describe('univ-minimal births the units in the order their identities need', () => {
  const deploy = path.join(SOFTWARE, 'universes/univ-minimal/deploy');
  const up = fs.readFileSync(path.join(deploy, 'podman-up.sh'), 'utf8');

  test('Vault is born alone, first; Logger before Queue, Queue before Maestro', () => {
    assert.deepEqual(manifest.bootOrder, [['brick-vault'], ['brick-logger'], ['brick-queue'], ['brick-maestro']]);
  });

  test('podman-up registers exactly the units that hold a credential, and pins the key for the ones that verify', () => {
    const probes = fs.readFileSync(path.join(deploy, 'unit-probes.sh'), 'utf8');
    const list = (name) => new RegExp(`^${name}="([^"]+)"$`, 'm').exec(probes)?.[1].split(' ').sort();
    assert.deepEqual(list('HOLDS_CREDENTIAL'), UNITS.filter((s) => IDENTITY[s].bootstrap).sort());
    assert.deepEqual(list('PINNED'), UNITS.filter((s) => IDENTITY[s].pin).sort());
    // Every grant explicit and separate (DECISIONS-20261011 §E).
    assert.match(probes, /^\s+vault\|queue\) echo "logger=logger:ingest" ;;$/m);
    assert.match(probes, /^\s+maestro\) echo "logger=logger:ingest queue=queue:enqueue queue=queue:read" ;;$/m);
    assert.match(probes, /^PROOF_GRANTS="logger=logger:ingest logger=logger:read:own queue=queue:enqueue queue=queue:read queue=queue:claim queue=queue:attempt maestro=maestro:read maestro=maestro:admin"$/m);
    // Declared once: podman-up and the proofs read the same lists.
    assert.match(up, /^source "\$UNIV\/deploy\/unit-probes\.sh"$/m);
    assert.match(up, /^ {2}for slug in \$HOLDS_CREDENTIAL; do$/m);
    for (const name of fs.readdirSync(deploy)) {
      if (name === 'unit-probes.sh') continue;
      const text = fs.readFileSync(path.join(deploy, name), 'utf8');
      assert.doesNotMatch(text, /^\s*(HOLDS_CREDENTIAL|PINNED|PROOF_GRANTS|HOLDER_GRANT)=/m, `${name} redefines an identity list`);
    }
  });

  test('a unit\'s bootstrap replaces the one in use only once Vault holds its digest; Vault\'s goes first', () => {
    const apply = up.slice(up.indexOf('apply_registrations() {'), up.indexOf('# The parent\'s record of one identity'));
    const verified = apply.indexOf('|| halt "Vault holds');
    const delivered = apply.indexOf('mv -f "$STAGE/$unit.bootstrap"');
    assert.ok(verified > 0 && delivered > verified, 'queue and maestro bootstraps are delivered after the read-back');
    assert.ok(apply.indexOf('mv -f "$STAGE/proof.bootstrap"') > verified, "the proof's too");
    assert.ok(apply.indexOf('write_record "$unit"') > verified, 'each identity is recorded from what Vault holds, after the read-back');
    const staging = up.slice(up.indexOf('# 7c.'), up.indexOf('apply_registrations() {'));
    assert.match(staging, /mv -f "\$STAGE\/vault\.bootstrap" "\$APPS_ROOT\/vault\/etc\/identity\/bootstrap"/);
    assert.deepEqual(staging.match(/mv -f [^\n]*\/etc\/identity\/bootstrap"/g), ['mv -f "$STAGE/vault.bootstrap" "$APPS_ROOT/vault/etc/identity/bootstrap"'],
      "before Vault holds the digests, only Vault's own bootstrap is delivered");
  });

  test('a unit is recreated only when it must be, and a recreated holder gets a random incarnation (DECISIONS §B)', () => {
    assert.match(up, /^new_incarnation\(\) \{ echo "\$1-\$\(openssl rand -hex 8\)"; \}$/m);
    assert.doesNotMatch(up, /date -u \+%Y%m%dT%H%M%SZ/, 'no incarnation from a clock reading');
    const decide = up.slice(up.indexOf('decide_container() {'), up.indexOf('check_identity() {'));
    for (const reason of ['asked (--recreate)', 'no container', 'container not running', 'another image or run specification', 'its incarnation is not the one recorded']) {
      assert.ok(decide.includes(reason), reason);
    }
    assert.match(up, /--label "org\.shaper\.run-spec=\$\{SPEC_OF\[\$slug\]\}"/);
    assert.match(up, /SPEC_OF\[\$slug\]="\$\(printf '%s\\0' "\$\{IMAGE_ID_OF\[\$slug\]\}" "\$\(content_of "\$slug"\)" "\$\{FIXED_ARGS\[@\]\}" "\$\{RUN_ARGS\[@\]\}"/);
    assert.match(up, /maestro\) printf 'task-schedule:%s' "\$\(sha256sum < "\$UNIV\/task-schedule\.json"/, 'the schedule Maestro reads at start is part of its specification');
    // The incarnation is outside the specification: a kept unit keeps it.
    const spec = up.slice(up.indexOf('spec_args() {'), up.indexOf('declare -A SPEC_OF'));
    assert.doesNotMatch(spec, /SHAPER_UNIT_INCARNATION/);
    assert.match(up, /if \(\( PREFLIGHT \)\); then[\s\S]*?say "preflight done: nothing was changed"\n {2}exit 0\nfi/);
  });

  test('every podman argument is one array element: no path is split on whitespace', () => {
    assert.match(up, /"\$\{RUN_ARGS\[@\]\}"/);
    assert.doesNotMatch(up, /\$\((unit_args|identity_args|volume_args)\b/);
    const drill = fs.readFileSync(path.join(deploy, 'restore-drill.sh'), 'utf8');
    assert.match(drill, /"\$\{DRILL_ARGS\[@\]\}"/);
    assert.doesNotMatch(drill, /\$\( \[\[ "\$mode" == serve/);
  });

  test('the parent derives the pin and registers through pkg-vault/unit-registration.js, from the Vault image', () => {
    assert.match(up, /REG_TOOL=\/apps\/vault\/app\/packages\/pkg-vault\/unit-registration\.js/);
    assert.match(up, /"\$REG_TOOL" public-key > "\$derived"/);
    assert.match(up, /"\$REG_TOOL" register \\\n\s+--unit "\$unit" --incarnation "\$inc" "\$\{grants\[@\]\}" --bootstrap-file/);
    assert.match(up, /registration --user "\$VAULT_UID:\$VAULT_UID" -e SHAPER_UNIVERSE_ID \\\n/);
    assert.match(up, /registration\(\) \{ podman run --rm --network none --cap-drop=all --security-opt=no-new-privileges --entrypoint node "\$@"; \}/);
  });

  test('root applies the registrations once Vault is ready, before any later layer starts', () => {
    const loop = up.slice(up.indexOf('while read -r bricks; do'));
    const waited = loop.indexOf('wait_ready "$(jq');
    const applied = loop.indexOf('apply_registrations; fi');
    const next = loop.indexOf('layer=$((layer + 1))');
    assert.ok(waited > 0 && applied > waited && next > applied);
    assert.match(up, /podman exec -i "\$ctr" mariadb --no-defaults -S \/run\/vault\/mysqld\.sock -uroot -N -B vault < "\$STAGE\/registration\.sql"/);
  });

  test('no credential reaches a command line in any deploy script', () => {
    for (const name of fs.readdirSync(deploy)) {
      const text = fs.readFileSync(path.join(deploy, name), 'utf8');
      assert.doesNotMatch(text, /-H "Authorization: Bearer \$/, `${name} puts a bearer value on curl's command line`);
      assert.doesNotMatch(text, /-e (VAULT_TOKEN|MYSQL_PWD|MYSQL_PASSWORD)=\$/, `${name} puts a secret on podman's command line`);
      assert.doesNotMatch(text, /--grant [^\n]*\$\(cat|bootstrap[^\n]*echo "\$\(cat/, `${name} prints a bootstrap`);
    }
  });

  test('the parent renews bootstraps daily from the universe container\'s timer, never through Maestro (DECISIONS §D)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-units-'));
    try {
      const r = spawnSync('bash', [path.join(deploy, 'install-renewal-timer.sh')], {
        env: { PATH: process.env.PATH, SYSTEMD_DIR: dir, NO_SYSTEMCTL: '1', SHAPER_UNIVERSE: 'univ-minimal', ENV_FILE: '/nonexistent' }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const service = fs.readFileSync(path.join(dir, 'univ-minimal-bootstrap-renewal.service'), 'utf8');
      const timer = fs.readFileSync(path.join(dir, 'univ-minimal-bootstrap-renewal.timer'), 'utf8');
      assert.match(service, /^Type=oneshot$/m);
      assert.match(service, new RegExp(`^ExecStart=/usr/bin/env bash ${deploy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/renew-bootstraps\\.sh$`, 'm'));
      assert.match(timer, /^OnCalendar=daily$/m);
      assert.match(timer, /^Persistent=true$/m);
      assert.doesNotMatch(service + timer, /@UNIV|@ENV_LINE/);
      assert.doesNotMatch(service, /^Environment=ENV_FILE/m, 'without ENV_FILE, the universe\'s own variables file');
      // A universe configured by ENV_FILE is renewed with that same file.
      const envFile = path.join(dir, 'cfg-other.env');
      fs.writeFileSync(envFile, 'SHAPER_UNIVERSE=univ-other\n');
      const other = spawnSync('bash', [path.join(deploy, 'install-renewal-timer.sh')], {
        env: { PATH: process.env.PATH, SYSTEMD_DIR: dir, NO_SYSTEMCTL: '1', ENV_FILE: envFile }, encoding: 'utf8' });
      assert.equal(other.status, 0, other.stderr);
      assert.match(fs.readFileSync(path.join(dir, 'univ-other-bootstrap-renewal.service'), 'utf8'), new RegExp(`^Environment=ENV_FILE=${envFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.match(fs.readFileSync(path.join(deploy, 'podman-up.sh'), 'utf8'), /restore_var="RESTORE_DUMP_\$\{slug\/\/-\/_\}"/, 'a hyphenated slug names a valid variable');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(SOFTWARE, 'universes/univ-minimal/task-schedule.json'), 'utf8')).tasks, [], 'not a Maestro task');
    const renew = fs.readFileSync(path.join(deploy, 'renew-bootstraps.sh'), 'utf8');
    assert.match(renew, /podman run --rm --network none --cap-drop=all --security-opt=no-new-privileges --entrypoint node/);
    assert.match(renew, /pkg-vault\/unit-registration\.js renew "\$\{RECORD_ARGS\[@\]\}"/);
    assert.match(renew, /podman exec -i "\$CTR" mariadb --no-defaults -S \/run\/vault\/mysqld\.sock -uroot -N -B vault < "\$statement"/);
    assert.doesNotMatch(renew, /podman (restart|run -d|stop)|--recreate/, 'the renewal restarts nothing');
  });

  test('the proofs address Maestro occurrences and drill units by the universe UUID, never the instance name', () => {
    for (const name of ['proof-effects-units.sh', 'restore-drill.sh']) {
      const text = fs.readFileSync(path.join(deploy, name), 'utf8');
      assert.doesNotMatch(text, /SHAPER_UNIVERSE_ID=\$UNIVERSE\b|"\$UNIVERSE\|\$S\|/, name);
    }
  });
});
