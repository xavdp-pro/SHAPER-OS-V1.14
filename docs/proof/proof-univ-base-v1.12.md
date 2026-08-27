# proof-univ-base — V1.12 clean-sheet TEST verdict

> The V1.11 container was destroyed and this one created empty for this run
> (Rule 10). Every line below was observed on a Debian 13 that carried neither
> podman, nor git, nor node when the run began.

Date        : 2026-08-27T05:21:13Z
Host        : gbs-test (10.87.78.36), LXD 5.0.2
Container   : univ-base-test — LXC Debian 13 created empty for this run, profile podman-univ
Commit      : b51e3e1 feat(v1.12): no lesson lives only in code
Podman      : podman version 5.4.2
Node on host: none — the clean-sheet condition
Registry    : 10.213.199.234:5000, tag v1.12.0

## Image lock
{
  "status": "released",
  "rule": "A TEST or PROD deployment replaces every null with an immutable img-* OCI digest. latest is forbidden.",
  "images": {
    "img-vault": "10.213.199.234:5000/shaper/brick-vault@sha256:2ef5a162fdd3a35c7d455b8024dc310ac65ef922b4724d346af5dd085658f69e",
    "img-logger": "10.213.199.234:5000/shaper/brick-logger@sha256:b12be55399474b53bdc7e2069c51a15af58d1f66420bb0f9970c1fbd409bcc02",
    "img-queue": "10.213.199.234:5000/shaper/brick-queue@sha256:fce6e1752905092b29b54167ecd281b050339962212e787c091eb3766c8ccd4b",
    "img-maestro": "10.213.199.234:5000/shaper/brick-maestro@sha256:380188a42150be1187a575ffc1aec4917968049acd0fe1d1423dd7f1737a9068",
    "img-bridge-opencode": "10.213.199.234:5000/shaper/brick-bridge-opencode@sha256:172f030a94eb2b28bccb3e774b6039623c90e843a42f5b683eea163346c69a60"
  }
}

## Containers
univ-base-ctr-vault  10.213.199.234:5000/shaper/brick-vault@sha256:2ef5a162fdd3a35c7d455b8024dc310ac65ef922b4724d346af5dd085658f69e
univ-base-ctr-logger  10.213.199.234:5000/shaper/brick-logger@sha256:b12be55399474b53bdc7e2069c51a15af58d1f66420bb0f9970c1fbd409bcc02
univ-base-ctr-queue  10.213.199.234:5000/shaper/brick-queue@sha256:fce6e1752905092b29b54167ecd281b050339962212e787c091eb3766c8ccd4b
univ-base-ctr-bridge-opencode  10.213.199.234:5000/shaper/brick-bridge-opencode@sha256:172f030a94eb2b28bccb3e774b6039623c90e843a42f5b683eea163346c69a60
univ-base-ctr-maestro  10.213.199.234:5000/shaper/brick-maestro@sha256:380188a42150be1187a575ffc1aec4917968049acd0fe1d1423dd7f1737a9068

## Proof
── vitals ──────────────────────────────────────────────────────────────
  OK     vault                  {"service":"brick-vault","at":"2026-08-27T05:21:13.572Z","uptimeSeconds":26.5,"signals":{"secretsHeld":0,"lastSuccessful
  OK     logger                 {"service":"brick-logger","at":"2026-08-27T05:21:13.587Z","uptimeSeconds":26.4,"signals":{"podsCount":1,"eventsLast60s":
  OK     queue                  {"service":"brick-queue","at":"2026-08-27T05:21:13.604Z","uptimeSeconds":25.2,"signals":{"lanesConfigured":1,"jobsHeld":
  OK     bridge-opencode        {"ok":true,"service":"brick-bridge-opencode","port":4440}
  OK     maestro                {"service":"brick-maestro","at":"2026-08-27T05:21:13.632Z","uptimeSeconds":22.9,"signals":{"tasksRegistered":1,"activeTa

── the declared task is registered ─────────────────────────────────────
  OK     task-base-proof        held by the cadence registry

── the logger holds evidence, not just a heartbeat ─────────────────────
  OK     events                 1 recorded — brick-maestro:MAESTRO_STARTED

univ-base is proven: every declared brick answered, and the declared task is held.

---

## What this run was testing, beyond the deployment

V1.12 removed thirty-four scripts from the repository and moved a guard out of
`scripts/`. A clean sheet is the only honest way to find out whether any of them
was load-bearing: on the machine where they were removed, everything is cached,
installed and already present. Here, nothing was.

Nothing was missing. `build-all-bricks.sh` produced the base image and all eight
bricks; `podman-up.sh` and `proof.sh` ran with the packages the repository
declares and nothing else.

## The V1.11 defect, confirmed fixed

`cfg-image-lock.json` reached `status: released` on the first attempt, with no
entry left unfilled. In V1.11 it could not: it still listed `img-agent-runtime`,
an image that stopped being produced when `brick-agent-runtime` was recognised
as a package, so the lock was permanently unsatisfiable. That is now an invariant
in `univ-base/INTENT.md#image-lock` and a test in `pkg-universe`, not only a fix.

## The four process gaps from V1.11

Three are addressed by Rule 11, rewritten in V1.12: the two host families are
now named in one place, the bare-host case is stated, and presence of a tool is
declared insufficient proof of a capability.

One remains, and it is the same as yesterday: `AGENT-DEPLOY.md` starts from
`git clone https://github.com/xavdp-pro/SHAPER-OS-V1.12.git`, and that repository
is not published. The working tree was transferred as a tarball with its `.git`
so the commit under test stays identifiable. Recording digests is still manual.
