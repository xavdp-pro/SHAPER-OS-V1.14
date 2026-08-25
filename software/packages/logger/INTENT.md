# Package: @shaper/logger

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `logger`

---

## 1. Declarative Objective

Append-only structured JSONL audit logger for agent telemetry and security tracing.

---

## 2. Universal Invariants (Parameterized)

1. **Format**: One JSONL line per event — `timestamp`, `pod`, `level`, `event`, `data`, `duration_ms`.
2. **Append-Only**: Writes to `<LOG_DIR>/<POD>/activity.jsonl`. No mutation, no truncation.
3. **Dual Mode**: In-process `EventLogger` / `LogCollector` or HTTP gateway via `createLoggerServer()`.
4. **Zero Dependencies**: Native `node:fs`, `node:path`, `node:http`, `node:events` only.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Brick port**: `8520`
* **Storage**: `/data/<universe-slug>/logger/<POD>/activity.jsonl`
