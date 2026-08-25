# AGENT-DEPLOY — <univ_slug>

> Audience: install agent only — not the runtime AI.  
> Lifecycle of this universe: `dev` | `test` | `prod`

## Mission

Materialize this universe from generic `software/` bricks in the V1.6 monorepo. Do not copy Containerfiles here.

## You MAY

1. Read `manifest.json` and brick `INTENT.md` files under `software/bricks/`
2. Run `npm test` then, after the stack is up, `npm run test:live` — both must be green (tier-b: also `test:live:helm`)
3. Build images listed in the manifest (`prod`: tagged images only)
4. Copy `examples/deploy/podman-up.sh` — do not invent a parallel architecture
5. Use `manifest.tier-a.json` from repo root as `manifest.json`
6. Copy `examples/tasks/maestro-tasks.json` and `software/resources/vault-resources.dev.example.json` for DEV
7. Optional: `examples/universe.env.example` → `<univ_slug>-dev/deploy/env`
8. Start the stack and curl health endpoints
9. If `test`: after green tests, **destroy** this universe

## You MUST NOT without a human

1. Commit secrets
2. Deploy to a public host or push registry tags
3. Enable live mail (`MAIL_AGENT_STUB=0`) without explicit OK — never production mail in dev/test
4. Change `software/topology.json` unless asked
5. If `prod`: edit running files by hand or copy a DEV tree onto it

## Success

- [ ] `npm test` green
- [ ] Vault `/api/health` OK
- [ ] All services in `bootOrder` healthy
- [ ] If test: destroyed after the run
