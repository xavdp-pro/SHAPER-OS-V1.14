# Brick: Agent

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Package**: `@shaper/pkg-agent-runtime` + bridge packages (`@shaper/pkg-bridge-agy`, etc.)

## 1. Declarative Objective

One generic runtime brick — Maestro registers 1..N parameterized tasks.

## 2. Invariants

1. **One runtime, many tasks** — a `task-*` entry is not a new image.
2. **Context via `ctx-*`** — not a separate brick per universe.
3. Bridge CLI agnostic: agy, cursor, deepseek or opencode.
4. A task runs only while `GET /api/health` succeeds on the selected bridge.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: heavy-engineering
- **role**: requires
- **depth**: D3
- **throughput**: T2
- **degraded**: queue
- **rationale**: Executes assigned tasks end to end and must judge when its own output satisfies the typed contract (Rule 20). Ambiguity resolution is the job, so depth cannot be lowered; latency is not user-visible, so it queues rather than degrading.
