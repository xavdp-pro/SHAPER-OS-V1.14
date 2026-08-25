# AGENT-DEPLOY — univ8

> **Audience**: Autonomous Deploy Agent — materialize UNIV8 sovereign OpenCode stack.

## 1. Mission

Deploy and verify the UNIV8 minimal vital socle via Podman containers: **univ8-vault → univ8-logger → univ8-bridge-opencode → univ8-queue → univ8-maestro** with OpenCode CLI embedded inside the container image, Bearer token auth, and asynchronous job queue.

## 2. Autonomous Capabilities (You MAY)

1. Bootstrap vault from `../SHAPER-OS/resources/vault-resources.local.json`.
2. Build canonical Podman images via `bash ../SHAPER-OS/scripts/build-all-bricks.sh`.
3. Launch and manage UNIV8 Podman containers via `bash deploy/podman-up.sh` and `bash deploy/podman-down.sh`.
4. Push voluntary jobs via `bash deploy/enqueue.sh "Prompt message" [conversation]`.
5. Execute 100% native Node.js unit and integration tests via `npm test`.

## 3. Deployment Pipeline

```bash
cd /path/to/REMOTE2/UNIV8

# 1. Run full verification suite
npm test

# 2. Start Podman stack
bash deploy/podman-up.sh

# 3. Healthcheck verification
curl -sf http://127.0.0.1:8610/api/health # vault
curl -sf http://127.0.0.1:8620/api/health # logger
curl -sf http://127.0.0.1:4440/api/health # bridge-opencode
curl -sf http://127.0.0.1:8640/api/health # queue
curl -sf http://127.0.0.1:8630/api/health # maestro
```

## 4. Success Criteria

- [ ] All 5 Podman containers (`univ8-vault`, `univ8-logger`, `univ8-bridge-opencode`, `univ8-queue`, `univ8-maestro`) running (`STATUS: Up`).
- [ ] Bearer auth validated on `univ8-bridge-opencode` (`GET /api/status`).
- [ ] Voluntary jobs processed asynchronously via `univ8-queue` (`enqueue.sh`).
- [ ] Periodic beats scheduled via `univ8-maestro` to `univ8-bridge-opencode`.
- [ ] `univ8-harmony` test passes (Harmonized Beat Handler: Mail → Vault → IA → Logger).
- [ ] `univ8-maestro` test passes (Cadence scheduler & resilient task dispatching).
- [ ] `univ8-socle` test passes (PRA cold boot from scratch — three clocks, see Rule 10).
- [ ] 100% test coverage with native Node.js test runner (`node --test`).
