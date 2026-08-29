# Cognition Requirements — Declaring the Intelligence and Speed a Brick Needs

> **Authority on engine selection.** Rule 0H and Rule 7 defer to this file: the
> canon states *how* an engine is chosen and never *which* one. Naming a model in
> a rule dates the rule — that is not a hypothesis, it is what happened to
> Rule 0H, which recommended a two-generation-old model as its top tier while the
> principle forbidding exactly that was being written.
>
> **Extends** Rule 21 (Distributed Multi-Agent Delegation Matrix — Abstract
> Capacity Classes) down to the individual brick, and adds the throughput
> dimension.
> **Status:** declarative. There is **no automatic router today**; engine choice
> remains human-arbitrated (Rule 0H). This file defines the data a router would
> read, so that the day it exists it has something true to read.

## Why this exists

Model capability moves. In six months the fastest engine, the cheapest engine and
the strongest engine will all be different products. A system that hardcodes
*which model* is obsolete on that day; a system that declares *what the work
requires* is not.

So a brick never says "use model X". It says: **this is the reasoning depth my
work needs, this is the throughput order of magnitude it needs, and this is what
I do when neither is available.** Matching requirement to engine is a separate,
replaceable decision.

---

## Axis 1 — Capacity class (what kind of work)

Rule 21's existing vocabulary. Unchanged, vendor-agnostic:

| Class | Work |
| :--- | :--- |
| `heavy-engineering` | High-reasoning architecture, multi-file refactoring, autonomous code generation |
| `rapid-iteration-ui` | Interactive GUI components, visual refinement |
| `infra-ops` | Vulnerability scans, system administration, container orchestration |
| `fast-eval` | Streaming acknowledgments, low-latency text classification |

A class whose engine needs a human at the keyboard is declared `interactive: true`
and is never auto-dispatched (Rule 21).

## Axis 2 — Reasoning depth (how much intelligence)

| Depth | The work requires | Typical of |
| :--- | :--- | :--- |
| `D0` | No model at all. Deterministic code. | Health probes, checksum verification, boot order |
| `D1` | Literal transformation: extract, classify, format, follow an unambiguous step | Log tagging, field extraction, acknowledgment text |
| `D2` | Procedural work: multi-step tool use, follow a written runbook, fix a failure whose cause is already stated, write a test from a template | Standard deployment, routine brick operation |
| `D3` | Derivation: infer the action from principles, resolve conflicting evidence, plan across a whole universe, decide what proof is sufficient | Clean-sheet TEST, incident diagnosis, parent-side repair |
| `D4` | Architecture: change the law or the intent, design taxonomy, decide cross-universe promotion | Doctrine work — **human co-signature required** (Rule 24) |

`D4` is never dispatched autonomously, whatever the engine's capability.

## Axis 3 — Throughput (how fast, order of magnitude)

Orders of magnitude, not benchmarks. What matters is the class, not the number.

| Tier | Recommended | Interaction budget | Typical of |
| :--- | :--- | :--- | :--- |
| `T0` | ≳ 500 tok/s | Instant, sub-second | Voice acknowledgment, micro-tasks. Reserved — never a general chat engine (Rule 0H) |
| `T1` | ≳ 50 tok/s, first token < 1 s | Conversational | Cockpit chat, operator interaction |
| `T2` | ≳ 10 tok/s | Minutes acceptable | Background jobs, queued work |
| `T3` | Any | Hours acceptable | Batch, offline analysis, bulk ingestion |

## Axis 4 — Context horizon (how much history the work needs)

Depth and throughput describe the thinking. They say nothing about **how far back
the work has to see** — and that turns out to separate two agents far more than
their raw capability does.

| Horizon | The work needs | Typical of |
| :--- | :--- | :--- |
| `H0` | Nothing but its own input | Classification, extraction, acknowledgment |
| `H1` | The current session | A conversation, a deployment run |
| `H2` | The state of this universe | Diagnosis, repair, a decision about this system |
| `H3` | The operator's accumulated usage — months of prior exchanges | Advice about direction, recognising a pattern the operator has lived through |

This axis exists because of an asymmetry the operator meets daily, not because of
theory. The same human talks to a **conversational assistant** — which carries
`H3`, the long history of everyday use — and to a **task-scoped engineering
agent** — which lives at `H1`/`H2`, sharp on the present work and blind to
anything not in front of it. They are as different from each other as two vendors
are, sometimes more.

The friction is that **the human uses both the same way.** They do not switch
register when they switch surface, and they should not have to. So the
declaration belongs to the work, not to the person: a job that needs `H3` must be
sent somewhere that has `H3`, and a job that only needs `H0` must never be
charged for a horizon it will not use.

A brick that requires a horizon it cannot be given must say what it does about
it, exactly as with depth and throughput — `refuse`, `queue`, or run and record
the limitation. An answer given at `H1` to a question that needed `H3` is not
wrong in form; it is confident and under-informed, which is worse.

## Axis 5 — Degradation policy (what happens when you cannot have it)

You work with what is available. That is a fact, so it must be a **declared
decision**, not an accident:

| Policy | Meaning |
| :--- | :--- |
| `refuse` | The brick must not run below its declared requirement. Failing loudly is correct. |
| `queue` | Wait for a qualifying engine. The job is parked as `AWAITING_CAPACITY`, the human is told. |
| `allowed-with-note` | Run anyway, and record the degradation as an audit event so the result is never mistaken for a nominal one. |

A brick that runs degraded **silently** is a Rule 0G violation: the output looks
like nominal output and nothing in the record says otherwise.

---

## The declaration

In the brick's `INTENT.md`:

```markdown
## Cognition
- capacity-class: infra-ops
- depth: D2
- throughput: T2
- horizon: H2
- degraded: queue
- rationale: Deploys and supervises containers from a written contract; no
  ambiguity to resolve, no interactive latency requirement.
```

In `manifest.json`, per brick (optional, overrides the brick default for this
universe only — Rule 6 of the [principles](../agent/PRINCIPLES.md): specialise,
never fork):

```json
"bricks": {
  "brick-queue": {
    "source": "base",
    "perimeter": "P1",
    "package": "@shaper/pkg-queue",
    "image": "img-queue",
    "intent": "./software/bricks/brick-queue/INTENT.md",
    "role": "Async work ledger for this universe",
    "cognition": {
      "capacityClass": "infra-ops",
      "depth": "D2",
      "throughput": "T2",
      "horizon": "H2",
      "degraded": "queue"
    }
  }
}
```

---

## The measurement law

> **Published throughput is advisory. Measured availability from the target host
> is mandatory.**

This is not a preference; it was learned. During the v1.7 clean-sheet TEST the
publicly fastest free model timed out twice from inside the LXC, a second one
returned a provider error, and the third — slower on paper — returned a bounded
marker in about 8.5 seconds and completed the real job. The selection was made on
what answered, not on what was ranked.

Therefore, at every deployment: enumerate the engines actually reachable, send a
bounded ping, measure, then choose the cheapest engine that satisfies the
brick's declared `depth` and `throughput`. Record the choice and the measurement
in the deployment log — a model chosen without a recorded measurement is an
undocumented dependency.

**When several candidates cost the same — which is the normal case on a free
tier — take the fastest one you measured.** Not the fastest advertised: tokens
per second observed from this host, on a bounded prompt, timed. The ranking a
vendor publishes describes their infrastructure on a good day, not the path
between your container and their endpoint.

Concretely, on the default free tier:

```
1. opencode models                 → what is actually reachable from here
2. for each candidate: a bounded prompt, timed → measured tok/s and time to
                                     first token, or a timeout, which is an answer
3. keep those that satisfy the brick's declared depth
4. among them, take the highest measured throughput
5. write the winner, its number, and the moment of measurement into the log
```

A candidate that times out is not slow, it is **absent** — record it as such, so
the next deployment does not spend its budget rediscovering the same silence.

---

## Where concrete engine names are allowed to live

Nowhere that git tracks as prescriptive. Names belong to the **measured runtime
matrix**, produced at each deployment and never committed:

| Text | Kind | May name an engine version |
| :--- | :--- | :--- |
| `RULES.md`, `LAW.md`, `INTENT.md`, brick and package intents, `docs/` | Prescriptive — binds future behaviour | **No** |
| A proof or a `VERDICT.md` | Descriptive — records what actually answered, on a date | **Yes, and it must** |
| A doctrine survey that declares itself a dated snapshot in its opening lines | Descriptive | **Yes** |
| The measured runtime matrix (untracked, regenerated at deploy) | Operational state | **Yes** |

The distinction is enforced, not merely stated: the repository suite fails if a
prescriptive text names a model version
(`software/packages/pkg-logger/test/canon-names-no-model.test.js`). A
document opts out by declaring itself a dated snapshot **in the first lines a
reader sees**, never by an exception hidden in the test.

The matrix records, per engine: reachability from the target host, measured
throughput and time to first token, cost class, and the moment of measurement.
That is what the deployment reads, and what an eventual router would read.

## What this deliberately does not do

It does not route. No component reads these fields to dispatch work today, and
none should be added without its own intent, tests, and proof. The declaration
comes first and is useful on its own: it tells a human — and any agent — why a
brick is failing when the only engine on hand is too weak or too slow for it.
