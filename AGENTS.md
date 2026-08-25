# AGENTS.md — Entry Point for AI Agents

You are operating **SHAPER OS**: a sovereign operating system of standardised
bricks, where a human writes intentions in Markdown and AI agents build and
operate the running system.

You execute *this* repository. You do not invent a second architecture, and you
do not soften the law to make your task easier.

---

## 1. Take the reading that matches you

The corpus is large. Reading it in the wrong order is why an agent ends up
improvising. Pick your row, read it in full, then act.

| If you are | Read, in this order | Then |
| :--- | :--- | :--- |
| **A high-abstraction model** — you can hold a system in one context and derive consequences from principles | [`docs/agent/BOOT-CONTRACT.md`](./docs/agent/BOOT-CONTRACT.md) → [`docs/agent/PRINCIPLES.md`](./docs/agent/PRINCIPLES.md) → [`docs/agent/PHASES.md`](./docs/agent/PHASES.md) | `software/RULES.md` in full, then act by derivation — and stop the moment a derivation contradicts a rule |
| **↳ and then, whatever your class** | [`docs/agent/RUNBOOK-EXPLICIT.md`](./docs/agent/RUNBOOK-EXPLICIT.md) for the concrete commands | **Commands are facts, not derivations.** Reading them is not a downgrade; inventing them is a defect |
| **A fast or light model** — high throughput, short context, or a task that must not be improvised | [`docs/agent/BOOT-CONTRACT.md`](./docs/agent/BOOT-CONTRACT.md) → [`docs/agent/RUNBOOK-EXPLICIT.md`](./docs/agent/RUNBOOK-EXPLICIT.md) | Follow the literal steps. If a situation is not written there, **stop and ask** |
| **An IDE agent paired with a human** (Claude Code, Cursor, Codex, Antigravity…) | [`docs/agent/BOOT-CONTRACT.md`](./docs/agent/BOOT-CONTRACT.md) → [`START-HERE.md`](./docs/human/START-HERE.md) → [`KEYS-AND-ACCOUNTS.md`](./docs/human/KEYS-AND-ACCOUNTS.md) | Ask the human for missing keys, never invent them |

Whatever your row: **the binding text is
[`software/RULES.md`](./software/RULES.md)** — 48 rules, read in full, never
summarised. Principles and phases are indexes over it, never substitutes for it.

Reading only your row is enough to start correctly. Reading everything is still
worth it — that is how you stop being an agent that executes and start being one
that can be trusted with the next decision.

---

> ## ⚠ Asked to beta-test rather than to operate?
>
> **Stop and read the matching protocol before you run anything.** Both change
> what you are supposed to do when something breaks.
>
> | You were asked to | Read first |
> | :--- | :--- |
> | **Deploy this and tell us how it went** | [`docs/agent/BETA-DEPLOYMENT-TEST.md`](./docs/agent/BETA-DEPLOYMENT-TEST.md) |
> | **Evaluate the documentation** without deploying | [`docs/agent/COLD-READ-TEST.md`](./docs/agent/COLD-READ-TEST.md) |
>
> Two things they both establish, stated here so you cannot miss them:
>
> 1. **You cannot fail these tests — only the repository can.** If you are
>    blocked, if you have to guess, if a human has to explain something to you,
>    that is the result being measured. We failed to formulate it. Report it
>    plainly; there is no incident too small.
> 2. **Do not fix, do not fork, do not send a patch.** Report the defect and any
>    workaround you needed, and stop there. A correction made in your clone dies
>    with it, hides the shape of the defect, and makes every tester's repository
>    diverge — which has already happened here. We correct on our side, in the
>    generic path, where it survives (Rule 29).
>
> A cold read is also spent by a briefing: if you were asked to evaluate the
> documentation, do not accept an explanation before you start.

---

## 2. The four texts that bind you

| File | Force |
| :--- | :--- |
| [`software/RULES.md`](./software/RULES.md) | The canon. 48 rules. Uniform binding force. |
| [`LAW.md`](./LAW.md) | What is never skipped, in one page. |
| [`docs/agent/BOOT-CONTRACT.md`](./docs/agent/BOOT-CONTRACT.md) | What you may do, and when you must stop. |
| The universe `INTENT.md` + `manifest.json` | This specific universe's objective and shape. |

Everything else — principles, phases, runbook, doctrine — helps you *understand*
and *find*. It never grants permission.

---

## 3. Where you are

```
SHAPER-OS-V1.8/
├── README.md                ← human door (5 levels)
├── AGENTS.md                ← you are here: agent door
├── LAW.md                   ← what is never skipped, one page
├── INTENT.md                ← the kit's own intent and invariants
├── docs/
│   ├── agent/               ← BOOT-CONTRACT · PRINCIPLES · PHASES · RUNBOOK-EXPLICIT
│   ├── architecture/        ← BRICKS · COGNITION · FRACTAL-ARCHITECTURE-AND-SECURITY
│   └── human/               ← START-HERE · PROOF · LIFECYCLE · CONCEPTS · GLOSSARY · KEYS…
├── doctrine/                ← the master corpus (canonical, single copy)
├── examples/                ← templates to copy into a universe
├── software/                ← packages, bricks, scripts, schemas — and RULES.md
└── <univ_slug>-dev/         ← the universe you create
```

```bash
ls software/packages   # empty or missing → STOP. You are not in the monorepo.
```

Never copy `packages/` or a brick `Containerfile` into a universe folder.

---

## 4. Before anything runs

- The first install is **DEV**, whatever anyone calls it.
- A missing or placeholder secret is a **halt**, not a warning.
- A green health endpoint proves the stack is **up**. It never proves that work
  happened.
- Every fix ships its non-regression test, in the same commit.
- When asked for a diagnosis, change nothing.

Full contract, with the twelve statements and the forbidden list:
[`docs/agent/BOOT-CONTRACT.md`](./docs/agent/BOOT-CONTRACT.md).

---

## 5. Choosing your engine

Each brick declares the reasoning depth and the throughput its work requires, and
what it does when neither is available:
[`docs/architecture/COGNITION.md`](./docs/architecture/COGNITION.md).

Published benchmarks are advisory. **Measured availability from the target host
decides.** Record the measurement with the choice.

---

## 6. Where the system currently stands

Principles describe how it must behave. To learn what it has actually been proven
to do, read the most recent verdict under
`software/universes/*/proof/VERDICT.md`, then
[`docs/human/PROOF.md`](./docs/human/PROOF.md). A verdict states what was tested,
on which commit, and what failed on the way — including the attempts that were
rejected. Trust it over any summary, including this one.

---

## 7. Done

[`PROOF.md`](./docs/human/PROOF.md) satisfied, live tests green, evidence readable by
someone who was not in the room. On failure: stop and show the error, unedited.
