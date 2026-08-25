# AGENT-DEPLOY — univ7

> **Audience**: Deploy agent only — materialize BTP overnight watchdog test stack.

## 1. Mission

Deploy univ7 minimal socle: **vault → logger → bridge-agy → maestro** with 2 cadenced agent tasks (zoutik test mail + BTP ops watch).

## 2. Autonomous capabilities (you MAY)

1. Bootstrap vault from `../../resources/vault-resources.local.json`
2. Build `shaper-maestro:latest` via `./scripts/build-brick-maestro.sh`
3. Run stub bridge: `BRIDGE_AGY_STUB=1 node packages/bridge-agy/server.js`
4. Register tasks from `./tasks/maestro-tasks.json` via `MAESTRO_TASKS_FILE`
5. Run PRA: `npm run test:socle` and `universes/univ7/test/*.test.js`
6. Add new mail instance: create `bricks/mail-<slug>/instance.json` + update manifest + tasks JSON

## 3. Forbidden without human approval

1. Live IMAP on zoutik without explicit `BRIDGE_AGY_STUB=0` + human OK
2. Copy brick Containerfiles into `universes/univ7/`
3. Read secrets from `../../REMOTE`
4. Commit `vault-resources.local.json`

## 4. Deploy pipeline

```bash
cd /path/to/SHAPER-OS

npm run vault:bootstrap
npm test

# Terminal 1 — logger (if not in podman yet)
node packages/logger/server.js

# Terminal 2 — vault
node packages/vault/server.js

# Terminal 3 — agy stub
BRIDGE_AGY_STUB=1 node packages/bridge-agy/server.js

# Terminal 4 — maestro with univ7 tasks
MAESTRO_TASKS_FILE=universes/univ7/tasks/maestro-tasks.json \
MAESTRO_BRIDGE_URL=http://127.0.0.1:4330 \
VAULT_URL=http://127.0.0.1:8510 \
VAULT_TOKEN=$(grep VAULT_TOKEN .env | cut -d= -f2) \
LOGGER_URL=http://127.0.0.1:8520 \
MAESTRO_AUTO_START=1 \
node packages/maestro/server.js
```

## 5. Success criteria

- [ ] `univ7-socle` integration test passes
- [ ] `univ7-maestro` cadence test passes
- [ ] Beat on `mail-contact-zoutik-shop` logs `AGENT_BEAT_INJECT`
- [ ] Vault returns `secret/mail/contact-zoutik-shop` without exposing pass in logs

## 6. Runtime vs deploy

| Phase | Read this file |
| :--- | :--- |
| Deploy / materialize | `AGENT-DEPLOY.md` (this file) |
| Beat / inject | `context/AGENT-CONTEXT.md` |
