# Package: @shaper/maestro

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `maestro`

---

## 1. Declarative Objective

Deterministic cadence beat scheduler — register worker pods, pulse on interval, zero idle LLM token waste.

---

## 2. Universal Invariants (Parameterized)

1. **Beat Engine**: Periodic heartbeat every `<CADENCE_SECONDS>`. Handler decides if LLM is needed.
2. **Registry**: Requires `<SLUG>`, `<MAILBOX>`, `<PORT>`. Vault key and context path are opaque references.
3. **Audit**: Every beat logged via `@shaper/logger` as JSONL.
4. **Isolation**: No universe business logic. Scheduling only.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Brick port**: `8530` | **Default cadence**: `60`s
* **Logs**: `/data/<universe-slug>/maestro/log`
