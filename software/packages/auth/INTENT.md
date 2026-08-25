# Package: @shaper/auth

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Shared Bearer token verification for SHAPER HTTP services — no business logic.

## 2. Invariants

1. Stateless — no session store.
2. Empty token config = auth disabled (dev-friendly).
3. Zero coupling to any universe or brick.
4. English-only API surface.
