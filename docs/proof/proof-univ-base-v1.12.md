# proof-univ-base — V1.12 clean build from zero

> Podman's entire storage was erased inside the LXC — no image, no container, no
> layer cache — and the whole chain re-run: build, push, lock, deploy, prove.
> The local store was emptied a second time before deploying, so every brick was
> pulled from the registry by digest. This proves a release, not a build.

Date         : 2026-08-27T05:38:30Z
Host         : gbs-test (10.87.78.36), LXD 5.0.2
Container    : univ-base-test — podman storage erased before this run
Commit       : 33a5c6f fix(v1.12): the image lock held digests the registry had never heard of
               (a commit of the private lineage — this public repository starts
               at a single commit, see its first commit message)
Podman       : podman version 5.4.2  |  node on host: none
Registry     : 10.213.199.234:5000, tag v1.12.0
Local store  : 0 images before build, emptied again before deploy

## Image lock — written by scripts/record-image-lock.py, each entry verified against the registry
{
  "status": "released",
  "rule": "A TEST or PROD deployment replaces every null with an immutable img-* OCI digest. latest is forbidden.",
  "images": {
    "img-vault": "10.213.199.234:5000/shaper/brick-vault@sha256:6c64c120386d755a1a9201eb0ae4ed1a8a828525709d7493e3fc1bcd5ddad160",
    "img-logger": "10.213.199.234:5000/shaper/brick-logger@sha256:fe874644982e58a3991febd41450f5c7de6e55209f633a916f4f3f72bde4f243",
    "img-queue": "10.213.199.234:5000/shaper/brick-queue@sha256:36e87d641be4a28a989d04bc679385e68f56d9636aef579227f781ad990c2b69",
    "img-maestro": "10.213.199.234:5000/shaper/brick-maestro@sha256:8e49edebb11090f7829b6af68be08b5ad6876d0549d7cc45e163fcc1b0fc8644",
    "img-bridge-opencode": "10.213.199.234:5000/shaper/brick-bridge-opencode@sha256:504e163527f6263593aa77556452799ac14f6824acd9268500b1df442336cb9e"
  }
}

## Containers
univ-base-ctr-vault  10.213.199.234:5000/shaper/brick-vault@sha256:6c64c120386d755a1a9201eb0ae4ed1a8a828525709d7493e3fc1bcd5ddad160
univ-base-ctr-logger  10.213.199.234:5000/shaper/brick-logger@sha256:fe874644982e58a3991febd41450f5c7de6e55209f633a916f4f3f72bde4f243
univ-base-ctr-queue  10.213.199.234:5000/shaper/brick-queue@sha256:36e87d641be4a28a989d04bc679385e68f56d9636aef579227f781ad990c2b69
univ-base-ctr-bridge-opencode  10.213.199.234:5000/shaper/brick-bridge-opencode@sha256:504e163527f6263593aa77556452799ac14f6824acd9268500b1df442336cb9e
univ-base-ctr-maestro  10.213.199.234:5000/shaper/brick-maestro@sha256:8e49edebb11090f7829b6af68be08b5ad6876d0549d7cc45e163fcc1b0fc8644

## Proof
── vitals ──────────────────────────────────────────────────────────────
  OK     vault                  {"service":"brick-vault","at":"2026-08-27T05:38:30.248Z","uptimeSeconds":37.5,"signals":{"secretsHeld":0,"lastSuccessful
  OK     logger                 {"service":"brick-logger","at":"2026-08-27T05:38:30.264Z","uptimeSeconds":37.3,"signals":{"podsCount":1,"eventsLast60s":
  OK     queue                  {"service":"brick-queue","at":"2026-08-27T05:38:30.281Z","uptimeSeconds":36,"signals":{"lanesConfigured":1,"jobsHeld":0,
  OK     bridge-opencode        {"ok":true,"service":"brick-bridge-opencode","port":4440}
  OK     maestro                {"service":"brick-maestro","at":"2026-08-27T05:38:30.311Z","uptimeSeconds":28.3,"signals":{"tasksRegistered":1,"activeTa

── the declared task is registered ─────────────────────────────────────
  OK     task-base-proof        held by the cadence registry

── every image this universe runs can be pulled back ───────────────────
  OK     img-vault              sha256:6c64c120386d755a1a9…
  OK     img-logger             sha256:fe874644982e58a3991…
  OK     img-queue              sha256:36e87d641be4a28a989…
  OK     img-maestro            sha256:8e49edebb11090f7829…
  OK     img-bridge-opencode    sha256:504e163527f6263593a…

── the logger holds evidence, not just a heartbeat ─────────────────────
  OK     events                 1 recorded — brick-maestro:MAESTRO_STARTED

univ-base is proven: every declared brick answered, and the declared task is held.

---

## What this run establishes

**The corrected chain works end to end, first time.** `build-all-bricks.sh`
built the base image and eight bricks from nothing, each push recorded its own
digest, `record-image-lock.py` wrote the lock and verified every entry against
the registry before writing it, and `proof.sh` confirmed all five resolve. None
of those three steps existed in this form four hours ago; all three exist because
the previous run produced a lock that looked like a release and was not.

**The method is reproducible; the artefact is not.** The same tree, built twice on the same host, produced five different digests:

| brick | first build | this build |
| :--- | :--- | :--- |
| `img-vault` | `c42ff271…` | `6c64c120…` |
| `img-logger` | `5cfaa84b…` | `fe874644…` |
| `img-queue` | `ebf0c09a…` | `36e87d64…` |
| `img-maestro` | `7354c4f6…` | `8e49edeb…` |
| `img-bridge-opencode` | `73162ca2…` | `504e1635…` |

That is expected — layer timestamps and package state see to it — but it has a
consequence worth stating plainly, and it is now in
`univ-base/INTENT.md#image-lock`: **a lock is the only record of which artefact
was proven.** Rebuilding from source yields a functionally equivalent image with
a different digest, so a lock whose registry has been lost cannot be satisfied by
rebuilding. It can only be re-issued, and re-proved. Anyone treating "we can
rebuild from git" as equivalent to "we can restore" is trusting a claim this
table refutes.

## Remaining gap

`AGENT-DEPLOY.md` still starts from `git clone` of a repository that is not
published; the tree was transferred as a tarball again. It is the last of the
four process gaps, and the only one that cannot be closed from inside the
repository.
