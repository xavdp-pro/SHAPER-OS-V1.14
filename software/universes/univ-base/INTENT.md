# univ-base

> **Intent Classification**: SPECIFIC INTENT (Universe: `univ-base`)

## Objective

The canonical V1.11 reference universe. It proves the generic SHAPER base, and
it contains no catalogue product, no client workflow and no public name. If this
universe does not come up, nothing built on top of it will — which is its whole
job.

## Exact runtime — five bricks

| Brick | Why it is here |
| :--- | :--- |
| `brick-vault` | Holds the secrets this universe, and only this universe, may read |
| `brick-logger` | Keeps the append-only evidence that each step actually happened |
| `brick-queue` | Persistent work ledger, so nothing is lost between a decision and its execution |
| `brick-maestro` | Paces the declared `task-*` entries and hands each beat to the queue |
| `brick-bridge-opencode` | The one AI engine this universe may spend work on |

Five, not six. `agent-runtime` is `@shaper/pkg-agent-runtime`, a dispatch library
vendored **inside `brick-maestro`'s image**. It carried a `brick-` prefix until
V1.11 with no `Containerfile` behind it, which promised a container that no
`podman build` could ever produce.

`pkg-agent-runtime` dispatches declared `task-*` entries to the selected bridge.
It does not read IMAP and knows no business semantics. A universe that triages
mail adds catalogue `pkg-mail-agent` and declares its own `task-*` — and by doing
so it stops being `univ-base`.

## What a task must carry

A `slug`, and a cadence. Nothing else is required. Until V1.11 the scheduler
demanded a `label` and a `port` — a monitored mailbox and its container port,
renamed but not removed — and this universe's own `task-schedule.json` was
rejected by the scheduler shipped beside it.

## Proof

`bash deploy/proof.sh`. It shows that every declared brick answers, that the
declared task is held by the cadence registry, and that the logger holds
evidence rather than a heartbeat. Rule 33: a deployment nobody proved is a claim.
