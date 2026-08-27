# proof-univ-base — V1.12 clean-sheet TEST verdict

> The V1.11 container was destroyed and this one created empty (Rule 10), on a
> Debian 13 carrying neither podman, nor git, nor node. The local image store
> was then emptied before deploying, so every brick was pulled from the registry
> by digest — the only way to prove a release rather than a build.

Date        : 2026-08-27T05:32:59Z
Host        : gbs-test (10.87.78.36), LXD 5.0.2
Container   : univ-base-test — LXC Debian 13 created empty for this run, profile podman-univ
Commit      : b373d52 proof(v1.12): clean sheet, and nothing removed was load-bearing
Podman      : podman version 5.4.2  |  node on host: none
Registry    : 10.213.199.234:5000, tag v1.12.0
Local store : emptied before deploy — every image was pulled from the registry

## Image lock
{
  "status": "released",
  "rule": "A TEST or PROD deployment replaces every null with an immutable img-* OCI digest. latest is forbidden.",
  "images": {
    "img-vault": "10.213.199.234:5000/shaper/brick-vault@sha256:c42ff271f0d22185219953bc3d7932614dcfc0c826cfa0b9275b56eed73abafe",
    "img-logger": "10.213.199.234:5000/shaper/brick-logger@sha256:5cfaa84b73f4f8e2857f5711f796dc3b63625e94f81305f90c7bc1a2e13d3f08",
    "img-queue": "10.213.199.234:5000/shaper/brick-queue@sha256:ebf0c09a13da8d148b059ea3aa324873e24c95a61ac2e4263240406eaa601911",
    "img-maestro": "10.213.199.234:5000/shaper/brick-maestro@sha256:7354c4f6d207dbea25fb321d8641b7d7bc0f3205b198d84c7a6dc6abd2ea9165",
    "img-bridge-opencode": "10.213.199.234:5000/shaper/brick-bridge-opencode@sha256:73162ca27b77ca30f830812808b6e735f5f29819606f594cd0011e570bee9701"
  }
}

## Containers
univ-base-ctr-vault  10.213.199.234:5000/shaper/brick-vault@sha256:c42ff271f0d22185219953bc3d7932614dcfc0c826cfa0b9275b56eed73abafe
univ-base-ctr-logger  10.213.199.234:5000/shaper/brick-logger@sha256:5cfaa84b73f4f8e2857f5711f796dc3b63625e94f81305f90c7bc1a2e13d3f08
univ-base-ctr-queue  10.213.199.234:5000/shaper/brick-queue@sha256:ebf0c09a13da8d148b059ea3aa324873e24c95a61ac2e4263240406eaa601911
univ-base-ctr-bridge-opencode  10.213.199.234:5000/shaper/brick-bridge-opencode@sha256:73162ca27b77ca30f830812808b6e735f5f29819606f594cd0011e570bee9701
univ-base-ctr-maestro  10.213.199.234:5000/shaper/brick-maestro@sha256:7354c4f6d207dbea25fb321d8641b7d7bc0f3205b198d84c7a6dc6abd2ea9165

## Proof
── vitals ──────────────────────────────────────────────────────────────
  OK     vault                  {"service":"brick-vault","at":"2026-08-27T05:32:59.177Z","uptimeSeconds":32.6,"signals":{"secretsHeld":0,"lastSuccessful
  OK     logger                 {"service":"brick-logger","at":"2026-08-27T05:32:59.193Z","uptimeSeconds":32.5,"signals":{"podsCount":1,"eventsLast60s":
  OK     queue                  {"service":"brick-queue","at":"2026-08-27T05:32:59.208Z","uptimeSeconds":31.2,"signals":{"lanesConfigured":1,"jobsHeld":
  OK     bridge-opencode        {"ok":true,"service":"brick-bridge-opencode","port":4440}
  OK     maestro                {"service":"brick-maestro","at":"2026-08-27T05:32:59.234Z","uptimeSeconds":23.5,"signals":{"tasksRegistered":1,"activeTa

── the declared task is registered ─────────────────────────────────────
  OK     task-base-proof        held by the cadence registry

── every image this universe runs can be pulled back ───────────────────
  OK     img-vault              sha256:c42ff271f0d22185219…
  OK     img-logger             sha256:5cfaa84b73f4f8e2857…
  OK     img-queue              sha256:ebf0c09a13da8d148b0…
  OK     img-maestro            sha256:7354c4f6d207dbea25f…
  OK     img-bridge-opencode    sha256:73162ca27b77ca30f83…

── the logger holds evidence, not just a heartbeat ─────────────────────
  OK     events                 1 recorded — brick-maestro:MAESTRO_STARTED

univ-base is proven: every declared brick answered, and the declared task is held.

---

## What the first V1.12 run got wrong, and how it was caught

The first attempt reported the same green proof as this one, and was worthless.

Asked whether the universe really came from V1.12, I checked instead of
answering — and found that every digest in `cfg-image-lock.json` returned
`manifest unknown` from the registry. The universe was running only because the
images sat in the local store from the build. On any other host, and after any
reset, nothing would have pulled.

The cause was the manual step both earlier verdicts had flagged as a gap: the
digests came from `podman inspect` on locally built images, and a registry
re-serialises the manifest it stores, so those digests were never uploaded
anywhere. *"A release step performed by hand is a release step that will
eventually be performed wrong"* — written in yesterday's verdict, and then
performed wrong by the person who wrote it.

Three things changed, and none of them is only a fix:

1. Every `build-brick-*.sh` writes `podman push --digestfile`. The digest is
   what the registry acknowledged, never what the builder computed.
2. `scripts/record-image-lock.py` fills the lock and refuses to write an entry
   the registry will not serve back. That closes gap 4 of the V1.11 verdict:
   the step is no longer a sentence with no tool behind it.
3. `proof.sh` verifies every locked digest resolves. The old proof declared this
   universe "proven" while its lock was unusable, because it never asked.

The invariant is in `univ-base/INTENT.md#image-lock`, so it outlives all three.

## A second defect, from the same run

The lock tool was first written as `record-image-lock.mjs` and failed on this
host with `node: command not found`. A clean-sheet LXC carries podman, git and
python3 — that is the condition Rule 11 describes and the entire point of a
clean sheet. The repository already carried this lesson, in
`_template/deploy/podman-up.sh`, about calling a host `npm`. It is now python.

*A lesson written down is not a lesson learned until the next tool obeys it.*

## Remaining gap

`AGENT-DEPLOY.md` still starts from `git clone` of a repository that is not
published, so the working tree was transferred as a tarball. It is the last of
the four process gaps, and the only one that cannot be closed from inside the
repository.
