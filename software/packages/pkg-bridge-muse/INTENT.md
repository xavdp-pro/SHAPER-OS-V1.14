> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Package**: `@shaper/pkg-bridge-muse`

# Package intent — Bridge Muse

## Objective

Expose the Meta Muse CLI through the **universal agent bridge interface**
(HTTP + SSE, Rule 8), headless and always responsive: no sandbox cage, no
approval prompts, no blocking `request_user_input`.

## Invariants

1. **Same contract as every other bridge** (Rule 0H): `/api/health`, `/api/inject`,
   `/api/events`, `/api/vitals`.
2. **Headless flags are not optional.** Every real run uses `--yolo` and
   `--user-input-auto-resolve` plus non-interactive child env (see
   `doctrine/AGENT-CLIS.md` §2b).
3. **A failed spawn is a run outcome, not a process crash** (Rule 34): `proc.on('error')`
   emits `done` and the HTTP server keeps serving.
4. <a id="no-default-model"></a>**No default model.** `MUSE_MODEL` (or `META_MUSE_MODEL`)
   is measured at deploy (Rule 7). Real bridge halts without it (Rule 0J);
   `BRIDGE_MUSE_STUB=1` for simulation only.

## Cognition

- **role**: provides · **capacity-class**: heavy-engineering · **depth**: D3 · **throughput**: T2 · **degraded**: allowed-with-note

Scales: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md).
