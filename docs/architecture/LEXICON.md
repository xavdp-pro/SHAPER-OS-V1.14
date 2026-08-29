# LEXICON — the language of the tree, on one page

> **Status**: sealed by [Rule 37](../../software/RULES.md#rule-37). A new noun
> enters only by amending that rule, with the failure it prevents written
> beside it. Born in V1.13 from the ZEST convergence: five archetype designs,
> three adversarial critiques, every synonym killed.

## The three grammar rules (they held at every scale)

1. **`univ-<projet>-<classe>`** — projet is ONE word, no hyphen. A single-class
   project takes `-core`. Parse: `^univ-[a-z0-9]+(-[a-z0-9]+)+$`.
2. **Position lives in data, never in the slug** — LINEAGE.md, manifest,
   ledger. *The identifier says WHAT a thing is; structured data says WHENCE
   it comes and WHERE it sits.*
3. **A class has a repo; an instance never does** — an instance is a ledger
   row + a vault + volumes.

## The prefixes (existing law, unchanged — Rule 1 + [NAMING.md](./NAMING.md), the canonical table)

`univ-` `brick-` `pkg-` `img-` `ctr-` `vol-` `cfg-` `ctx-` `task-` `proof-`
— a new brick is **not** a new noun: `brick-forge`, `brick-scraper`,
`brick-sso` are the prefix system doing its job.

## The twelve words

| Word | One sentence |
| :--- | :--- |
| **class** | A universe model: one git repo, versioned, tagged (`univ-boutik-shop`) |
| **instance** | One materialisation of a class: ledger row + vault + volumes — never a repo |
| **ledger** | THE desired-state table: one row per instance (class, tag, machine, env, state, bucket) in the governing universe's database. *The only allowed name — "placement" survives only as the machine column* |
| **drift** | Any gap between the ledger and what actually runs — the sole repair trigger (Rule 27 governs the ladder) |
| **PURRING** | The **dated** healthy state written on every on-time beat when observed == desired. One state machine everywhere: `DESIRED → RECONCILING → PURRING → DEGRADED` (DEGRADED is terminal, never self-clears) |
| **status.json** | The canonical per-instance surface (state + lastPurr + lastBackup). Every board, tile or STATE file is a rendering of it, never a rival |
| **board** | THE fleet view: one line per ledger row, all machines. Terminal twin `shaper board`. Offline, `cat fleet.yml` tells you what SHOULD exist — health only ever comes from status.json |
| **fleet map** | The `fleet.yml` in a `<scope>-fleet` repo: base, catalogue, classes pinned to immutable tags, plus machines. Never instances. `-dev` bypasses it; `-test`/`-prod` are guarded by it |
| **forge** | `brick-forge`: the single organ that deploys/destroys/repairs (LXC, podman, escalation restart → rebuild → redeploy + R2) |
| **forkedFrom** | The lineage proof, at both levels: brick `{package, atVersion}`, repo `{repo, atTag}` — machine-checkable |
| **mirror rule** | A Rule 33 fork swaps the projet word and NOTHING else: `univ-boutik-shop → univ-fortex-shop`. A fork costs zero vocabulary |
| **source / perimeter** | Brick fields: `source ∈ {base, catalogue, fork, native}`; `perimeter ∈ {P1, P2, P3}` = **LAYER, never OWNER** |

## The six verbs (one dialect, one target grammar)

Only `verify` is **BINDING** today — its real invocation is
`node software/packages/pkg-verify/verify.mjs [--root <repo>]`. The other five
are **TARGET**: the contract is sealed here so five dialects never grow back,
and the tool arrives with `brick-forge`.

```
shaper new <class>             # TARGET — birth: LINEAGE first, fleet.yml PR automatic
shaper verify [--root]         # BINDING — the executable law, identical everywhere
shaper deploy <slug>-<env> [--on <machine>]    # TARGET
shaper snapshot / restore <slug>-<env>         # TARGET
shaper pra                     # TARGET — clone the fleet map → redeploy at tags → data from R2
shaper board                   # TARGET — is everything purring?
```

Killed in critique: `subscribe` (a P3 app action, not a fleet verb),
`new-instance`, bare-owner addressing (`deploy dupont`).

## The page test

A human juggling four vibecoded projects, or an agent landing cold, must
answer from THIS page alone: *where is the truth?* (the ledger) — *who
repairs?* (the forge, on drift) — *is everything fine?* (the board, rendering
status.json) — *how is it all recreated?* (`shaper pra`: fleet map + R2,
Rule 16). A proposal that does not fit this page does not enter the language.
