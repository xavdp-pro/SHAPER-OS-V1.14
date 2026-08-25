# Package: @shaper/queue

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `queue`

---

## 1. Declarative Objective

In-memory async job queue with progress tracking and SSE streaming — no external broker.

---

## 2. Universal Invariants (Parameterized)

1. **Lifecycle**: `PENDING` → `RUNNING` → `COMPLETED` | `FAILED` — set explicitly by the consumer (or by `QUEUE_AUTO_DISPATCH=1` worker for `agent.inject`).
2. **Ephemeral**: In-memory only. No persistence, no retry logic in this brick.
3. **Events**: `EventEmitter` hooks + `JobQueue.formatSSE()` for HTTP streams.
4. **Isolation**: `type` and `payload` are opaque. Zero business logic in the queue core.
5. **Optional worker**: `worker.js` understands only `type=agent.inject` and forwards `payload.message` (+ optional params) to a bridge HTTP inject.
6. **Terminal evidence**: a bridge terminal event decides success/failure; when it carries final answer text, the worker stores that answer in `job.result.answer` with the exit code.

### Job parameters (voluntary enqueue)

```json
{
  "type": "agent.inject",
  "totalSteps": 2,
  "payload": {
    "message": "required instruction",
    "conversation": "optional-session-name",
    "bridgeUrl": "http://127.0.0.1:4340",
    "model": "opencode/nemotron-3.5-lightning-free",
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
| `payload.model` | no | Model id for the bridge |
| `payload.context` | no | Extra context text |
| `totalSteps` | no | Progress denominator (default 1) |
