# univ-base

## Objective

The canonical V1.10 reference universe. It proves the generic SHAPER base and
contains no catalogue product and no client workflow.

## Exact runtime

`vault`, `logger`, `queue`, `maestro`, `agent-runtime`, and exactly one selected
`bridge-*` (the reference selects `bridge-opencode`).

`agent-runtime` dispatches declared `task-*` entries. It does not read IMAP or
know business semantics. An IMAP universe adds catalogue `pkg-mail-agent` and
its own task/context declaration.

## Proof

Prove one declared task travels through Queue, the selected bridge, and Logger;
inspect the persisted queue record and correlated audit event from outside the
containers.
