import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-11-nftables-inside-the-universe
// Intent: software/RULES.md#rule-11-nesting-needs-a-restart
// Intent: software/RULES.md#rule-11-read-profiles-with-config-show
//
// Non-regression (Rule 29) for three lessons of the first night Rule 11 ran
// in production (1 September 2026, docs/proof/proof-rule-11-in-production.md):
//
//  * podman's nested network (netavark) needs nftables inside the LXC, and
//    dies with an opaque error without it. No shipped provisioning script
//    installed it, and the runbook's literal install line did not name it.
//  * `lxc info` does not list the profiles applied to a container. An
//    idempotence check built on it "passed" every time, and the next run
//    tried to add a profile that was already there. `lxc config show` lists
//    them; so does `pct config` on Proxmox.
//  * `security.nesting` does not apply to a running container. Set without
//    a restart, the symptom is identical to no nesting at all.
//
// The lessons are checked in every shipped shell script and in the two
// literal documents an agent is told to follow.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const at = (p) => path.join(REPO, p);
const read = (p) => fs.readFileSync(at(p), 'utf8');

/** The `apt-get install` lines of a script name nftables among the packages. */
export function installsNftables(text) {
  return text.split('\n').some((l) => /apt(-get)?\s+install/.test(l) && /\bnftables\b/.test(l));
}

/**
 * Every line that turns nesting on for an existing container must carry, on
 * itself or within a few lines after it, the restart that makes it apply.
 * Returns the offending line numbers.
 */
export function nestingSetWithoutRestart(text, window = 12) {
  const lines = text.split('\n');
  const offenders = [];
  lines.forEach((line, i) => {
    const setsNesting = /\blxc\s+config\s+set\b.*security\.nesting/.test(line)
      || /\bpct\s+set\b.*nesting=1/.test(line);
    if (!setsNesting) return;
    const breath = lines.slice(i, i + 1 + window).join('\n');
    if (!/\blxc\s+restart\b|\bpct\s+(reboot|restart)\b/.test(breath)) offenders.push(i + 1);
  });
  return offenders;
}

/**
 * Lines that read a profile through `lxc info` — its output piped into a
 * search for a profile — which never lists one. Prose that warns against
 * the gesture is not the gesture: only the piped form is the defect.
 */
export function profileReadThroughInfo(text) {
  return text.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /\blxc\s+info\b[^|\n]*\|.*profile/i.test(line))
    .map(([n]) => n);
}

// --- the detectors, on the shapes seen on terrain -------------------------

test('the detectors recognise the three defects', () => {
  assert.equal(installsNftables('apt-get install -y podman crun'), false);
  assert.equal(installsNftables('apt-get install -y podman crun nftables curl'), true);

  assert.deepEqual(nestingSetWithoutRestart([
    'lxc config set univ-x security.nesting=true',
    'lxc exec univ-x -- podman info',
  ].join('\n')), [1]);
  assert.deepEqual(nestingSetWithoutRestart([
    'lxc config set univ-x security.nesting=true',
    'lxc restart univ-x',
  ].join('\n')), []);
  assert.deepEqual(nestingSetWithoutRestart([
    'pct set 130 --features nesting=1,keyctl=1',
    'echo nothing else',
  ].join('\n')), [1]);
  assert.deepEqual(nestingSetWithoutRestart('pct set 130 --features nesting=1\npct reboot 130'), []);
  assert.deepEqual(nestingSetWithoutRestart('pct set 130 --features nesting=1,keyctl=1 && pct reboot 130'), []);

  assert.deepEqual(profileReadThroughInfo('if lxc info "$CT" | grep -q podman-univ-profile; then'), [1]);
  assert.deepEqual(profileReadThroughInfo('HAS=$(lxc info "$CT" | grep -c "profiles: podman-univ")'), [1]);
  assert.deepEqual(profileReadThroughInfo('lxc info "$CT" > /dev/null 2>&1 || exit 2'), []);
  assert.deepEqual(profileReadThroughInfo('# never read a profile through lxc info'), []);
  assert.deepEqual(profileReadThroughInfo('lxc config show "$CT" | grep -A3 "^profiles:"'), []);
});

// --- the shipped scripts and the literal documents ------------------------

const PROVISIONERS = [
  'software/scripts/provision-lxc-univ.sh',
  'software/scripts/quick-bootstrap-lxc.sh',
];

test('every LXC provisioner installs nftables inside the container', () => {
  const missing = PROVISIONERS.filter((p) => !installsNftables(read(p)));
  assert.deepEqual(missing, [], `podman's nested network will die without nftables in:\n  ${missing.join('\n  ')}`);
});

test("the runbook's literal install line inside the LXC names nftables", () => {
  const runbook = read('docs/agent/RUNBOOK-EXPLICIT.md');
  const lines = runbook.split('\n').filter((l) => /lxc exec .*apt-get install/.test(l));
  assert.ok(lines.length > 0, 'Step 0a installs packages inside the LXC with lxc exec');
  const without = lines.filter((l) => !/\bnftables\b/.test(l));
  assert.deepEqual(without, [], 'a literal agent runs this line and never learns why podman networking fails');
});

/**
 * The clean-sheet guide's "Inside it" section: the literal lines a tester ran
 * inside a blank LXC on 23 August 2026, kept as the from-scratch record an
 * agent follows. Its `apt-get install` line is a literal install line like
 * the runbook's, and it did not name nftables either.
 */
function insideItInstallLines() {
  const guide = read('software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md');
  const section = guide.split(/^### Inside it\s*$/m)[1];
  assert.ok(section, 'the guide carries a "### Inside it" section');
  const fence = section.match(/```bash\n([\s\S]*?)```/);
  assert.ok(fence, 'the "Inside it" section opens with a bash block');
  return fence[1].split('\n').filter((l) => /apt(-get)?\s+install/.test(l));
}

test("the clean-sheet guide's literal install line inside the LXC names nftables", () => {
  const lines = insideItInstallLines();
  assert.ok(lines.length > 0, 'the "Inside it" block installs packages with apt-get');
  const without = lines.filter((l) => !/\bnftables\b/.test(l));
  assert.deepEqual(without, [], 'a literal agent runs this line and never learns why podman networking fails');
});

/**
 * Every line of the guide that installs podman, not the one block a first
 * guard happened to read. The guide carries two install lines — Step 1 of the
 * eight-step walk, and the "Inside it" record — and the guard above read the
 * second only: the first still installed podman without nftables, and Step 1
 * is the line an agent following the numbered steps runs.
 */
export function podmanInstallLines(text) {
  return text.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !/^\s*#/.test(line) && /apt(-get)?\s+install/.test(line) && /\bpodman\b/.test(line));
}

test('the detector reads every apt-get line that installs podman', () => {
  const text = [
    'apt-get update && apt-get install -y   podman   git   curl',
    'apt-get install -y podman nftables git',
    'apt-get install -y curl jq',
    '# apt-get install is explained above, podman too',
  ].join('\n');
  assert.deepEqual(podmanInstallLines(text).map(([n]) => n), [1, 2]);
});

test('every apt-get line of the clean-sheet guide that installs podman names nftables', () => {
  const guide = read('software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md');
  const lines = podmanInstallLines(guide);
  assert.ok(lines.length >= 2, 'the guide installs podman in Step 1 and in the "Inside it" record');
  const without = lines.filter(([, line]) => !/\bnftables\b/.test(line)).map(([n, line]) => `line ${n}: ${line.trim()}`);
  assert.deepEqual(without, [], `podman's nested network dies without nftables, and the guide installs podman without it:\n  ${without.join('\n  ')}`);
});

function shippedShell() {
  const found = [];
  const collect = (dir, prefix) => {
    if (!fs.existsSync(at(dir))) return;
    for (const n of fs.readdirSync(at(dir))) if (n.endsWith('.sh')) found.push(`${prefix}/${n}`);
  };
  collect('software/scripts', 'software/scripts');
  for (const u of fs.readdirSync(at('software/universes'))) {
    collect(`software/universes/${u}/deploy`, `software/universes/${u}/deploy`);
    collect(`software/universes/${u}/recipes`, `software/universes/${u}/recipes`);
  }
  return found;
}

const LITERAL_DOCS = ['docs/agent/RUNBOOK-EXPLICIT.md', 'software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md'];

test('nesting is never turned on for an existing container without the restart that applies it', () => {
  const offenders = [];
  for (const file of [...shippedShell(), ...LITERAL_DOCS]) {
    for (const n of nestingSetWithoutRestart(read(file))) offenders.push(`${file}:${n}`);
  }
  assert.deepEqual(offenders, [], `nesting set without a restart — the symptom is identical to no nesting:\n  ${offenders.join('\n  ')}`);
});

test('no shipped script or literal document reads a profile through lxc info', () => {
  const offenders = [];
  for (const file of [...shippedShell(), ...LITERAL_DOCS]) {
    for (const n of profileReadThroughInfo(read(file))) offenders.push(`${file}:${n}`);
  }
  assert.deepEqual(offenders, [], `lxc info never lists profiles — use lxc config show:\n  ${offenders.join('\n  ')}`);
});
