# Brick: Auth

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Package**: `@shaper/pkg-auth`

## 1. Declarative Objective

Central Bearer token policy for mesh HTTP services — optional per service.

## 2. Invariants

1. Stateless verification only.
2. Disabled when no token configured.
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
- **rationale**: Identity, roles and session verification are deterministic. A model must never participate in an authorisation decision.
