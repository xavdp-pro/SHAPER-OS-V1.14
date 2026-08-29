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

**If two rows describe you, take the lower one.** A capable model paired with a
human matches both the high-abstraction row and the IDE-paired row, and a tester
had to choose without being told. The rule is: the row that assumes *less* wins,
because the cost of reading literal steps you did not need is minutes, and the
cost of deriving something you should have read is a defect nobody notices.

Whatever your row: **the binding text is
[`software/RULES.md`](./software/RULES.md)** — 49 rules, read in full, never
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
> 2. **Go all the way, and hand us the fix inside the report.** Reproduce the
>    defect, correct it in your clone, and prove it with a test that fails on the
>    unpatched code — then give us the diff and that test as part of your report.
>    What we ask you not to do is push to a shared branch, open a fork, or fix
>    silently: a correction placed in a clone dies with it, and parallel pushing
>    diverges every repository, which has already happened here. We commit it
>    where it survives (Rule 29). **The report is the deliverable** — a test
>    deployment that leaves a working stack and no report produced nothing.
>
> A cold read is also spent by a briefing: if you were asked to evaluate the
> documentation, do not accept an explanation before you start.

---

## 2. The four texts that bind you

| File | Force |
| :--- | :--- |
| [`software/RULES.md`](./software/RULES.md) | The canon. 49 rules. Uniform binding force. |
| [`LAW.md`](./LAW.md) | What is never skipped, in one page. |
| [`docs/agent/BOOT-CONTRACT.md`](./docs/agent/BOOT-CONTRACT.md) | What you may do, and when you must stop. |
| The universe `INTENT.md` + `manifest.json` | This specific universe's objective and shape. |

Everything else — principles, phases, runbook, doctrine — helps you *understand*
and *find*. It never grants permission.

---

## 3. Where you are

```
SHAPER-OS-V1.13/
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

Before adding a package or brick, read
[`docs/architecture/ARTIFACT-BOUNDARY.md`](./docs/architecture/ARTIFACT-BOUNDARY.md).
It decides whether the behaviour belongs in SHAPER OS or in the catalogue, and
how a declared dependency becomes physical only inside an OCI image.

Before creating or changing an `univ-*`, read
[`docs/agent/UNIVERSE-DESIGN-QUESTIONS.md`](./docs/agent/UNIVERSE-DESIGN-QUESTIONS.md)
and [`docs/architecture/NAMING.md`](./docs/architecture/NAMING.md). If the
universe is extended or bound for production, it is born in **its own
repository** — [`docs/agent/UNIVERSE-REPO-BIRTH.md`](./docs/agent/UNIVERSE-REPO-BIRTH.md)
is the birth procedure, and this repository stays upstream, touched only when
an incident climbs back. Answer every
question from repository evidence. If an answer is absent or contradictory,
stop and report it; do not invent architecture.

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

## 4b. Which configuration are you building?

Starting sets have names: `passive`, `agent`, and options that attach to either
(`+documents`, `+data`, `+web`, `+public`, `+parent`). They are defined in
[`docs/architecture/UNIVERSE-PROFILES.md`](./docs/architecture/UNIVERSE-PROFILES.md).

If the human named one, build exactly that. **If they named none, the default is
`agent`** — vault, logger, bridge, queue, maestro, and no cockpit. Two agents once
received the same words, "the base universe", and built different things; naming
it is what ended that.

Write the name into the manifest's `profile` field: a test checks that what you
declared is what you built.

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
[`docs/human/PROOF.md`](./docs/human/PROOF.md). What changed in this release,
gesture by gesture, is [`docs/V1.13-GENESIS.md`](./docs/V1.13-GENESIS.md);
the language it sealed is [`docs/architecture/LEXICON.md`](./docs/architecture/LEXICON.md). A verdict states what was tested,
on which commit, and what failed on the way — including the attempts that were
rejected. Trust it over any summary, including this one.

---

## 7. Done

[`PROOF.md`](./docs/human/PROOF.md) satisfied, live tests green, evidence readable by
someone who was not in the room. On failure: stop and show the error, unedited.

---

<a id="documentation-is-a-map"></a>
## Documentation is your map, so it is held to a map's standard

Every relative link between files in this repository resolves. A link that
points at nothing sends you looking for a file that does not exist, and it will
keep doing so forever, because a broken link fails silently — nobody follows a
link to check that it works.

*Why this is written here.* Two links in the documents you are told to read
first pointed at `docs/pkg-agent-runtime/`, a directory that never existed: a
global rename reached inside link targets and nothing noticed for a release. You
are the reader who pays for that, and you have no way to tell a missing file
from your own mistake.
