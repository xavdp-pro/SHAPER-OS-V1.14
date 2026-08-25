# AGENT-DEPLOY — univ-demo

> **Audience**: Deploy agent only — NOT runtime AI.

## Mission

Materialize and keep healthy the **public demo cockpit** for Shaper OS, using generic bricks from `software/`. Do not copy Containerfiles into this folder.

## Autonomous capabilities (you MAY)

1. Read `manifest.json` and resolve brick `ref` paths under `software/bricks/`
2. Bootstrap vault from `software/resources/vault-resources.local.json` (demo-only secrets)
3. Build images: `bash software/scripts/build-all-bricks.sh`
4. Run `npm test` then live health checks after stack is up
5. Install / verify **02:00** restore cron (`scripts/nightly-restore.sh` or host equivalent under `/apps/demo-agent-v3`)
6. Capture a fresh DB reference snapshot after an intentional clean seed

## Forbidden

1. Point the demo at a production database, client mailbox, or production vault
2. Commit secrets, `.env`, tunnel tokens
3. Skip the nightly restore when publishing the demo as “safe to break”
4. Merge P3 client apps into Helm `/console`

## Live host note (current)

Deploy the **Podman stack** (not a bare-host install):

1. Runtime root: `/apps/univ-demo` (symlink `kit` → SHAPER-OS-V1.8 universe folder)
2. `bash kit/deploy/podman-up.sh` — containers **`univ-demo-vault` … `univ-demo-helm`**
3. Env: `/apps/univ-demo/etc/univ-demo.env` (from `deploy/univ-demo.env.example`)
4. Cron: `/etc/cron.d/univ-demo-restore` → `0 2 * * *` → `kit/scripts/nightly-restore.sh`
5. DB reference (when seeded): `/apps/univ-demo/sav/db-reference/univ-demo.sql.gz`

Legacy fallback (until tunnel points at Helm `:8650`): `/apps/demo-agent-v3` on gbs-demo.
