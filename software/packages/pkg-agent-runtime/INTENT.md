# Package: @shaper/pkg-agent-runtime

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Generic runtime for parameterized tasks — one `brick-agent-runtime`, many universe-defined task entries.

## 2. Invariants

1. **No business capability**: no IMAP, SMTP, CRM, customer or mailbox semantics.
2. **Context is a path parameter** (`ctx-*`), not a separate image.
3. Bridge-agnostic: agy, cursor, deepseek or opencode via `bridgeType` + `bridgeUrl`.
4. A task skips when `GET /api/health` fails — no inject on a dead bridge.
