# Intent: brick-bridge-cursor

## Role
Dedicated HTTP/SSE agent bridge for the Cursor Composer CLI.

## Invariants
- Exposes port 4310 by default.
- Mode is standard by default; fast is opt-in and never silent. The concrete model is whatever the installed CLI offers, verified at deployment — no version is pinned here (Rule 7).
- Uses `CURSOR_API_KEY` / `CURSOR_TOKEN` from vault or environment.
- Workspaces mounted at `/data/cursor-ws` (persisted on host volume `sav/cursor-ws`).

---

## What experience corrected

* **A bridge whose CLI cannot start must not answer `ok`.** Prerequisites belong
  in the image and are proven by running the CLI, not by resolving a path
  (Rule 34).

* **A missing CLI is a state, not a crash.** An unhandled spawn `error` used to
  kill the whole bridge, taking every other conversation with it and leaving the
  queue watching a stream that would never speak again. The run now ends with
  exit 127 on the same channel as any other outcome, and the bridge stays up.

* **Node emits `error` then `close` on a failed spawn.** Counting both made
  every metric drift; the run is concluded once.

* **A perimeter stated in a prompt is instruction, not containment.** The bridge
  applies it for real — `--add-dir` where the CLI supports it, the working
  directory where it does not. The difference is not cosmetic: it should decide
  which agent gets which task.

* **No CLI here has a trustworthy exit code.** Read the agent's own output.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: rapid-iteration-ui
- **role**: provides
- **depth**: D3
- **throughput**: T1
- **degraded**: allowed-with-note
- **rationale**: Engine bridge for an interactive CLI. Rule 21 `interactive: true`: never auto-dispatched; work is queued as AWAITING_HUMAN.
