# SHAPER OS — Bricks (`bricks/`)

Podman Quadlet blueprints. Each brick = `INTENT.md` + `Containerfile` (+ optional `*.container`).

| File | Role |
| :--- | :--- |
| `INTENT.md` | Objective + 4 invariants. Nothing else. |
| `Containerfile` | Podman image build |
| `*.container` | Minimal Quadlet skeleton — agent completes at deploy time |

Graph, boot order, overrides → [`topology.json`](../topology.json).  
Perimeter law → [`docs/PERIMETERS.md`](../docs/PERIMETERS.md).

## Bricks (12)

| Brick | Perimeter | Role |
| :--- | :---: | :--- |
| [`brick-vault/`](./brick-vault/) | P1 | Secrets (AES-256-GCM) |
| [`brick-logger/`](./brick-logger/) | P1 | JSONL audit |
| [`brick-auth/`](./brick-auth/) | P1 | Bearer auth (optional per service) |
| [`brick-queue/`](./brick-queue/) | P1 | Job queue |
| [`brick-mariadb/`](./brick-mariadb/) | P1 | MariaDB (on-demand) |
| [`brick-maestro/`](./brick-maestro/) | P2 | Beat scheduler |
| [`brick-agent/`](./brick-agent/) | P2 | Generic agent host (N instances) |
| [`brick-bridge-agy/`](./brick-bridge-agy/) | P2 | Antigravity CLI bridge |
| [`brick-bridge-opencode/`](./brick-bridge-opencode/) | P2 | OpenCode CLI bridge |
| [`brick-ged/`](./brick-ged/) | P2 | Operator document hub |
| [`brick-qdrant/`](./brick-qdrant/) | P2 | Vectors (optional) |
| [`brick-helm/`](./brick-helm/) | P2 | KovZu cockpit (React + Express) |

## Build scripts

```bash
bash scripts/build-all-bricks.sh
# or individually: build-brick-vault.sh, build-brick-logger.sh, …
```

**No dedicated build script yet**: `brick-agent`, `brick-auth`, `brick-ged`, `brick-qdrant`.
