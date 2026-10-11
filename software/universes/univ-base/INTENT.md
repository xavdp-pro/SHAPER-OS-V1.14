# univ-base

> **Intent Classification**: SPECIFIC INTENT (Universe: `univ-base`)
>
> **Status**: earlier shape, kept on its older images ([why](#earlier-shape)).

## Objective

The V1.13 reference universe, kept in its earlier shape. It proved the generic
SHAPER base of V1.13 and V1.14 main — five bricks, file stores, one AI bridge —
and it contains no catalogue product, no client workflow and no public name. It
is no longer the shape a new universe starts from: that is
[`_template`](../_template/INTENT.md), whose base units are
[`univ-minimal`](../univ-minimal/INTENT.md)'s
([below](#earlier-shape)).

<a id="earlier-shape"></a>
## The earlier shape, kept on its older images

The base units of this tree (Vault, Logger, Queue, Maestro) are now functional
Podmans of the one-container shape: each image carries its own MariaDB server,
an `/apps/<slug>/` layout, a Vault-signed unit identity, credentials on every
route but a minimal health, and durable Queue attempts (Rules 4 and 26;
`univ-minimal`). univ-base was not converted with them, because converting it
needs its fifth brick: `brick-bridge-opencode` keeps workspace files and a token
on disk, runs as root and has no MariaDB of its own, so a univ-base of the new
units would be a new artefact inheriting a legacy gap, which Rule 26 forbids.
The bridge's conversion is a brick lot of its own.

Until then, univ-base stays what it was — the legacy transition of Rule 26 —
and serves only where it already runs:

- **Images.** Only the earlier file-store images, built from V1.14 main at or
  before `958e0b7` and pinned by digest in the lock of the host that published
  them (on `gbs-test`, tag `v114-gbs`,
  [proof record](../../../docs/proof/proof-gbs-univ-os-v114-dev.md)). Those
  digests are never re-tagged, and this tree's bricks cannot reproduce them
  (they are the later shapes). `deploy/podman-up.sh` reads every image before
  it touches a container and requires the earlier shape positively — the brick
  it declares, no `db` package, no `*_STORE=mariadb` or `SHAPER_UNIT_SLUG`, no
  application user, Vault's storage file — so it refuses both the interim
  MariaDB-store images (`96a1319` to `e03370f`) and the one-container units
  (`org.shaper.unit.*` labels). `deploy/gbs-test-bootstrap-v114.sh`, run from
  this tree with `SHAPER_CHECKOUT=<a checkout at or before 958e0b7>`, builds
  from that checkout only, never replaces the registry container (its images
  live in it), publishes only where the registry answers 404 for the tag —
  checked before anything is built, tagged or pushed — and deploys with this
  tree's `podman-up.sh` over the checkout's universe directory
  (`SHAPER_UNIVERSE_DIR`). The copy of that script inside such a checkout
  still replaces the registry and pushes over the tag: it is never run.
- **Stores.** Its Vault, Logger and Queue keep their file stores
  (`.state/vol-univ-base-*`); its proof reads Queue and Logger without a
  credential, as those images allow. This is technical debt, recorded as such,
  not compliance (Rule 26: an empty MariaDB beside file state, or none, never
  satisfies the gate).
- **Not for a new universe.** Copying this folder copies the debt. A universe
  of the current shape is derived from `_template`.

## Exact runtime — five bricks

| Brick | Why it is here |
| :--- | :--- |
| `brick-vault` | Holds the secrets this universe, and only this universe, may read |
| `brick-logger` | Keeps the append-only evidence that each step actually happened |
| `brick-queue` | Persistent work ledger, so nothing is lost between a decision and its execution |
| `brick-maestro` | Paces the declared `task-*` entries and hands each beat to the queue |
| `brick-bridge-opencode` | The one AI engine this universe may spend work on |

Five, not six. `agent-runtime` is `@shaper/pkg-agent-runtime`, a dispatch library
vendored **inside `brick-maestro`'s image**. It carried a `brick-` prefix until
V1.11 with no `Containerfile` behind it, which promised a container that no
`podman build` could ever produce.

`pkg-agent-runtime` dispatches declared `task-*` entries to the selected bridge.
It does not read IMAP and knows no business semantics. A universe that triages
mail adds catalogue `pkg-mail-agent` and declares its own `task-*` — and by doing
so it stops being `univ-base`.

## What a task must carry

A `slug`, and a cadence. Nothing else is required. Until V1.11 the scheduler
demanded a `label` and a `port` — a monitored mailbox and its container port,
renamed but not removed — and this universe's own `task-schedule.json` was
rejected by the scheduler shipped beside it.

## The image lock names exactly what the manifest declares

<a id="image-lock"></a>

`cfg-image-lock.json` holds one immutable digest per brick this universe runs.
Its keys are the `img-*` values the manifest declares — no more, and no fewer.
When a brick leaves the manifest, its entry leaves the lock with it.

**A digest is what the registry holds, not what the builder computed.** The two
differ: a registry may re-serialise the manifest it stores, so
`podman inspect` on a locally built image reports a digest the registry has
never heard of. The lock is filled from `podman push --digestfile`, and each
entry is written only after the registry has served it back.

**The method is reproducible; the artefact is not.** Building the same commit
twice produces five different digests — layer timestamps and package state make
sure of it. So the lock is not a convenience: it is the only record of *which*
artefact was proven. Rebuilding from source gives a functionally equivalent
image and a different digest, which means a lock whose registry has been lost
cannot be satisfied by rebuilding — it can only be re-issued, and re-proved.
Measured, not assumed: two clean builds of the same tree on the same host,
five bricks, five digests changed.

*Why this is written here.* On `gbs-test` the lock was filled by hand from
`podman inspect`. The universe deployed, every brick answered, and `proof.sh`
declared it proven — because the images were already in the local store from the
build. Every digest in that lock returned `manifest unknown` from the registry.
On any other host, and after any reset, the release was unusable. **A lock that
cannot be resolved is worse than an empty one, because it looks like a release.**
A proof that runs only where the artefact was built proves the build, not the
release.

*Why this is written here.* V1.11 recognised `agent-runtime` as a package and
stopped producing `img-agent-runtime`, but the lock kept listing it. That entry
could never be filled, so `status` could never reach `released`: the lock was
permanently unsatisfiable, and every future release of this universe would have
stalled on it. No test could see it, because nothing had ever attempted a real
release — it surfaced the first time one was performed, on `gbs-test`. A
declaration that cannot be satisfied is worse than a missing one, because it
looks like work remaining rather than a mistake.

<a id="variables-file"></a>
## The configuration file holds only variables

`cfg-univ-base.env` (or the file `ENV_FILE` names) is read by
`deploy/podman-up.sh` before it is sourced, and `source` executes every line
that is not a variable. Three kinds of line are admitted: a blank line, a `#`
comment, and `KEY=value` where `KEY` matches `[A-Z][A-Z0-9_]*` and the value
is one bash exports as written — a double-quoted string carrying no `$(…)`
and no backtick, a single-quoted string, or a bare word with no whitespace
and no shell operator (`; & | ( ) < >` and quotes). Any other line stops the
deployment before anything starts: the script prints the line, with its
number, and says that `source` would have executed it. A note for a human
goes behind `#`. A file the script cannot read is a halt of its own, never a
pass.

*Why this is written here.* On the first night Rule 11 ran in production a
human note slipped into a variables file was run as a command, and the deploy
died before it could print its own halt
([`proof-rule-11-in-production.md`](../../../docs/proof/proof-rule-11-in-production.md),
lesson 7). The template and the preflight learned the grammar; this script,
the one an agent copies, kept sourcing its file unread until the 2 September
correction. The two functions are the template's, verbatim, and a test feeds
both scripts the same lines.

<a id="proof"></a>
## Proof

`bash deploy/proof.sh`. It shows that every declared brick answers, that the
declared task is held by the cadence registry, that the job persisted its answer
and delivered the artefact it was asked for — compared byte for byte with `cmp`
against the deployer's declaration (`PROOF_ARTIFACT`, `PROOF_EXPECTED`) — and
that the logger holds evidence rather than a heartbeat. What was not declared is
printed as skipped and repeated by the closing verdict: a standard that is only
half-scripted is applied by half the deployers, and the artefact was the half
nobody ever opened. Rule 33: a deployment nobody proved is a claim.
