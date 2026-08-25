# Brick: Logger

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Append-only JSONL audit stream for agents and pods.

## 2. Invariants

1. One JSON line per event — never mutated.
2. Persistent host volume.
3. Localhost or mesh bind only.
4. Podman Quadlet lifecycle.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Append-only structured audit. No model, ever: the record must not be interpretable by the thing being recorded.
