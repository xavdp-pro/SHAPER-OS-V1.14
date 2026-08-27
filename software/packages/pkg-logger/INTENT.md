# Package: @shaper/pkg-logger

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

## 3. Invariants learned by running it

<a id="identity"></a>
### 3.1 A service announces its layer, not its version

Every service states `service: "brick-<component>"` on `/api/health` and
`/api/vitals`. The supervisor reads that name to decide what it is looking at,
so the name is a contract and not a label.

*Why this is written here.* Until V1.11 four bricks announced `vault-v1`,
`logger-v1`, `queue-v1` and `maestro-v1` — a version suffix frozen at `v1`
through eleven releases, naming a layer the reader had to infer. Maestro was
renamed and the others were not, so the fleet spoke two vocabularies at once,
which is worse than leaving all four alone. A partial rename is a defect in its
own right.

<a id="sibling-paths"></a>
### 3.2 A package must be reachable at the path its importers resolve

When a package is flattened into an image's `WORKDIR`, a sibling import such as
`../pkg-logger/vitals.js` resolves to `/pkg-logger/`. The image must place it
exactly there. The name in the import and the destination of the copy are the
same fact stated twice, and they must not be allowed to drift apart.

*Why this is written here.* V1.10 renamed every package to `pkg-*`, which changed
every sibling import, and left the copy destination at `/logger/`. Every image
built that way threw `Cannot find module '/pkg-logger/vitals.js'` on its first
import — including the one brick V1.10 had converted and the test it had
written, which checked that the Containerfile *mentioned* the package and never
where it put it. A guard that reads a name proves nothing about a path.

<a id="evidence"></a>
### 3.3 Evidence is what the logger holds, not what answers

`/api/events` is a live stream: it answers the moment it is opened, whether or
not anything was ever recorded. A proof that reads it observes a socket. The
question "is there evidence" is answered by `/api/events/last`, which returns
what is actually held.

*Why this is written here.* `univ-base`'s proof script reported "the logger holds
evidence" while observing only that a connection succeeded. A probe that cannot
fail is not a probe, and this class of mistake — confusing reachability with
content — will outlive this particular endpoint.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Brick port**: `8520`
* **Storage**: `/data/<universe-slug>/logger/<POD>/activity.jsonl`
