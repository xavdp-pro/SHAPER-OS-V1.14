# Package: @shaper/agent

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Parameterized agent task registry helpers — one generic `brick-agent`, many Maestro instances.

## 2. Invariants

1. **No brick-per-mailbox**: slug derived from params (`mail-contact-zoutik-shop`), not a new Podman image.
2. **Context is a path param** (`contextPath`), not a separate brick.
3. Bridge-agnostic: agy, cursor, claude, opencode via `bridgeType` + `bridgeUrl`.
4. Beat skips when `GET /api/health` fails — no inject on dead agent.
