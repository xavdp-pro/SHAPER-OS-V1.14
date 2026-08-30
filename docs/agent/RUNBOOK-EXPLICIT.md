# Explicit Runbook — Literal Steps, No Derivation Required

> **Audience:** fast and light models, and any agent that must not improvise.
> **Rule of this file:** if a situation is not written here, **stop and ask the
> human**. Do not derive, do not guess, do not "adapt". Deriving from principles
> is a different document ([`PRINCIPLES.md`](./PRINCIPLES.md)) for a different
> class of agent.

Every step has: what to run, what a correct result looks like, and what to do
when it is not correct. When a step says STOP, stop — do not continue to the
next step to "see if it resolves itself".

---

## Step 0 — Confirm you are in the right repository

```bash
ls software/packages
```

- **Correct:** a list of package directories.
- **Not correct:** the path does not exist → **STOP.** Say: "This is not the
  SHAPER OS monorepo — `software/packages` is missing." Do not clone anything,
  do not create the directory.

## Step 0a — The terrain: you deploy inside an LXC, not on the host

Rule 11: **LXC is the universe, podman is the brick.** Never deploy a universe
directly on a host that carries production. Create the container first:

```bash
# Debian/Ubuntu host with LXD. The `< /dev/null` is not decoration: over a
# piped SSH session lxc launch waits on stdin forever without it.
lxc launch images:debian/13 <univ_slug> --profile podman-univ < /dev/null
lxc exec <univ_slug> -- apt-get update
lxc exec <univ_slug> -- apt-get install -y podman git curl jq nodejs npm openssl
```

On a **Proxmox** host it is `pct create` with `features: nesting=1,keyctl=1`
instead — both families, with the full package list and the profile
definition, are in
[`../../software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md`](../../software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md).
Nesting is mandatory; without it podman fails on the first image with a
`Permission denied` that says nothing about nesting.

- **The host has neither Proxmox nor LXD → STOP and ask.** Installing a
  hypervisor is an architecture decision, not a package install (Rule 11).

*(Added in V1.13.5: a cold tester following the runbook literally reached the
build with no container, and had to derive its creation from the Boot Contract.
Terrain is a step, not an assumption.)*

## Step 0b — The machine prerequisites (ask, never invent)

*(Added in V1.13.1: all five beta testers were blocked or improvised here.)*

1. **The podman registry.** Every machine that builds or deploys has ONE
   registry — it is infrastructure, like its disk. Do not invent one, do not
   start a throwaway one, do not push to a registry another machine owns.

   **Ask the human this exact question**, because a shorter one gets an
   unusable answer:

   > *"Which registry does this machine use, at an address reachable **from
   > inside a universe LXC**, and is it TLS-verified?"*

   **Why the wording matters**: the build runs inside the universe LXC
   (Rule 11), so a loopback address answered from the host names the LXC
   itself, and the first push dies on `connection refused` with nothing in
   the message pointing at the cause.

   ```bash
   export SHAPER_REGISTRY=<HOST_OR_IP>:<PORT>        # what the human named
   export SHAPER_TLS_VERIFY=false                    # ONLY if the human said it is insecure

   curl -sf "http://$SHAPER_REGISTRY/v2/" && echo "registry reachable"   # BEFORE building
   ```

   - **If the human said the registry is insecure, tell the container engine
     NOW — do not wait for a push to fail.** `SHAPER_TLS_VERIFY` steers
     SHAPER's own scripts, but podman has its own TLS policy and on Debian it
     defaults to TLS for any non-loopback registry: without the stanza below,
     the first `podman push` dies with `http: server gave HTTP response to
     HTTPS client` (seen on trixie LXCs even with `SHAPER_TLS_VERIFY=false`).
     Two lines, hard-won:

     ```bash
     mkdir -p /etc/containers/registries.conf.d
     printf '[[registry]]\nlocation="%s"\ninsecure=true\n' "$SHAPER_REGISTRY" \
       > /etc/containers/registries.conf.d/shaper.conf
     ```

   - **It does not answer → STOP.** Do not guess another address, do not
     start your own registry. Report: *"`$SHAPER_REGISTRY` does not answer
     from here; I need an address reachable from inside the universe LXC."*
   - **The human is absent and you do not know the registry → STOP.** That is
     the measured result; write it down.
   - The address is recorded per machine in the fleet map
     (`machines[].registry` — see [`../architecture/FLEET.md`](../architecture/FLEET.md)),
     so this question is asked once per machine, not once per deployment.

1c. **Step 0c — the start-line gate.** Once the registry is answered and
   exported (with `SHAPER_IMAGE_TAG`), run the mechanical gate — it checks
   every prerequisite of [`../PREREQUISITES.md`](../PREREQUISITES.md) and
   runs on a naked clone, before any `npm install`:

   ```bash
   cd software && npm run preflight     # or: node scripts/preflight.mjs
   ```

   - **Exit 0 → start.**
   - **Exit 1 → DO NOT START.** The failures it prints are your measured
     result: report them. The only path past a red gate is the word of the
     human working with you — they, never you, run it as
     `SHAPER_HUMAN_OVERRIDE=1 npm run preflight` — and your report records
     the override and what it covered.

2. **Node.js ≥ 20 on the machine that runs the tests:**

   ```bash
   node --version
   ```

   - **Not correct:** absent or too old → install it (Debian:
     `apt-get install -y nodejs npm`) before Step 4. `npm test` runs on the
     host; images carry their own runtime, the host test run does not.

3. **Memory.** On a small host the image build can be killed with `exit 137`
   and no other explanation — if that happens, memory is the first suspect.
   (No figure is given: none has been measured. Rule 10's spirit applies.)

## Step 1 — Read these four files, in this order

1. [`LAW.md`](../../LAW.md)
2. [`./BOOT-CONTRACT.md`](./BOOT-CONTRACT.md)
3. [`docs/human/START-HERE.md`](../human/START-HERE.md)
4. [`docs/human/KEYS-AND-ACCOUNTS.md`](../human/KEYS-AND-ACCOUNTS.md)

Then `software/RULES.md` in full. Do not summarise it for yourself and do not
skip sections because they look unrelated.

**If the canon does not fit in your context**, do not skim it and do not pretend
you read it. Say this to the human, in these terms: *"I cannot hold
`software/RULES.md` in full. I will work strictly inside this runbook and stop at
anything it does not cover."* Then do exactly that. An agent that declares its
limit is safe; an agent that hides it will break a rule it never read.

## Step 2 — Generate the local secrets

```bash
openssl rand -hex 32   # VAULT_MASTER_KEY
openssl rand -hex 24   # VAULT_TOKEN
```

These are the two secrets the universe runs on. Do **not** hand-edit them into
a file now — `software/.env` does not exist yet, and Step 4.1 injects them with
exact commands. Never write a secret into a chat message, a commit, a shell
script, or a log line.

## Step 3 — Verify every required secret BEFORE building anything

Check `.env` at the repository root, `software/.env`, and the universe folder.
For the target tier, every required key must be present, non-empty, and not a
placeholder such as `changeme`, `xxx`, or `your-key-here`.

- **A key is missing or is a placeholder → STOP.** Name the exact key, give the
  vendor console URL from [`docs/human/KEYS-AND-ACCOUNTS.md`](../human/KEYS-AND-ACCOUNTS.md),
  and wait for the human. Do not build. Do not launch. Do not "start without it
  and add it later".
- **All keys present:** copy the validated values into `software/.env` and into
  every universe `deploy/*.env` so each container boots with valid credentials.

## Step 4 — The DEV pipeline, in this exact order

Do not reorder. Do not skip. Each command must succeed before the next one runs.

**First, get the universe slug from the human.** Do not invent it, and **do not
derive it from something else you were given**: a container name, a host name or
a ticket number is not a slug, and a tester who assumed the two were the same
said afterwards that he should have asked. It is lowercase, letters, digits and
hyphens only (Rule 1).

**Where the universe directory goes.** `<univ_slug>-dev/` at the repository
top level (a sibling of `software/`, inside the clone) is the default — one
concrete example: repo at `/root/SHAPER-OS-V1.13`, universe at
`/root/SHAPER-OS-V1.13/<univ_slug>-dev/`. The repo's own test suite only
checks manifests the repo ships (tracked files), so your workspace inside the
clone does not break `npm test` (fixed in V1.13.1 — beta finding F12). A
universe carrying real work belongs **outside** the repository — this one is
generic and publishes what it contains — and then the deploy script needs
`SHAPER_ROOT` pointing at the `software/` tree, since it can no longer find
it by walking up.

**Write the universe's INTENT before you create anything.** Principle 1 is
*intent precedes form*, and it is broken by habit: a tester created the container
first and used the human's request as an implicit intention. Copy
`software/universes/_template/INTENT.md`, state in it what this universe is for
and its four to six invariants, and only then run the commands below.

```bash
# 4.0 — the intention, first
mkdir -p <univ_slug>-dev/context
cp software/universes/_template/INTENT.md          <univ_slug>-dev/INTENT.md
cp software/universes/_template/context/ctx-universe.md <univ_slug>-dev/context/ctx-universe.md
# then edit both: a template left with its placeholders is an unfinished universe

# 4.1 — from the repository root
cp .env.example software/.env
cp software/resources/vault-resources.dev.example.json \
   software/resources/vault-resources.local.json
# The copies carry EMPTY vault keys. Inject fresh secrets into software/.env
# FIRST — with these exact commands, because "write them into .env" left every
# literal tester stalled on empty keys and deriving this sed alone:
sed -i "s|^VAULT_MASTER_KEY=.*|VAULT_MASTER_KEY=$(openssl rand -hex 32)|" software/.env
sed -i "s|^VAULT_TOKEN=.*|VAULT_TOKEN=$(openssl rand -hex 24)|" software/.env
# THEN mirror them into vault-resources.local.json — with this exact command,
# because "fill them in" left a tester shipping the placeholder token:
python3 - <<'FILL'
import json, re
env = dict(re.findall(r'^([A-Z_]+)=(.*)$', open('software/.env').read(), re.M))
p = 'software/resources/vault-resources.local.json'
d = json.load(open(p))
d.setdefault('vault', {})['masterKey'] = env['VAULT_MASTER_KEY']
d['vault']['token'] = env.get('VAULT_TOKEN', '')
json.dump(d, open(p, 'w'), indent=2)
print('vault-resources.local.json filled from software/.env')
FILL

# 4.2 — build and verify the software
cd software
npm test                              # packages only — MUST be green

# The registry and tag from Step 0b MUST be exported here — the build
# publishes to <SHAPER_REGISTRY>/shaper/brick-*:<SHAPER_IMAGE_TAG>, and the
# deploy step resolves exactly those names (one ladder, V1.13.1).
export SHAPER_IMAGE_TAG=<the tag you are deploying>
bash scripts/build-all-bricks.sh
cd ..

# Images already published at this tag are REUSED, not rebuilt — the script
# asks the registry and skips them — Rule 10's fast clock, chosen for you.
#
# EXCEPT when you are PROVING rather than operating. A clean-sheet TEST
# (Rule 10) or a beta run exists to show the edifice builds from nothing
# (Pillar 1, creation ex nihilo) — and a skipped build shows nothing. There:
#   export SHAPER_FORCE_REBUILD=1
# on a tag the registry has NEVER served. The proof is factual, not a
# stopwatch: tag absent before, present after, digests servable back.

# 4.2b — measure the engine, ONLY possible now: the opencode CLI ships inside
# the bridge image you just built (until V1.13.1 this ordering was written
# nowhere and the .env asked for a measurement no blank machine could make).
podman run --rm --entrypoint opencode \
  "$SHAPER_REGISTRY/shaper/brick-bridge-opencode:$SHAPER_IMAGE_TAG" models
export OPENCODE_MODEL=<the cheapest engine that answered — Rule 7>
# Exports live only in YOUR shell. If your harness opens a fresh shell per
# command (lxc exec does), re-export SHAPER_REGISTRY, SHAPER_IMAGE_TAG and
# OPENCODE_MODEL before any step that uses them — podman-up.sh halts on a
# missing model by design, and the halt names the variable, not this cause.

# 4.3 — create the universe from the templates (never by copying packages)
mkdir -p <univ_slug>-dev/deploy <univ_slug>-dev/tasks
cp manifest.tier-a.json          <univ_slug>-dev/manifest.json
cp examples/universe-AGENT-DEPLOY.md <univ_slug>-dev/AGENT-DEPLOY.md
cp software/universes/_template/deploy/podman-up.sh  <univ_slug>-dev/deploy/podman-up.sh
cp software/universes/univ-base/deploy/proof.sh          <univ_slug>-dev/deploy/proof.sh
cp software/universes/univ-base/deploy/check-image-lock.py <univ_slug>-dev/deploy/check-image-lock.py
cp examples/tasks/task-schedule.json <univ_slug>-dev/tasks/task-schedule.json
cp software/universes/_template/cfg-image-lock.json <univ_slug>-dev/cfg-image-lock.json

# 4.3b — pin what the registry serves (the lock is what TEST and PROD start
# from; a DEV run may skip this and proof.sh will say SKIP, not FAIL):
python3 software/scripts/record-image-lock.py <univ_slug>-dev \
  --registry="$SHAPER_REGISTRY"        # add --insecure if Step 0b said so

# 4.4 — start it, then prove the stack is up. SHAPER_REGISTRY, SHAPER_IMAGE_TAG
# (and SHAPER_TLS_VERIFY if set) must still be exported: the deploy pulls the
# images the build published, with the same TLS posture.
bash <univ_slug>-dev/deploy/podman-up.sh     # health must exit 0

# 4.5 — live tests, only now that the stack is running
cd software && npm run test:live             # tier-a — MUST be green
```

Replace `<univ_slug>` with the slug the human gave you, in every line above. Do
not copy `software/packages/` or any `Containerfile` into the universe
directory — the universe references the bricks, it never contains them.

- **`npm test` is red → STOP.** Show the failing test output unedited. Do not
  modify the test to make it pass. Do not add a stub, a mock, or a fallback.
- **`podman-up.sh` does not exit 0 → STOP.** Show the container logs.
- **`npm run test:live` is red → STOP.** Live tests run *after* the stack is up;
  if you ran them before, that is your error, not a failure of the system.

## Step 4b — Which lifecycle is this? Ask, do not deduce

DEV and TEST look identical while they run and differ completely at the end: a
TEST universe is **destroyed** once it has proved itself (Rule 10), a DEV one is
kept. "A test VPS" describes a machine, not a lifecycle, and a tester read it as
DEV while the operator may have meant TEST — which is why two universes were
still running days later.

If the human has not said which, **ask in one sentence**: *"Is this DEV, which I
keep, or TEST, which I destroy after the proof?"* Then write the answer into the
universe's `INTENT.md` and its manifest `environment`, so that the next agent
does not have to guess what you guessed.

## Step 5 — Public tier (tier-b), only if the human asks for voice or a public URL

1. Confirm tier-a is green first (`npm run test:live`).
2. Open **one vendor site at a time** in the IDE browser:
   - Deepgram → https://console.deepgram.com/ → API Keys
   - Groq → https://console.groq.com/keys
   - Cloudflare tunnel → https://one.dash.cloudflare.com/ → Networks → Tunnels
3. The human pastes the value into `.env`, `software/.env`, or
   `sav/tunnel/token`. Never into the chat, never into Git.
4. Deploy tier-b (`manifest.tier-b.json`, `WITH_HELM=1`), then:

```bash
npm run test:live:helm
# The closed-loop tests of whatever bricks this universe assembles.
# For catalogue bricks they live in the catalogue, beside the brick.
```

- **Any key empty or invalid → STOP and ask.** Never launch tier-b with empty
  keys.

## Step 6 — Prove the work, not the uptime

A green `/api/health` proves the stack is up. It does **not** prove a job ran.

**Submitting the job.** The queue accepts one job type for agent work, and its
shape is declared in [`../../software/packages/pkg-queue/INTENT.md`](../../software/packages/pkg-queue/INTENT.md).
It is written here too, because a tester looked for it in the live tests, did not
find it, and had to read `worker.js` to work it out.

The job asks for **both** halves of the proof — a persisted answer and a file on
disk — because proof 2 below compares an artefact, and a job that was never asked
for one leaves nothing to compare:

```bash
curl -s -X POST "http://127.0.0.1:8640/api/jobs" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "agent.inject",
    "totalSteps": 2,
    "payload": {
      "message": "Write the exact text <a marker you choose>, with no trailing newline, into <an absolute path under this universe>. Then reply with that same exact text.",
      "conversation": "<a session name>",
      "model": "<the engine you measured at deployment>"
    }
  }'
```

Then poll the job until it reaches a terminal state, and read `job.result.answer`
— the persisted answer, not the streamed one:

```bash
# the POST reply carries {"job":{"id":"job-..."}} — poll that id:
curl -s "http://127.0.0.1:8640/api/jobs/<the id>"   # until status is COMPLETED or FAILED
```

For functional proof you need all four:

1. the queue job reached a terminal state and its answer is **persisted**
   (not only streamed over a connection that has since closed);
2. the artefact exists and its bytes are exactly what was asked;
3. the byte comparison used `cmp`, **not** `test "$(cat file)" = value` —
   command substitution removes trailing newlines and will report success on a
   file that is wrong;
4. an audit event in the log correlates with the same queue job id.

Missing any of the four → the work is **not** proven. Say so plainly.

All four are scripted — run them instead of improvising them. What the job was
asked to produce is the one thing the script cannot guess, so you declare it and
the script decides:

```bash
PROOF_ARTIFACT='<the absolute path you named in the job>' \
PROOF_EXPECTED='<the marker you chose>' \
PROOF_ANSWER='<the same marker>' \
bash <univ_slug>-dev/deploy/proof.sh    # exit 0 = proven, and it says why not when not
```

- `PROOF_EXPECTED` is written out with `printf '%s'` and compared with `cmp`, so
  it is byte-exact: a trailing newline is declared as `PROOF_EXPECTED=$'…\n'`.
  For anything longer than a line, put the exact bytes in a file and declare
  `PROOF_EXPECTED_FILE` instead.
- `PROOF_JOB_ID` picks the job to read; without it the script reads the most
  recent one.
- Declaring no artefact is allowed and stays visible: the script prints
  `SKIP artefact` and its closing verdict repeats that proofs 2 and 3 were not
  performed. That run is not a full functional proof — either declare the
  artefact, or do the `cmp` by hand and record its output.

## Step 7 — Report every correction into the repository

For each problem you hit and fixed, in the same commit:

- the fix;
- a non-regression test that **fails on the unpatched code** (if it would pass
  without your fix, it proves nothing — rewrite it);
- if the documented intention was wrong, the corrected `INTENT.md`;
- if it was an operational trap, a line in the deployment steps.

Never close a problem with "it works now".

## Step 8 — Report state honestly

Tell the human, without being asked:

- which files changed;
- whether they are committed, and on which branch;
- whether anything is pushed;
- which changes came from your test runs versus the human's own work.

---

## Absolute stops

Stop immediately and hand back to the human if any of these is true:

| Condition | Why |
| :--- | :--- |
| A required secret is missing or a placeholder | Building on a missing key wastes an hour to save a question |
| Any test is red | Green-by-stub is worse than red |
| The action would touch a production universe | Not your perimeter |
| The action would delete data or a volume you did not create | Irreversible |
| A rule blocks you | Report the blockage; never edit the law to unblock yourself |
| You have retried the same repair 5 times | Mark `DEGRADED`, escalate (Rule 27) |
| The situation is not described in this file | Ask. That is what this line is for. |

---

## Never do these

- Skip `npm test`, `npm run test:live`, or the closed-loop scripts
- Commit `.env`, vault files, tunnel tokens, or `*.enc`
- Put a default API key in a shell script
- Copy `packages/` or a brick `Containerfile` into a universe folder
- Use a production mailbox in DEV or TEST
- Keep a TEST universe alive after it passed
- Summarise or replace `software/RULES.md` with a pointer
