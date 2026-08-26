# Brick: Queue

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Package**: `@shaper/pkg-queue`

## 1. Declarative Objective

In-memory async job queue — no external broker.

## 2. Invariants

1. Lifecycle: `PENDING` → `RUNNING` → `COMPLETED` | `FAILED`.
2. Ephemeral — no persistence in this brick.
3. Localhost or mesh bind only.
4. Podman Quadlet lifecycle.

---

## 3. What experience corrected

Recorded here rather than only in the code, so the next universe inherits the
lesson instead of the bug (Rule 29, applied to intent as well as to tests).

* **An acknowledgement is not a result.** The queue once marked a job
  `COMPLETED` the moment a bridge answered `ok`. It now follows the run to its
  terminal event, and **subscribes before injecting** — a short run finished
  before anyone was listening.

* **Work whose end cannot be observed stays `RUNNING`**, with the reason
  recorded. A pending job beats an invented success; the invented one propagates
  and everything downstream inherits it.

* **But a run nobody watches any more is a fact, not a mystery.** Jobs left
  `RUNNING` by a worker that no longer exists are settled at startup. Left
  alone, each one holds its pod's exclusivity for ever — that pod never beats
  again — and inflates every capacity reading built on it.

* **Bridges do not share a vocabulary.** `done`/`exit_code`, `response_complete`
  /`exit`, `result`/`is_error`. They live in one table, so a fourth CLI is one
  line rather than a branch in the flow.

* **A terminal answer is evidence, not disposable transport.** When a bridge
  includes its final text in the terminal event, the queue persists that text
  beside the exit code. `COMPLETED` without the answer forces the proof client
  to reconstruct history from a transient SSE stream and breaks
  order → action → log → answer after a restart.

* **Capacity is measured, never declared**, and three ways of getting it wrong
  were found by saturating: service time must exclude queue wait, orphans must
  be out of the sample, and the sample must be bounded to the present. Each
  error grew with load — worst exactly when the number is consulted.

* **Utilisation and backlog answer different questions.** ρ describes a
  sustained arrival rate and stays calm during a burst, correctly. `backlog`
  says when the queue clears. One question per number.

* **Width is decided from above.** A universe never widens itself: it publishes
  evidence, the parent decides (Rule 23 applied to resources). A child asking
  itself whether it deserves more is judge and party.

* **A task must be reviewable before it is sent**: no perimeter, no goal, no
  brief — refused. Half a task is refused too, because it looks framed and is
  not, and a reader stops checking.

* **The follower must never reject.** Subscribing before injecting is what stops
  a short run finishing before anyone listens; its cost is that a failed
  subscription rejects before anything awaits it, and an unhandled rejection
  ends the process. One unreachable bridge once took the whole queue down — the
  most critical brick in the control plane, killed by a dead address. An
  unreachable bridge is simply the case the design already names: unobservable.

* **Name the kind of blindness.** "No event stream" and "the bridge refused the
  connection" call for different actions; a generic reason sends the reader to
  the wrong place.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Dispatch, lanes and persistence are mechanical. Each job carries its own cognitive requirement — the queue never carries one on their behalf.
