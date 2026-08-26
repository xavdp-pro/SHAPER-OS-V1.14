# Brick: Bridge AGY

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Package**: `@shaper/pkg-bridge-agy`

## 1. Declarative Objective

HTTP/SSE bridge to Antigravity CLI — Rule 8 agent container contract.

## 2. Invariants

1. Endpoints: `/api/health`, `/api/inject`, `/api/events`, `/api/metrics`.
2. Localhost or mesh bind only.
3. API keys from env or vault — never in image.
4. Podman Quadlet lifecycle.

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

- **capacity-class**: heavy-engineering
- **role**: provides
- **depth**: D3
- **throughput**: T1
- **degraded**: allowed-with-note
- **rationale**: Engine bridge. Declares the ceiling it can supply, not a requirement it consumes. Measure availability from the target host before selecting it (Rule 0H).
