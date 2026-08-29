# Package: @shaper/pkg-queue

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `queue`

---

## 1. Declarative Objective

Async job queue with progress tracking and SSE streaming — no external broker.
Optional JSONL evidence trail: records survive a crash, in-flight execution
does not (invariant 2).

---

## 2. Universal Invariants (Parameterized)

1. **Lifecycle**: `PENDING` → `RUNNING` → `COMPLETED` | `FAILED` — set explicitly by the consumer (or by `QUEUE_AUTO_DISPATCH=1` worker for `agent.inject`).
2. **Durability is evidence, never resumption** *(corrected in V1.13 — this
   line used to say "in-memory only, no persistence", which the code itself
   contradicted)*: when `storageFile` is configured, every job state change is
   appended as JSONL and hydrated back at boot — the **record** of a job
   survives a crash. What does NOT survive is its **execution**: a job that was
   `RUNNING` when the process died comes back as a record in its last persisted
   state and is never re-executed by this brick. No crash-survival claim may
   rest on this queue re-running work; a universe that needs at-least-once
   execution must make its jobs idempotent and re-enqueue from its own beat
   (maestro), reading the hydrated records to know what was in flight. One
   scoping note, verified in `worker.js`: hydrated **PENDING** jobs are
   dispatched normally after a restart when the worker runs — a first
   execution, not a resumption; hydrated **RUNNING** jobs are adopted as
   `FAILED`, never re-run. Without
   `storageFile`, the queue is fully in-memory and a crash loses everything.
3. **The queue testifies for its own work** *(V1.13.4)*: with `LOGGER_URL` set,
   every job emits `JOB_CREATED` and its terminal `JOB_COMPLETED` /
   `JOB_FAILED`, **correlated to the job id**. The queue is the ledger of
   work, so the queue is what must say a job existed — not whoever happened to
   enqueue it. Until V1.13.4 only maestro logged, so a job POSTed by hand —
   what the runbook prescribes for its own functional proof — finished with a
   persisted answer and left no trace, making proof #4 unsatisfiable on the
   documented path. Emission is fire-and-forget: a logger that is down never
   stops work, and says so on stderr rather than failing silently.
4. **Events**: `EventEmitter` hooks + `JobQueue.formatSSE()` for HTTP streams.
5. **Isolation**: `type` and `payload` are opaque. Zero business logic in the queue core.
6. **Optional worker**: `worker.js` understands only `type=agent.inject` and forwards `payload.message` (+ optional params) to a bridge HTTP inject.
7. **Terminal evidence**: a bridge terminal event decides success/failure; when it carries final answer text, the worker stores that answer in `job.result.answer` with the exit code.

### Job parameters (voluntary enqueue)

```json
{
  "type": "agent.inject",
  "totalSteps": 2,
  "payload": {
    "message": "required instruction",
    "conversation": "optional-session-name",
    "bridgeUrl": "http://127.0.0.1:4340",
    "model": "<engine-measured-at-deployment>",
    "context": "optional extra instructions"
  }
}
```

| Param | Required | Meaning |
| :--- | :--- | :--- |
| `type` | yes | Must be `agent.inject` for auto-dispatch |
| `payload.message` | yes | What the agent should do |
| `payload.conversation` | no | Bridge conversation / workspace name |
| `payload.bridgeUrl` | no | Default `QUEUE_BRIDGE_URL` or `:4340` |
| `payload.model` | no | Engine id for the bridge. Selected by measurement at deployment against the declared depth and throughput (Rule 7) — never pinned in a tracked file |
| `payload.context` | no | Extra context text |
| `totalSteps` | no | Progress denominator (default 1) |
