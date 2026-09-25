# Intent: brick-bridge-muse

## Role
Dedicated HTTP/SSE agent bridge for the Meta Muse CLI — headless (`--yolo`,
`--user-input-auto-resolve`).

## Invariants
- Exposes port 4320 by default (customizable per universe via `MUSE_BRIDGE_PORT`).
- No model is pinned here: `MUSE_MODEL` (or `META_MUSE_MODEL`) is measured at deploy (Rule 7).
- `META_API_KEY` or `META_MUSE_API_KEY` from environment or vault when not in stub mode.
- The `muse` binary is mounted from the host (`MUSE_HOST_BIN`) — not baked into the image (Rule 34).
- Workspaces at `/data/muse-ws`; shared `WORK_ROOT` for perimeter enforcement.

---

## Cognition

> Scales: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md)

- **capacity-class**: heavy-engineering
- **role**: provides
- **depth**: D3
- **throughput**: T2
- **degraded**: allowed-with-note
