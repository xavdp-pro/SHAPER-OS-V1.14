# AGENT-DEPLOY — univX Template

> **Audience**: Deploy agent only — NOT runtime AI.

## Mission

Materialise and prove this universe: the four base units of univ-minimal, at one
recorded revision of SHAPER OS, then the units this universe adds — each one
functional Podman holding its application and its own MariaDB server (Rules 4
and 26). Read [`INTENT.md`](./INTENT.md#base-units) first.

## Autonomous capabilities (you MAY)

1. Copy this folder to the universe's own directory (outside this repository),
   name it after the universe, and replace every `<…>` and `univ-example`.
2. Install the base units from a SHAPER OS checkout:
   `bash deploy/install-base.sh --shaper-repo <SHAPER-OS-V1.14 checkout> --shaper-commit <base release revision>`.
3. Build the unit images under a **new** tag and record the lock from the
   registry's answer (`podman push --digestfile`, `scripts/record-image-lock.py`),
   or, in DEV only, name a published tag in `cfg-universe.env`.
4. Run `deploy/podman-up.sh --preflight`, then `deploy/podman-up.sh`, inside the
   universe container.
5. Install the bootstrap renewal once: `bash base/deploy/install-renewal-timer.sh`.
6. Prove: `bash deploy/proof.sh`, then `bash base/deploy/lifecycle-drill.sh` and
   `bash base/deploy/restore-drill.sh`; `npm run test:live` is a smoke test only.

## Forbidden

1. Copy `packages/`, a `Containerfile` or univ-minimal's scripts into the universe
   folder — `base/` is installed from a revision, never edited.
2. Commit secrets, `cfg-universe.env`, tunnel tokens.
3. Push over a tag a registry already serves, or rebuild an image under a tag
   that a lock anywhere has pinned (`SHAPER_FORCE_REBUILD=1` on a published tag
   moves it).
4. Add a unit without its own MariaDB inside its own container, or one that reads
   another unit's database or files.
5. Run this over a universe of the earlier template's shape (file stores, an AI
   bridge): that is a migration, decided on its own ([why](./INTENT.md#earlier-template)).

## Pipeline

```bash
cp -r software/universes/_template /apps/univ-<name>      # outside the repository
cd /apps/univ-<name>                                       # edit manifest.json, INTENT.md
bash deploy/install-base.sh --shaper-repo /root/SHAPER-OS-V1.14 --shaper-commit <revision>
cp cfg-universe.env.example cfg-universe.env               # SHAPER_UNIVERSE=univ-<name>
# images: build under a new tag, then pin cfg-image-lock.json (or a DEV tag in cfg-universe.env)
bash deploy/podman-up.sh --preflight
bash deploy/podman-up.sh
bash base/deploy/install-renewal-timer.sh
bash deploy/proof.sh
bash base/deploy/lifecycle-drill.sh && bash base/deploy/restore-drill.sh
```
