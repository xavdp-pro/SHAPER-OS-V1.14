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

## Step 0a — The terrain: you deploy inside a universe container, not on the host

Rule 11: **the universe is a system container — an LXC, or a `nested` Podman
container — and podman is the brick.** This runbook walks the `lxc` shape; the
`nested` shape has no runbook in this tree — its only terrain is the vzcriu
kit, and PodMesh, optional, has not stamped one. Never deploy a universe
directly on a host that carries production. Create the container first:

```bash
# Debian/Ubuntu host with LXD. The `< /dev/null` is not decoration: over a
# piped SSH session lxc launch waits on stdin forever without it.
lxc launch images:debian/13 <univ_slug> --profile podman-univ < /dev/null
lxc exec <univ_slug> -- apt-get update
lxc exec <univ_slug> -- apt-get install -y podman nftables iproute2 git curl jq nodejs npm openssl python3
lxc exec <univ_slug> -- systemctl enable podman-restart.service
```

`podman-restart.service` brings the units (`--restart=always`) back when the
universe container restarts; without it a reboot leaves the universe down and
every health check silent.

On a **Proxmox** host it is `pct create` with `features: nesting=1,keyctl=1`
instead — the `lxc`-shape families, with the full package list and the profile
definition, are in
[`../../software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md`](../../software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md).
Nesting is mandatory; without it podman fails on the first image with a
`Permission denied` that says nothing about nesting.

- **Trap — on a Proxmox UNPRIVILEGED container, pass `/dev/net/tun` too.**
  `pct set <id> --dev0 /dev/net/tun,mode=0666`, then `pct reboot <id>`. Without
  it every `RUN` step of a `podman build` fails inside the container (`pasta …
  /dev/net/tun: No such file or directory`), while `podman run` of a prebuilt
  image works — a container that only runs images looks fit and is not
  ([univ-minimal — what the universe container must provide](../../software/universes/univ-minimal/INTENT.md#host)).

- **The host has neither Proxmox nor LXD → STOP and ask.** Installing a
  hypervisor is an architecture decision, not a package install (Rule 11).

- **Trap — nftables is not optional inside the LXC.** Podman's nested
  network dies with an opaque error without it; the install line above names
  it on purpose ([Rule 11 — nftables](../../software/RULES.md#rule-11-nftables-inside-the-universe)).
- **Trap — verify the profile with `lxc config show`, never `lxc info`.**
  `lxc info` lists no profile; a check built on it passes every time. Run
  `lxc config show <univ_slug> | grep -A2 '^profiles:'` and expect
  `podman-univ` ([Rule 11 — read profiles](../../software/RULES.md#rule-11-read-profiles-with-config-show)).
- **Trap — nesting set on a running container needs a restart.** If you
  `lxc config set <univ_slug> security.nesting=true` (or add the profile)
  after launch, run `lxc restart <univ_slug>` in the same breath — the
  symptom without it is identical to no nesting at all
  ([Rule 11 — restart](../../software/RULES.md#rule-11-nesting-needs-a-restart)).

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

   - **Exit 0 → start.** It prints `SKIP ports` at this point, and that is
     right: no universe exists yet; the universe's own preflight checks its
     ports at Step 4.4.
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

## Step 1 — Read these five files, in this order

1. [`LAW.md`](../../LAW.md)
2. [`./BOOT-CONTRACT.md`](./BOOT-CONTRACT.md)
3. [`docs/human/START-HERE.md`](../human/START-HERE.md)
4. [`docs/human/KEYS-AND-ACCOUNTS.md`](../human/KEYS-AND-ACCOUNTS.md)
5. [`software/universes/_template/INTENT.md`](../../software/universes/_template/INTENT.md),
   then its [`AGENT-DEPLOY.md`](../../software/universes/_template/AGENT-DEPLOY.md):
   the shape every new universe starts from, and the four base units of
   [`univ-minimal`](../../software/universes/univ-minimal/INTENT.md) it stands on

Then `software/RULES.md` in full. Do not summarise it for yourself and do not
skip sections because they look unrelated.

**If the canon does not fit in your context**, do not skim it and do not pretend
you read it. Say this to the human, in these terms: *"I cannot hold
`software/RULES.md` in full. I will work strictly inside this runbook and stop at
anything it does not cover."* Then do exactly that. An agent that declares its
limit is safe; an agent that hides it will break a rule it never read.

## Step 2 — The universe's secrets: the base generates them, you never do

A universe derived from the template needs **no secret from you**. Its base
units generate their own, at birth, inside the universe container:

- Vault's master key, `/apps/vault/etc/vault/master.key` (`0400`), and the
  universe identity beside it — generated once, when Vault is born, never again;
- the Vault API token beside them, root-only;
- each unit's MariaDB password, `/apps/<slug>/etc/mysql/localhost/passwd`
  (`0600`, owned by the unit's account), generated once with its database.

Do **not** run `openssl rand` for any of them, do not copy one in from another
machine, and never write a secret into a chat message, a commit, a shell script
or a log line. `software/.env` and `software/resources/vault-resources.local.json`
are not read by a template universe: they serve package runs on a workstation
(`npm run vault:bootstrap`) and the earlier shape
([`univ-base`](../../software/universes/univ-base/AGENT-DEPLOY.md)), not this
path.

*(Until the base release, 11 October 2026, this step generated
`VAULT_MASTER_KEY` and `VAULT_TOKEN` by hand for a vault that stored its secrets
in a file. That vault is gone from the template; so is the step.)*

## Step 3 — Verify every vendor key BEFORE building anything

The four base units call no vendor: for the base alone, there is nothing to
verify — go to Step 4. A unit the universe adds may need a vendor key (tier-b:
voice, a public URL — Step 5). For that unit, every key its `INTENT.md` names
must be present, non-empty, and not a placeholder such as `changeme`, `xxx`, or
`your-key-here`.

- **A key is missing or is a placeholder → STOP.** Name the exact key, give the
  vendor console URL from [`docs/human/KEYS-AND-ACCOUNTS.md`](../human/KEYS-AND-ACCOUNTS.md),
  and wait for the human. Do not build. Do not launch. Do not "start without it
  and add it later".

## Step 4 — The DEV pipeline, in this exact order

Do not reorder. Do not skip. Each command must succeed before the next one runs.
Every command below runs **inside the universe container** (Step 0a), as root.

**First, get the universe slug from the human.** Do not invent it, and **do not
derive it from something else you were given**: a container name, a host name or
a ticket number is not a slug, and a tester who assumed the two were the same
said afterwards that he should have asked. It is lowercase, letters, digits and
hyphens only, and it begins with `univ-` (Rule 1) — `univ-shop-dev`, not
`shop`: the base's scripts refuse any other shape before they start anything.

**Where the universe directory goes.** Outside the repository, at
`/apps/<univ_slug>/` — one concrete example: repository at
`/root/SHAPER-OS-V1.14`, universe at `/apps/univ-shop-dev/`. This repository is
generic and publishes what it contains; a universe carries its own settings,
its own image lock and, under `base/`, the base units installed from one
revision of this repository. The template refuses to run in place
(`software/universes/_template/` itself is a mold, never a universe).

**One universe per universe container.** Each base unit's Turbinobash layout is
`/apps/<slug>/` of the container — `/apps/vault/`, `/apps/logger/`,
`/apps/queue/`, `/apps/maestro/` — so a second universe in the same container
would meet the first one's databases. A second universe gets its own container
(Step 0a).

**Write the universe's INTENT before you build anything.** Principle 1 is
*intent precedes form*, and it is broken by habit: a tester created the container
first and used the human's request as an implicit intention. Copy the template,
state in its `INTENT.md` what this universe is for and its invariants, and only
then run the build.

**The functional Podmans are the four base units, and their identities are
born with them.** Vault, Logger, Queue and Maestro: each one container holding
its application and its own MariaDB server (Rules 4 and 26, the Turbinobash
method). For each, one `<functional-slug>` is the function, the Linux account
(fixed uid, home `/apps/<slug>`), the MariaDB account and the database —
`vault`, `logger`, `queue`, `maestro`. Their password files, grants, schema and
sockets are made by the unit image itself at every start; you write none of
them, and `deploy/proof.sh` (Step 6) checks every one of them from outside.
The template declares these four and nothing else: a manifest that declares a
fifth unit is refused until that unit's start and proof are added to the
universe's `deploy/podman-up.sh` and `deploy/proof.sh`
([why](../../software/universes/_template/INTENT.md#materialise)). A unit
without its own MariaDB inside its own container, a shared database, or a
SQLite/CSV/JSONL store means **STOP**: it has not been born under Rules 4 and 26.

**Do not administer MariaDB as the application.** The application process runs
as `<functional-slug>` and connects only to the database of the same name,
through its private socket. For inspection and repair, the authorised agent
uses the local MariaDB `root` command-line path inside the unit's container
(`podman exec <univ_slug>-ctr-<slug> mariadb --no-defaults -S /run/<slug>/mysqld.sock -uroot <slug>`
— root authenticates by `unix_socket` only). Do not log in with the application's
user and password to perform administrative work, and never expose root to the
application. Root database privileges remain bounded by the operation and
universe mandate.

- **Trap — a behaviour that differs by environment is a declared value.**
  Write it in the manifest or the settings file (`environment`, an explicit
  flag), never as an inference from another variable such as `NODE_ENV`: the
  day dev and prod converged on the same artefact, a guard inferred from
  `NODE_ENV` shut on dev too ([proof, lesson 6](../proof/proof-rule-11-in-production.md#environment-differences-are-declared-not-inferred)).

```bash
# 4.0 — the intention, first: the universe is a copy of the template, outside the repository
cp -r software/universes/_template /apps/<univ_slug>
# then edit, in /apps/<univ_slug>/:
#   INTENT.md            what this universe is for, its invariants — no placeholder left
#   manifest.json        "universe": "<univ_slug>", "environment" (Step 4b), each "role";
#                        the four units' image, port and database stay exactly as they are
#   context/ctx-universe.md
# A template left with its placeholders is an unfinished universe.

# 4.1 — build and verify the software (from the repository root)
cd software
npm test                              # packages only — MUST be green

# The registry and tag from Step 0b MUST be exported here — the build
# publishes to <SHAPER_REGISTRY>/shaper/brick-*:<SHAPER_IMAGE_TAG>, and the
# universe resolves exactly those names. The tag is NEW: a published tag is
# never moved (a lock somewhere names its digests).
export SHAPER_IMAGE_TAG=<a tag this registry has never served>
bash scripts/build-all-bricks.sh
cd ..

# Images already published at this tag are REUSED, not rebuilt — the script
# asks the registry first and skips them — Rule 10's fast clock, chosen for you.
#
# EXCEPT when you are PROVING rather than operating. A clean-sheet TEST
# (Rule 10) or a beta run exists to show the edifice builds from nothing
# (Pillar 1, creation ex nihilo) — and a skipped build shows nothing. There:
#   export SHAPER_FORCE_REBUILD=1
# on a tag the registry has NEVER served. The script halts, before building
# anything, when the registry already serves the tag, or when it cannot tell
# (any answer but 200 or 404): it never pushes over a published tag. The proof
# is factual, not a stopwatch: tag absent before, present after, digests
# servable back.
#
# On a Proxmox UNPRIVILEGED container, the build needs /dev/net/tun passed to
# the container (Step 0a): without it every RUN step fails with
# `pasta … /dev/net/tun: No such file or directory`.

# 4.2 — install the base units: univ-minimal at one revision of this repository
bash /apps/<univ_slug>/deploy/install-base.sh \
  --shaper-repo "$PWD" --shaper-commit "$(git rev-parse HEAD)"
# It refuses a revision that does not contain the qualified base release, and
# a universe directory of the earlier template's shape. It starts nothing.

# 4.3 — the universe's one settings file (variables only; never committed)
cp /apps/<univ_slug>/cfg-universe.env.example /apps/<univ_slug>/cfg-universe.env
# edit it: SHAPER_UNIVERSE=<univ_slug> (the manifest's "universe", the same name);
# for DEV, SHAPER_REGISTRY and SHAPER_IMAGE_TAG = what 4.1 published.
# Trap — a variables file holds ONLY variables: blank lines, # comments and
# KEY=value (keys may carry digits; the value quoted, or a bare word with no
# whitespace and no shell operator). The deploy scripts `source` it, so any
# other line would be EXECUTED by bash: a human note (`BACKOFFICE_ADMIN = email /
# password`) killed a deploy before it could print its own halt, and a value
# such as `KEY=1; echo INJECTED` runs its tail. deploy/podman-up.sh reads the
# file first, stops on such a line and quotes it; a note goes behind #.
# (docs/proof/proof-rule-11-in-production.md#a-variables-file-holds-only-variables)

# 4.3b — pin what the registry serves (the lock is what TEST and PROD start
# from; a DEV universe may run from the tag named in cfg-universe.env):
python3 software/scripts/record-image-lock.py /apps/<univ_slug> \
  --registry="$SHAPER_REGISTRY"        # add --insecure if Step 0b said so

# 4.4 — preflight: what a run would keep or recreate. Changes nothing.
bash /apps/<univ_slug>/deploy/podman-up.sh --preflight
# Trap — the ports the manifest declares must be FREE in this container. Units
# run on the host network of the universe container; a service it already runs
# (an apt-installed MariaDB in a CT born before Rule 11) holds the port first.
# The preflight names the port and its holder; stop and disable the holder,
# never pick a second port (software/RULES.md#rule-11-declared-ports-are-free).
# A port held by this universe's OWN unit (<univ_slug>-ctr-vault, …) from a
# previous run is not a collision: the run keeps that unit.

# 4.5 — the birth, in bootOrder: Vault alone first, then Logger, Queue, Maestro
bash /apps/<univ_slug>/deploy/podman-up.sh
# Re-running it keeps every unit that runs as declared, with its identity;
# `--recreate <slug>|proof|all` is a decision, not a retry.

# 4.6 — the parent's daily bootstrap renewal, once
bash /apps/<univ_slug>/deploy/base.sh install-renewal-timer.sh

# 4.7 — the smoke test, only now that the units are running
node --test /apps/<univ_slug>/test/socle-live.test.js   # MUST be green — it is not the proof
```

Replace `<univ_slug>` with the slug the human gave you, in every line above. Do
not copy `software/packages/`, any `Containerfile` or univ-minimal's scripts
into the universe directory — the universe references the base, at one
revision, under `base/`, and never edits it. Run the base's scripts through the
universe's `deploy/podman-up.sh`, `deploy/proof.sh` and `deploy/base.sh`, never
from `base/deploy/` directly: that path skips the settings check.

- **`npm test` is red → STOP.** Show the failing test output unedited. Do not
  modify the test to make it pass. Do not add a stub, a mock, or a fallback.
- **`build-all-bricks.sh` halts on a published tag → STOP** and ask the human for
  a new tag. Never delete the tag from the registry, never move it.
- **`install-base.sh`, the preflight or `podman-up.sh` does not exit 0 → STOP.**
  Show its halt, unedited, and the logs of the unit it names
  (`podman logs <univ_slug>-ctr-<slug>`).
- **The smoke test is red → STOP.** It runs *after* the units are up; if you
  ran it before, that is your error, not a failure of the system.

## Step 4b — Which lifecycle is this? Ask, do not deduce

DEV and TEST look identical while they run and differ completely at the end: a
TEST universe is **destroyed** once it has proved itself (Rule 10), a DEV one is
kept. "A test VPS" describes a machine, not a lifecycle, and a tester read it as
DEV while the operator may have meant TEST — which is why two universes were
still running days later.

If the human has not said which, **ask in one sentence**: *"Is this DEV, which I
keep, or TEST, which I destroy after the proof?"* Then write the answer into the
universe's `INTENT.md` and its manifest `environment`, so that the next agent
does not have to guess what you guessed. A TEST or PROD universe starts from
the image lock (4.3b), never from a tag.

## Step 5 — Public tier (tier-b), only if the human asks for voice or a public URL

1. Confirm the base is proven first (Step 6).
2. Open **one vendor site at a time** in the IDE browser:
   - Deepgram → https://console.deepgram.com/ → API Keys
   - Groq → https://console.groq.com/keys
   - Cloudflare tunnel → https://one.dash.cloudflare.com/ → Networks → Tunnels
3. The human pastes the value where the unit that needs it reads it — that
   unit's own settings, or Vault through its administrative API. Never into the
   chat, never into Git.
4. Tier-b units come from the
   [`SHAPER-OS-BRICKS`](https://github.com/xavdp-pro/SHAPER-OS-BRICKS-V1.14) (a private repository)
   catalogue; this repository ships no tier-b manifest and no switch that
   turns the cockpit on. A catalogue unit joins this universe only once it is
   one functional Podman holding its application and its own MariaDB server,
   its start added to `deploy/podman-up.sh` after the base layers and its proof
   to `deploy/proof.sh` (Rules 4 and 26) — then run the closed-loop tests of
   whatever units this universe assembles. For catalogue bricks (`brick-helm`
   among them) they live in the catalogue, beside the brick; the smoke test
   here covers the base units only.

- **Any key empty or invalid → STOP and ask.** Never launch tier-b with empty
  keys.

## Step 6 — Prove the work, not the uptime

A green `/api/health` proves a process is up. It does **not** prove that work
happened, that a unit's database is its own, or that it survives a restart.

The proof is scripted, and it is three runs, in this order:

```bash
bash /apps/<univ_slug>/deploy/proof.sh                       # exit 0 = proven, and it says why not when not
bash /apps/<univ_slug>/deploy/base.sh lifecycle-drill.sh      # restart, re-run, recreation: nothing lost
bash /apps/<univ_slug>/deploy/base.sh restore-drill.sh        # each unit's dump restored into fresh volumes
```

`deploy/proof.sh` exits 0 only when every unit passes the Rule 26 inventory and
proves one real effect read back from its own database
([what it checks](../../software/universes/univ-minimal/INTENT.md#proof)):

1. the unit's application and its MariaDB server run in the same container,
   the application as its own uid, MariaDB as its engine uid, nothing the
   supervisor started as root; MariaDB on its private socket, no TCP listener;
2. exactly the unit's account with DML-only grants on its own database, root by
   `unix_socket` alone, the exact schema version, the password file `0600`
   owned by the unit's account; DDL, the system database and another unit's
   credential refused; the data, socket, password and administrative paths not
   writable by the unit's uid;
3. the unit's identity: its current incarnation live in Vault, exactly its
   declared grants, the pin equal to the parent's derivation, the bootstrap a
   `0600` file and never a value in its environment;
4. one real effect per unit — a secret written and read back with `SECRET_READ`
   evidence; Queue jobs claimed, run under one attempt, receipted; a Maestro
   occurrence reaching Queue under Maestro's own credential; anonymous calls
   refused (401) — each read back **from the databases**, never from the
   unit's own answer, and the evidence found held by Logger under the unit's
   name.

The drills add what one run cannot show: every marker, row count and password
file unchanged after a restart, a re-run and a recreation, MariaDB stopped after
the application and never in crash recovery; and each unit's dump restored into
fresh volumes, compared with the live tables and served back by the unit's own
application.

Missing any of the three → the universe is **not** proven. Say so plainly, with
the output. Paste the three outputs into your report, with the revision in
`base/.shaper-revision` and the commit you built from.

Where podman cannot run (a workstation), `software/universes/_template/test/rehearsal.live.mjs`
rehearses the same scripts with each unit's server as a process: it proves
nothing about the container shape and never qualifies a universe. Say which of
the two you ran.

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
| A required vendor key is missing or a placeholder | Building on a missing key wastes an hour to save a question |
| The registry already serves the tag you were about to build | A published tag is never moved: a lock somewhere names its digests |
| Any test is red | Green-by-stub is worse than red |
| The action would touch a production universe | Not your perimeter |
| The action would delete data or a volume you did not create | Irreversible |
| A rule blocks you | Report the blockage; never edit the law to unblock yourself |
| You have retried the same repair 5 times | Mark `DEGRADED`, escalate (Rule 27) |
| The situation is not described in this file | Ask. That is what this line is for. |

---

## Never do these

- Skip `npm test`, the smoke test, `deploy/proof.sh` or the two drills
- Commit `.env`, `cfg-universe.env`, a master key, a password file, tunnel tokens, or `*.enc`
- Generate, copy or print a secret the base units generate themselves
- Put a default API key in a shell script
- Copy `packages/`, a brick `Containerfile` or univ-minimal's scripts into a universe folder, or edit its `base/`
- Push over a tag the registry already serves, or set `SHAPER_FORCE_REBUILD=1` on one
- Use a production mailbox in DEV or TEST
- Keep a TEST universe alive after it passed
- Summarise or replace `software/RULES.md` with a pointer
