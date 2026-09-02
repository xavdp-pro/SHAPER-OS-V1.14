# proof-rule-11-in-production — the first night the canon ran for real

> Two universes that had been running node and MariaDB **installed directly
> in the LXC** — outside the rule — were rebuilt as two podman bricks each
> (the official MariaDB image plus the application), driven by systemd owned
> by the universe. Nothing outside the LXC changed: the maker, the verifier,
> `checks.json` and the universe's address kept working as before, because
> `--network host` keeps `localhost` valid and the mounted paths
> (`/apps/<app>/etc`, `/etc/shaper`) reproduce the house convention exactly.
> Then one complete birth was measured, in production, through the public
> internet. This proves the rule, not a lab.

Date         : 2026-09-01 (night), operator's correction: "simple mode" already
               meant podman bricks — Rule 11 is the canon from the first
               install, not an option of the assembly phase
Universes    : `univ-demo-crm`, `univ-demo-saas` — rebuilt in place
Governor     : gbs-p2, CT 130, two podman bricks
Maker        : gbs-test, reached through the VPN; the instance is born there
Visitor      : the public internet, a real browser
Source       : the French minutes, `demoproof/REGLE-11-EN-PROD.md` in the
               operator's private tree (not tracked here — it names machines,
               addresses and a public hostname; Boot Contract 10b). This
               document is its lesson, in English, in the generic path
               (Boot Contract 8).

## The measurement

```
magic link      → real Mailjet, read from the real IMAP mailbox
pressure        → sector: commerce
  requested   17:14:15.823
  stamped     17:14:16.300   (477 ms — the maker on gbs-test, through the VPN)
  born        17:14:39.145
  validated   17:14:48.277   (the governor, in a real browser)
public URL      → 200, {"sector":"commerce"}
containers      → exactly two: crm-mariadb, crm-app
```

About 32 s (32.45 s between the recorded timestamps, 17:14:15.823 →
17:14:48.277) from a visitor's click to a validated, publicly served
universe, with the governor on one machine, the maker and the instance on
another, and the visitor outside both. This is an **observation**, never an
engagement (Rule 10), and its conditions are exactly those the minutes
record: a real mailbox (Mailjet, read over IMAP), the maker reached through
the VPN, a real browser for the validation, exactly two containers born. The
state of the image cache, of the matrix and of any data volume were **not
recorded in the minutes** — a later run must not read them into this figure.

## What this run establishes

**The rule holds end to end.** LXC as the universe, podman as the brick,
systemd inside the universe as the only orchestrator, `--network host` so
that nothing outside the LXC learns that the inside changed. Two universes
crossed from "installed directly" to "two bricks" without a single change to
the maker, the governor, or the acceptance spec — which is the whole claim of
Rule 11: containment levels are a boundary the rest of the system does not
have to know about.

**Building it found nine defects.** None was in the rule; all were in the
distance between the rule and a machine. Each is written below with what was
seen, why, the constraint it becomes, and where that constraint now lives —
because a lesson recorded only in the minutes of one night is a lesson the
next universe meets again (Boot Contract 8, Rule 29, Rule 35).

## The nine lessons

<a id="lesson-1-nftables"></a>
### 1 — netavark needs nftables inside the LXC

* **Seen**: the first podman container with a network died with an opaque
  error; nothing in it named nftables or nesting.
* **Cause**: podman's nested network (netavark) programs the firewall through
  nftables, and the Debian LXC did not carry it. Before this night the
  repository had zero occurrences of `nftables`.
* **Constraint**: nftables is part of a universe's first boot, beside podman.
* **Lives in**: [`RULES.md` Rule 11 — *nftables is part of the universe's
  first boot*](../../software/RULES.md#rule-11-nftables-inside-the-universe);
  the runbook's Step 0a install line; `scripts/provision-lxc-univ.sh` and
  `scripts/quick-bootstrap-lxc.sh`; `docs/PREREQUISITES.md` §1. Held by
  `pkg-universe/test/lxc-field-lessons.test.js`, which fails on any
  provisioner or literal install line that omits the package.

<a id="a-wait-loop-tests-a-condition-that-can-become-true"></a>
### 2 — a wait loop must test a condition that can become true

* **Seen**: the MariaDB readiness loop waited its full budget, then went on
  as if the database were ready — before initialisation had actually ended.
* **Cause**: the loop pinged with `-uroot`, and the image ran with
  `MARIADB_RANDOM_ROOT_PASSWORD`: a secret nobody had. The probe could never
  succeed, so the loop was an infinite wait wearing a timeout.
* **Constraint**: a readiness probe uses the credentials the brick will
  actually use. Probing with a secret you do not hold is not waiting, it is
  sleeping with a deadline; and a loop that "fell through" its budget has
  measured nothing. This is a general constraint, not one of Rule 11 (it
  belongs with Rule 0G: a probe that cannot pass is a fake), so it is not
  written into the rule — it lives here and in the runbook.
* **Lives in**: this document; the runbook's trap at Step 4.4.

<a id="lesson-3-the-client-is-mariadb"></a>
### 3 — the client is `mariadb`, not `mysql`

* **Seen**: two calls in the same file disagreed on the client's name; the
  file was corrected twice before both agreed.
* **Cause**: the official MariaDB image ships `mariadb` and `mariadb-dump`;
  `mysql` and `mysqldump` are compatibility names that a minimal image may
  not provide.
* **Constraint**: name the client the image ships; fall back to `mysqldump`
  only where that name exists.
* **Lives in**: [`RULES.md` Rule 16, level 3](../../software/RULES.md#rule-16)
  now prescribes `mariadb-dump` with `mysqldump` as the fallback;
  `scripts/snapshot-universe.sh` already chose that order.

<a id="lesson-4-lxc-info-lists-no-profile"></a>
### 4 — `lxc info` does not list profiles

* **Seen**: an idempotence check "passed" every run, and the next run tried
  to add a profile already present (`Duplicate profile found`).
* **Cause**: the check grepped the profile's name in `lxc info`, which never
  prints profiles. A condition that can never be true is not a check.
* **Constraint**: read what is applied from `lxc config show <ct>` (or
  `lxc profile show`); on Proxmox, `pct config <vmid>`.
* **Lives in**: [`RULES.md` Rule 11 — *A profile is read from the applied
  configuration*](../../software/RULES.md#rule-11-read-profiles-with-config-show);
  the runbook's Step 0a trap; `docs/PREREQUISITES.md` §1; the two Proxmox
  provisioners read the feature back through `pct config`; the maker's
  `lxd-stamp.sh` says in place why its `lxc info` asks existence only. Held by
  `lxc-field-lessons.test.js`: no shipped script or literal document reads a
  profile through `lxc info`.

<a id="lesson-5-nesting-needs-a-restart"></a>
### 5 — nesting does not apply to a running container

* **Seen**: a profile added to a launched LXC did not give it nesting; a
  restart was needed before the rights applied (the minutes record no error
  text — the symptom to expect is the one the LXC guide documents for no
  nesting at all, `Permission denied` on the first image).
* **Cause**: `security.nesting` (and `pct --features`) is read at container
  start. Set on a running container, it waits for the next restart, and the
  symptom is indistinguishable from the feature being absent.
* **Constraint**: a script that sets nesting on an existing container
  restarts it in the same breath; a profile is given at launch whenever it
  can be.
* **Lives in**: [`RULES.md` Rule 11 — *Nesting does not apply to a running
  container*](../../software/RULES.md#rule-11-nesting-needs-a-restart) (the
  LXC guide `software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md` already showed the
  restart; the rule did not say it); the runbook's Step 0a trap;
  `lxd-stamp.sh` launches with the profile and never `config set`s a launched
  instance. Held by `lxc-field-lessons.test.js`: every `lxc config set …
  security.nesting` / `pct set … nesting=1` in a shipped script or literal
  document is followed by the restart.

<a id="environment-differences-are-declared-not-inferred"></a>
### 6 — dev=prod convergence closed the magic link's echo mode

* **Seen**: the day the dev deployment started declaring `NODE_ENV=production`
  honestly (same artefact as prod), the echo mode of magic links — the
  guard that lets a developer read the link without a mailbox — shut on dev
  too.
* **Cause**: the guard used `NODE_ENV !== 'production'` as its safety. That
  inferred a *permission* from a *build posture*; when the posture converged,
  the permission vanished as a side effect.
* **Constraint**: a behaviour that differs by environment is a value
  **declared** per environment — in the manifest or the env file — never an
  inference from another variable and never a side effect of converging the
  code. Corrected on terrain with an independent flag (`SHAPER_ALLOW_ECHO`)
  that only the dev deploy writes; prod never writes it, and that omission is
  the real safety property `NODE_ENV` was standing in for. A general
  constraint (it belongs with Rule 0J's env contract and the manifest's
  `environment` field), so it is not written into Rule 11 — it lives here and
  in the runbook.
* **Lives in**: this document; the runbook's trap at Step 4.0.

<a id="a-variables-file-holds-only-variables"></a>
### 7 — a variables file holds only variables

* **Seen**: a human note slipped into `tokens.env` the evening before
  (`BACKOFFICE_ADMIN = email / password`) made a deploy die silently — the
  script did not even print its own failure message.
* **Cause**: the file is loaded with `set -a; source "$ENV_FILE"; set +a`, so
  every line that is not blank, a comment, or `KEY=value` is a command bash
  executes. The note ran as a command and killed the shell. The preflight
  gate did have a key filter — `^[A-Z_]+=` — but a filter that *drops* what
  it does not understand hides the note, and that pattern also dropped every
  honest key with a digit in its name (`R2_BUCKET_NAME`).
* **Constraint**: an environment file admits exactly three kinds of line —
  blank, `#` comment, `KEY=value` with `KEY` matching `[A-Z][A-Z0-9_]*` and
  a value bash exports **as written**: a double-quoted string without `$(…)`
  or backticks, a single-quoted string, or a bare word carrying no whitespace
  and no shell operator (`; & | ( ) < >`, quotes). The value matters as much
  as the key: the first version of the guard admitted any `KEY=value`, and
  its review showed that `KEY=1; echo INJECTED` passed and was then run by
  `source` — the note was caught, a hostile or careless value was not. Any
  other line is a halt that quotes the line and its number. A note for a
  human goes behind `#`. This concerns the env contract (Rule 0J) more than
  containment, so it is written here rather than in Rule 11; the mechanical
  guards name this anchor.
* **Lives in**: `scripts/lib/preflight-checks.mjs` (`parseEnvFile`) and
  `scripts/preflight.mjs` §4, which halt on the first non-variable line; the
  template `universes/_template/deploy/podman-up.sh`, which runs the same
  grammar in bash before every `source`; the runbook's trap at Step 4.1;
  `docs/PREREQUISITES.md` §4. Held by
  `pkg-universe/test/preflight-env-and-ports.test.js`, which feeds both the
  gate and the template the exact line seen on terrain.

<a id="lesson-8-a-declared-port-is-a-claim"></a>
### 8 — a port already held is invisible from everywhere except the brick's journal

* **Seen**: the production CT, born before Rule 11, still ran its
  apt-installed MariaDB on 3306. The podman brick crash-looped; nothing
  outside `podman logs` of the brick itself said why.
* **Cause**: with `--network host` a brick binds the universe's own ports; a
  service the universe already runs holds them first. No gate anywhere
  compared what the manifest declares with what already listens.
* **Constraint**: before a deploy, every port the manifest declares is
  checked against the listening sockets (`ss -ltn`, or `/proc/net/tcp`), and
  a held port is a halt that names the port, the brick and — when visible —
  the process. The holder is stopped and disabled by the human; a universe is
  never worked around with a second port. One holder is not a defect: the
  universe's **own** brick, left running by a previous `podman-up.sh`, which
  the deploy `--replace`s by design. The first version of the gate could not
  tell it from a foreign one (with `--network host`, `ss -p` shows the
  brick's own `node` exactly like the CT's old `mariadbd`) and halted on the
  second deploy of every stack; the running containers, read from
  `podman ps`, are the witness that separates the two cases.
* **Lives in**: [`RULES.md` Rule 11 — *A declared port is a claim on the
  whole universe*](../../software/RULES.md#rule-11-declared-ports-are-free);
  `scripts/preflight.mjs` §5 (`--universe <dir>`, or `SHAPER_UNIVERSE_DIR`)
  with `portsInUse`, `portsInUseFromProc`, `manifestPorts` and `collisions`
  in `scripts/lib/preflight-checks.mjs`; the runbook's trap at Step 4.4. Held
  by `preflight-env-and-ports.test.js`, which holds a port from the test
  process and proves the gate names it.

<a id="lesson-9-recreating-a-dev-universe-erases-its-registry"></a>
### 9 — recreating a dev universe erases its registry, and nothing re-enrols by itself

* **Seen**: after the dev universe was recreated, the maker that pointed at
  it had lost its enrolment and had to be enrolled again; the public door
  that pointed at the old address had to be updated by hand. Neither repaired
  itself.
* **Cause**: the registry lives inside the universe that was destroyed; the
  enrolment and the public route are state held by *other* organs, and
  nothing tells them the universe was reborn at a new address.
* **Constraint**: a universe that is recreated announces its rebirth, and
  the organs that depend on it (maker enrolment, public route) either
  re-enrol from that announcement or halt loudly naming what must be redone.
  Not yet mechanical — declared here as an open gesture, so that it is not
  forgotten (Genesis: *what V1.13 does not do*).
* **Lives in**: this document only, for now.

### And the lesson of the same night that was already in the tree

**A newborn is given time to open its eyes.** The first autonomous
validation ran 500 ms after the stamp and judged a connection the child had
not yet offered. The maker's `lxd-validate.sh` now waits, bounded by a
declared budget, for the child's *first* answer before judging any of its
promises (commit *"fix(maker): a newborn is given time to open its eyes"*,
with two recipe-level tests that fail on the unpatched recipe). Nothing to
redo; it is referenced here because the birth measured above is the one it
made possible.

## What is mechanical, and what is not

| Lesson | Rule anchor | Runbook trap | Mechanical guard |
| :--- | :--- | :--- | :--- |
| 1 nftables | Rule 11 | Step 0a | `lxc-field-lessons.test.js` |
| 2 wait loops | — (general, here) | Step 4.4 | — |
| 3 mariadb-dump | Rule 16 level 3 | — | — |
| 4 config show | Rule 11 | Step 0a | `lxc-field-lessons.test.js` |
| 5 restart after nesting | Rule 11 | Step 0a | `lxc-field-lessons.test.js` |
| 6 declared per environment | — (general, here) | Step 4.0 | — |
| 7 variables only | — (general, here) | Step 4.1 | `preflight-env-and-ports.test.js`, gate and template |
| 8 declared ports are free | Rule 11 | Step 4.4 | `preflight-env-and-ports.test.js`, gate |
| 9 rebirth re-enrols | — (open) | — | — |

Three lessons hold by reading only. That is stated, not hidden: a table that
shows every row as green would be the kind of claim Rule 0G forbids.
