# Package: @shaper/pkg-maestro

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `maestro`

---

## 1. Declarative Objective

Deterministic cadence beat scheduler — register worker pods, pulse on interval, zero idle LLM token waste.

---

## 2. Universal Invariants (Parameterized)

1. **Beat Engine**: Periodic heartbeat every `<CADENCE_SECONDS>`. Handler decides if LLM is needed.
2. **Registry**: Requires `<SLUG>`, `<LABEL>`, `<PORT>`. Vault key and context path are opaque references.
3. **Audit**: Every beat logged via `@shaper/pkg-logger` as JSONL.
4. **Isolation**: No universe business logic. Scheduling only.
5. **Context snapshot**: Before enqueueing, the handler reads the task's
   configured context and puts the text in `payload.context`. An unreadable or
   empty declared file skips the beat with its reason. The job thus carries the
   context actually supplied at creation, independently of container mounts or
   later file changes. `instruction` is the explicit task request; `beatMessage`
   remains the fallback for existing registrations.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Brick port**: `8630` | **Default cadence**: `60`s
* **Logs**: `/data/<universe-slug>/maestro/log`
