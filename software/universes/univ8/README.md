# UNIV8 — Sovereign Multi-Agent Exploration Universe (OpenCode Stack)

> **Canonical copy**: [`../../../UNIV8/README.md`](../../../UNIV8/README.md) at repo root.  
> **Perimeter**: **P1+P2 test sandbox** — see [`../../docs/PERIMETERS.md`](../../docs/PERIMETERS.md).

> **Location**: `REMOTE2/UNIV8/` (sibling of `SHAPER-OS/` and `UNIV7/`)
> **Stack**: 5 Core Podman Bricks: **Vault**, **Logger**, **Bridge-OpenCode**, **Queue**, **Maestro**.

## Layout

```
REMOTE2/
├── SHAPER-OS/     ← generic bricks + packages (canonical standard)
├── UNIV7/         ← test universe (Artisan BTP)
└── UNIV8/         ← this universe (Exploration Universe)
    ├── INTENT.md
    ├── manifest.json
    ├── AGENT-DEPLOY.md
    ├── context/
    │   └── AGENT-CONTEXT.md
    ├── tasks/
    │   ├── maestro-tasks.json
    │   └── maestro-tasks.podman.json
    ├── bricks/
    │   ├── mail-contact-zoutik-shop/instance.json
    │   └── ops-univ8-exploration/instance.json
    ├── deploy/
    │   ├── podman-up.sh
    │   ├── podman-down.sh
    │   └── enqueue.sh
    ├── state/
    │   └── checkpoint.json
    └── test/
        ├── harmonized-socle.test.js
        ├── maestro-agent-cadence.test.js
        └── socle-integration.test.js
```

## Quick Start & Verification

```bash
cd ../UNIV8
npm test
```

### Start the 5-Container Podman Stack

```bash
# 1. Start all 5 containers
npm run podman:up
# ou : bash deploy/podman-up.sh

# 2. Push a voluntary job to the queue
bash deploy/enqueue.sh "Reply only PONG" test-pong

# 3. Trigger a manual mail beat
curl -X POST http://127.0.0.1:8630/api/pods/mail-contact-zoutik-shop/tick

# 4. Check audit logs
curl -s http://127.0.0.1:8620/api/events/last?limit=10

# 5. Stop all UNIV8 containers
npm run podman:down
# ou : bash deploy/podman-down.sh
```
