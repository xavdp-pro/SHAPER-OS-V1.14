# Package: @shaper/pkg-agent-runtime

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Generic runtime for parameterized tasks — one `brick-maestro` image, many universe-defined task entries.

## 2. Invariants

1. **No business capability**: no IMAP, SMTP, CRM, customer or mailbox semantics.
2. **Context is a path parameter** (`ctx-*`), not a separate image.
3. Bridge-agnostic: agy, cursor, deepseek or opencode via `bridgeType` + `bridgeUrl`.
4. A task skips when `GET /api/health` fails — no inject on a dead bridge.

## 3. Why this is a package and not a brick

Until V1.11 a `bricks/brick-agent-runtime/` directory existed, carrying an
`INTENT.md` and a Quadlet unit — but no `Containerfile`. Nothing built it and
nothing ran it, because there was nothing to run: this is a dispatch library,
and it executes **inside `brick-maestro`'s image**, which vendors it at build
time. A `brick-` directory that no `podman build` can turn into an image is a
naming claim the repository cannot honour, and an agent reading the tree would
plan a container that will never exist. The layer contract is enforced now:
every `brick-*` ships a `Containerfile`.

## 4. Cognition

> Scales and semantics: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: heavy-engineering
- **role**: requires
- **depth**: D3
- **throughput**: T2
- **degraded**: queue
- **rationale**: Executes assigned tasks end to end and must judge when its own output satisfies the typed contract (Rule 20). Ambiguity resolution is the job, so depth cannot be lowered; latency is not user-visible, so it queues rather than degrading.
