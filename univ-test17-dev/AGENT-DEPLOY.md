# AGENT-DEPLOY — univX Template

> **Audience**: Deploy agent only — NOT runtime AI.

## Mission

Materialize and prove this universe using **generic bricks** in `software/`. Do not copy Containerfiles into this folder.

## Autonomous capabilities (you MAY)

1. Read `manifest.json` and resolve all `ref` paths to `software/bricks/` (V1.6 monorepo) or `../../bricks/` (universe inside `software/universes/`)
2. Run `npm run vault:bootstrap` from repo `software/` using `resources/vault-resources.local.json`
3. Build brick images: `bash software/scripts/build-all-bricks.sh`
4. Run `npm test` then `npm run test:live` after stack is up (tier-b: + `test:live:helm`)
5. Copy `examples/deploy/podman-up.sh` from repo root — specialize env only
6. Ensure `tasks/maestro-tasks.json` exists (`MAIL_AGENT_STUB=1` in DEV)

## Forbidden

1. Copy `packages/` or `Containerfile` into the universe folder
2. Commit secrets, `.env`, tunnel tokens
3. Default API keys in shell scripts
4. Production mailboxes in DEV/TEST

## Pipeline (V1.6 monorepo)

```bash
cp .env.example software/.env
cp software/resources/vault-resources.dev.example.json software/resources/vault-resources.local.json

cd software && npm run vault:bootstrap && npm test
bash scripts/build-all-bricks.sh

# Universe at repo root: <univ_slug>-dev/
bash ../<univ_slug>-dev/deploy/podman-up.sh
npm run test:live
```
