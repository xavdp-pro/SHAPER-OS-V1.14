# univ-base

> **Intent Classification**: SPECIFIC INTENT (Universe: `univ-base`)

## Objective

The canonical V1.13 reference universe. It proves the generic SHAPER base, and
it contains no catalogue product, no client workflow and no public name. If this
universe does not come up, nothing built on top of it will — which is its whole
job.

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
