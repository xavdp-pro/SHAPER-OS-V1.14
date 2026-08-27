# proof-univ-base — V1.11 clean-sheet TEST verdict

> Produced on a blank LXC on `gbs-test`, from an empty Debian 13 carrying
> neither podman nor git nor node. Every line below was observed, not written.
> The four gaps this run found in the documented process are recorded at the
> end — a verdict that reports only success is not a verdict.

Date        : 2026-08-26T20:18:37Z
Host        : gbs-test (10.87.78.36), LXD 5.0.2
Container   : univ-base-test — LXC Debian 13, profile podman-univ
Commit      : 6b9cf8f proof(v1.11): univ-base deployed and proven end to end, for the first time
Podman      : podman version 5.4.2
Registry    : 10.213.199.234:5000

## Image lock
{
  "status": "released",
  "rule": "A TEST or PROD deployment replaces every null with an immutable img-* OCI digest. latest is forbidden.",
  "images": {
    "img-vault": "10.213.199.234:5000/shaper/brick-vault@sha256:6b59cb8c825b069b0a8e105bf7b5136f76426f5396dc8611dbf034478e257d9b",
    "img-logger": "10.213.199.234:5000/shaper/brick-logger@sha256:1bc6fd5993cb2710695ca82ed5c218eca2547ea193ed1ff5a06c6ce82c5622a8",
    "img-queue": "10.213.199.234:5000/shaper/brick-queue@sha256:258dc4270de460ec8fa84f4f5346ce23d18f12554fa83d91e5308ec809683096",
    "img-maestro": "10.213.199.234:5000/shaper/brick-maestro@sha256:78f55d81c285a0cdf7d56ff4145156d586c81b1b0e4951b8cdfdedf860196386",
    "img-bridge-opencode": "10.213.199.234:5000/shaper/brick-bridge-opencode@sha256:057dad95c5ef157f114c9ad2eca5d9058ed0a8b65174fbaa92827e585d3c1b4e"
  }
}

## Containers running
univ-base-ctr-vault  10.213.199.234:5000/shaper/brick-vault@sha256:6b59cb8c825b069b0a8e105bf7b5136f76426f5396dc8611dbf034478e257d9b
univ-base-ctr-logger  10.213.199.234:5000/shaper/brick-logger@sha256:1bc6fd5993cb2710695ca82ed5c218eca2547ea193ed1ff5a06c6ce82c5622a8
univ-base-ctr-queue  10.213.199.234:5000/shaper/brick-queue@sha256:258dc4270de460ec8fa84f4f5346ce23d18f12554fa83d91e5308ec809683096
univ-base-ctr-bridge-opencode  10.213.199.234:5000/shaper/brick-bridge-opencode@sha256:057dad95c5ef157f114c9ad2eca5d9058ed0a8b65174fbaa92827e585d3c1b4e
univ-base-ctr-maestro  10.213.199.234:5000/shaper/brick-maestro@sha256:78f55d81c285a0cdf7d56ff4145156d586c81b1b0e4951b8cdfdedf860196386

## Proof
── vitals ──────────────────────────────────────────────────────────────
  OK     vault                  {"service":"brick-vault","at":"2026-08-26T20:18:37.960Z","uptimeSeconds":26.7,"signals":{"secretsHeld":0,"lastSuccessful
  OK     logger                 {"service":"brick-logger","at":"2026-08-26T20:18:37.974Z","uptimeSeconds":26.7,"signals":{"podsCount":1,"eventsLast60s":
  OK     queue                  {"service":"brick-queue","at":"2026-08-26T20:18:37.991Z","uptimeSeconds":25.5,"signals":{"lanesConfigured":1,"jobsHeld":
  OK     bridge-opencode        {"ok":true,"service":"brick-bridge-opencode","port":4440}
  OK     maestro                {"service":"brick-maestro","at":"2026-08-26T20:18:38.022Z","uptimeSeconds":23.2,"signals":{"tasksRegistered":1,"activeTa

── the declared task is registered ─────────────────────────────────────
  OK     task-base-proof        held by the cadence registry

── the logger holds evidence, not just a heartbeat ─────────────────────
  OK     events                 1 recorded — brick-maestro:MAESTRO_STARTED

univ-base is proven: every declared brick answered, and the declared task is held.

---

## Gaps found in the documented process

These are defects in the *procedure*, not in the result. The deployment
succeeded; following the documentation literally would not have produced it.

**1. `provision-lxc-univ.sh` cannot run on the TEST host.** It is written for
Proxmox — `--vmid`, `pct create`, `local:vztmpl/...`. `gbs-test` is a KVM VPS
running LXD 5.0.2, with no `pct`. The container was created with `lxc launch`
against the existing `podman-univ` profile. The script is not wrong; it is
written for one hypervisor and the doctrine never says so.

**2. Étape 0 and Rule 11 describe two different hypervisors, and neither says so.**
`LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md` Étape 0 edits `/etc/pve/lxc/<ID>.conf` to
set `features: nesting=1,keyctl=1` — Proxmox. Rule 11 mandates the LXD profile
`podman-univ` with `security.nesting`, `security.privileged` and the kernel
modules — Debian with native LXC/LXD. Both are correct for their own host
family; nothing states that they are alternatives, or which applies where.

*(An earlier draft of this verdict claimed the repository never mentions the
`podman-univ` profile. That was wrong — Rule 11 names it and makes it mandatory.
The real gap is narrower: the two host families are documented in two places
that do not reference each other.)*

**3. The `git clone` step could not be followed.** `AGENT-DEPLOY.md` and the
runbook both start from
`git clone https://github.com/xavdp-pro/SHAPER-OS-V1.12.git`. That repository is
not published. The working tree was transferred as a tarball with its `.git`, so
the commit under test stays identifiable — which is what the step is for.

**4. Recording the digests is a manual step with no tool.** `AGENT-DEPLOY.md`
says "record each published digest in `cfg-image-lock.json`, replacing every
`null`", and there is no script that does it. It was done here with an inline
`podman inspect` loop. A release step performed by hand is a release step that
will eventually be performed wrong.

## Defect found in the repository, and fixed

`cfg-image-lock.json` still listed `img-agent-runtime`, an image V1.11 stopped
producing when `brick-agent-runtime` was recognised as a package. Its entry could
never be filled, so `status` could never reach `released` — the lock was
permanently unsatisfiable, and only an actual release attempt showed it. The
entry is removed, and a test now requires an image lock to name exactly the
images its manifest declares.
