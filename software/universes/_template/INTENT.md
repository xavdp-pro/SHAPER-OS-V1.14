# Universe: univX — Template

> **Intent Classification**: SPECIFIC INTENT (Universe: univX)

## 1. Declarative Objective

<One sentence: what this universe demonstrates or runs in production.>

## 2. Invariants

1. <Security or sovereignty rule>
2. <Cadence / logging rule>
3. <Secret handling rule>
4. <Test / PRA rule>
5. Every functional unit is one Podman holding its application and its own
   MariaDB server — one account, one MariaDB account, one database, all named
   by the unit's slug; a private socket, no TCP; readiness gated on the
   database (Rules 4 and 26, the Turbinobash method). No JSON, JSONL or SQLite
   store serves, and no unit reads another unit's database.
6. The base units are univ-minimal's at one recorded revision
   (`base/.shaper-revision`), never a copy of its scripts; their images are
   pinned by digest (TEST, PROD) or named by an explicit published tag (DEV),
   and a published tag is never moved.

<a id="base-units"></a>
## 3. The base units

A universe derived from this template stands on the four base units of
[`univ-minimal`](../univ-minimal/INTENT.md), qualified on a real podman host on
11 October 2026 (revision `e83f731`; kit proof 82/82, lifecycle drill 78/0,
restore drill 33/0):

| Unit | Container | Account = MariaDB account = database | Port |
| :--- | :--- | :--- | :--- |
| Vault | `<universe>-ctr-vault` | `vault` (10610), engine `mysql` (10611) | 8610 |
| Logger | `<universe>-ctr-logger` | `logger` (10620), engine `mysql` (10621) | 8620 |
| Queue | `<universe>-ctr-queue` | `queue` (10640), engine `mysql` (10641) | 8640 |
| Maestro | `<universe>-ctr-maestro` | `maestro` (10630), engine `mysql` (10631) | 8630 |

They are not copied here. `deploy/install-base.sh --shaper-repo <checkout>
--shaper-commit <revision>` takes univ-minimal from a SHAPER OS checkout with
`git archive` into `base/`, records the revision in `base/.shaper-revision`,
and links the base's schedule, image lock and settings to the universe's own
(`tasks/task-schedule.json`, `cfg-image-lock.json`, `cfg-universe.env`). It
refuses a revision that does not contain the qualified release, or whose
univ-minimal is not the four one-container units, and it keeps a previous
`base/` beside the new one. It writes no volume and starts nothing.

What the base brings, at that revision, and what this template therefore
never re-implements:

- **Birth order** — Vault alone first; the pin of Vault's public key, derived by
  the parent from the master key and the universe UUID; then Logger, Queue and
  Maestro, layer by layer, each gated on its own MariaDB.
- **Identities** — a lowercase UUID per universe, generated once beside the
  Vault master key; a new random incarnation for each unit actually recreated,
  registered by root through Vault's socket by digest, never by value; an
  owner-only bootstrap file per unit; credentials Vault signs on every route of
  Logger, Queue and Maestro but a minimal health; durable Queue attempts.
- **Renewal** — the parent's daily bootstrap renewal, installed once with
  `deploy/base.sh install-renewal-timer.sh` (its service names the universe's
  settings file).
- **Proof and drills** — `base/deploy/proof.sh` (the Rule 26 inventory of every
  unit and one real effect each), run by `deploy/proof.sh`;
  `lifecycle-drill.sh` and `restore-drill.sh`, run by `deploy/base.sh`.

The base's scripts source their settings file without the variables-only
guard, so the universe runs each of them through `deploy/podman-up.sh`,
`deploy/proof.sh` or `deploy/base.sh`, which check the file first and hand it
over in `ENV_FILE`; `base/cfg-univ-minimal.env` links to `cfg-universe.env` only
so that a base script run on its own still reads this universe, never
univ-minimal's defaults.

The manifest declares the four units exactly as the installed base births them
(image, port, database), in the base's boot order, and nothing else;
`deploy/podman-up.sh`, `deploy/proof.sh` and `deploy/base.sh` refuse a manifest
that disagrees with `base/`.

<a id="materialise"></a>
## 4. Materialise

`deploy/podman-up.sh`, inside the universe container: it reads
`cfg-universe.env` (variables only; `SHAPER_UNIVERSE` is the manifest's
`universe`), refuses the earlier template's shape and a `base/` that is missing
or not linked to the universe's own schedule and lock, then runs
`base/deploy/podman-up.sh` with the same arguments (`--preflight`,
`--recreate <slug>|proof|all`) and the same settings file.

The template starts no unit of its own, and it refuses a manifest that
declares one: a unit accepted there would never be started nor proved. A
universe that adds units — each one functional Podman holding its application
and its own MariaDB server, after the base layers — first adds their start to
`deploy/podman-up.sh`, their proof to `deploy/proof.sh` and their declaration
to the checks of `deploy/lib.sh`, as the seven-unit Clinic kit does for its
own.

Maestro holds the universe's declared schedule, `tasks/task-schedule.json`; the
template declares none, so Maestro is present and submits nothing. Queue does
not dispatch to any engine: a cognition adapter is a unit of its own, and it
joins a universe only once it meets Rules 4 and 26 like the others.

<a id="proof"></a>
## 5. Proof

`deploy/proof.sh` runs `base/deploy/proof.sh` and keeps its verdict; it exits 0
only when every unit passed. A green health endpoint is not in it as a proof.
`test/socle-live.test.js` (`node --test test/socle-live.test.js` in the
universe directory; `npm run test:live` from this repository's `software/`) checks
from outside that each base unit answers a minimal health and refuses an
anonymous read or write (401) — a smoke test after a start, never the proof.

`test/rehearsal.live.mjs` rehearses the template where podman cannot run: a
copy of it, `base/` installed from this repository, then `deploy/podman-up.sh`
with univ-minimal's rehearsal podman (each unit's real server as a process, one
throwaway MariaDB), the smoke test against the running units, and a re-run that
keeps them. It shows the universe's own name, settings, schedule and lock
reaching the base's birth order and identities; it shows nothing about the
container shape and never qualifies a universe.

<a id="earlier-template"></a>
## 6. The earlier template

Until the base release (11 October 2026) this template started five bricks with
file stores (`sav/vault/vault.enc`, `sav/queue/jobs.jsonl`), an OpenCode bridge
fed by Queue and Maestro without credentials, and optional Cursor and Antigravity
bridges, from a `podman-up.sh` each universe copied. A universe made that way
keeps the script it copied and the images it pinned: nothing here changes them,
and no published image is re-tagged. `deploy/install-base.sh` and
`deploy/podman-up.sh` refuse such a universe directory (its file stores, its
`<universe>-vault` containers): moving it to the one-container units is a
migration — export its data, birth the units, import, prove — and a decision of
its own. [`univ-base`](../univ-base/INTENT.md#earlier-shape) is kept the same
way.

What the earlier script learnt, and where each lesson lives now:

| Lesson | Now |
| :--- | :--- |
| A variables file is read before it is sourced | `deploy/lib.sh`, and univ-minimal's `podman-up.sh` |
| An explicit image lock never falls back to a tag | univ-minimal: the lock, or an explicit published tag, never a guess; each image's unit labels checked against the manifest |
| Dormant startup, loopback binds | univ-minimal: Queue never dispatches, Maestro submits only the declared schedule, every unit binds `127.0.0.1` |
| Create what is mounted, before it is mounted | univ-minimal: each unit's declared volumes created, single directories, before the unit starts |
| Maestro reaches work through Queue | univ-minimal: always, under Maestro's own credential |
| No default model (Rule 7) | no engine in the base units; a deploy script of this tree that starts the Cursor or Antigravity bridge halts without a measured model and names no default |

## 7. Document map

| File | Role |
| :--- | :--- |
| `INTENT.md` | This file — law for the universe |
| `manifest.json` | Machine-readable unit graph: the four base units, then the universe's own |
| `AGENT-DEPLOY.md` | What the deploy agent may do autonomously |
| `cfg-universe.env.example` | The universe's settings, names and placeholders only |
| `cfg-image-lock.json` | One digest per unit image the manifest declares |
| `tasks/task-schedule.json` | Maestro's declared schedule (empty in the template) |
| `context/ctx-universe.md` | Business context for runtime AI at beat time |
| `deploy/` | `install-base.sh`, `podman-up.sh`, `proof.sh`, `base.sh` (the base's drills and renewal), and `lib.sh` they share |
| `test/` | `socle-live.test.js` (the smoke test), `rehearsal.live.mjs` (the rehearsal without podman) |

Deploy agent: read files in order **INTENT → manifest → AGENT-DEPLOY**.
