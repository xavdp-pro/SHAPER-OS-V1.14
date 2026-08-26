# Package: @shaper/pkg-auth

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Shared Bearer token verification for SHAPER HTTP services — no business logic.

## 2. Invariants

1. Stateless — no session store.
2. Empty token config = auth disabled (dev-friendly).
3. Zero coupling to any universe or brick.
4. English-only API surface.

## 3. Why this is a package and not a brick

Bearer verification is a few lines executed in the request path of the service
being protected. It has no port, no lifecycle and no image; the `brick-auth`
directory that existed until V1.11 described a container nothing ever built.
Every service that needs the policy imports it — that is the whole deployment.

## 4. Cognition

> Scales and semantics: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Token comparison is mechanical. A model has no place in an authorisation decision.
