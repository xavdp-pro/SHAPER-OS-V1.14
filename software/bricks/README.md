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
| [`brick-queue/`](./brick-queue/) | P1 | Job queue |
| [`brick-maestro/`](./brick-maestro/) | P2 | Beat scheduler |
| [`brick-bridge-agy/`](./brick-bridge-agy/) | P2 | Antigravity CLI bridge |
| [`brick-bridge-opencode/`](./brick-bridge-opencode/) | P2 | OpenCode CLI bridge |

## Build scripts

```bash
bash scripts/build-all-bricks.sh
# or individually: build-brick-vault.sh, build-brick-logger.sh, …
```

**Every brick here has a build script and a `brick.json`**, and a test refuses a
`brick-` directory without a `Containerfile`. `agent-runtime` and `auth` used to
sit in this table with nothing to build; they are packages, and they live in
[`../packages/`](../packages/).

---

**Not here.** `helm`, `ged`, `qdrant`, `mariadb`, `pipeline` and `waf` are packaged
products with their own upstreams, and they live in the [`SHAPER-OS-BRICKS`](https://github.com/xavdp-pro/SHAPER-OS-BRICKS-V1.13) catalogue. This
repository ships the base: the bricks whose behaviour SHAPER's own law defines.
