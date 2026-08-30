# TESTING REPORT — how V1.13 was proven, by whom, and what it cost

> **The claim under test.** SHAPER OS says a cold agent — any engine, any
> model, no prior context — can deploy a universe by reading this repository
> alone. That claim is only worth what an adversarial campaign says it is.
> This page is the record: every kind of test run against V1.13, why each
> protocol choice was made, and the results, with their sources. Every figure
> here comes from a report file or a command output; none from memory.

## 1. The deployment campaign — 14+ cold agents against the docs

**Protocol.** One tester at a time, in a fresh Debian 13 LXC on the test
host, working only over SSH from its own harness. Identical brief:
*"Deploy this and tell us how it went"* — repository URL, frozen tag, the
registry question pre-answered (an operator ruling: the podman registry is
per-machine infrastructure; an agent that does not know it ASKS). Testers ran
in **report-only mode**: they fixed nothing, recorded every wall verbatim,
and the fixes were made together afterwards, each climbing back into the
generic path with its Rule 29 test. *You cannot fail the test — only this
repository can.*

**Who ran.** Claude Code (Fable, Opus, Sonnet 5, Haiku 4.5), Cursor
(Composer 2.5, Grok 4.6, Sol, Terra, Luna), Antigravity (Gemini), opencode
free models (nemotron), and Muse Code (Meta's CLI, muse-spark-1.2). Full
reports live in the campaign workspace (`ZEST5-BETA/report-*.md`,
operator-side); the consolidated defect ledger runs **F1–F22**.

**What it found.** The software under the docs was solid from day one
(all tests green on a naked clone, honest halts on missing keys — Rule 0J
held cold for every model). The **documented path** was the broken part:
an undocumented registry prerequisite, three rival image-naming conventions,
a proof script that said "proven" on an empty audit trail (Rule 0G broken in
its own machinery), a shared vault, empty vault keys the literal steps never
filled, an OCI manifest served as a false 404, a queue lane a silent stream
could hold forever. Each finding was fixed in the generic path with a test
that fails on the unpatched code; the version ladder v1.13.0 → v1.13.12 is
that history, one honest step at a time.

## 2. The sealing runs — "is there anything LEFT?"

A release is *sealed* when a cold agent following the runbook **literally**
needs **zero new workarounds**. Sealing runs used virgin per-run image tags
(`v1.13.X-seal-<agent>`) so an ex-nihilo build is proven by facts — tag
absent before, present after, digests servable — never by a stopwatch
(Rule 10: a duration is an observation, not a criterion; this repository once
carried an unmeasured "45 minutes" and the real figure on the reference host
was ~58 seconds).

| Seal | Tag | Agent | Verdict |
| :--- | :--- | :--- | :--- |
| 1 | v1.13.9 | Muse | **NOT sealed** — 3 documented-path workarounds → fixed in v1.13.10 |
| 2 | v1.13.10 | Muse | **Sealed** — "zero new workarounds required" |
| 2b | v1.13.10 | Haiku 4.5 | **Sealed** — zero workarounds, counter-verified at the registry |
| 3 | v1.13.11 | Muse | Repository clean; **one runtime defect** (F22: a hung run froze the queue) → fixed in v1.13.12 |
| 4 | v1.13.12 | Muse | **Sealed** — all four proofs served, watchdog verified in the field |

Every seal was counter-verified from outside the tester: registry tags,
terrain cleanliness, report-vs-ledger cross-checks. One tester's earlier
claims did not survive that audit (inverted timestamps, a brick count of 14
where 9 exist) — which is why counter-verification is part of the protocol,
in both directions: the auditor's own unmeasured figure was the gravest
error of the campaign, and it is retracted in the v1.13.8 history.

## 3. The quality bench — code, tests, and time, judged mechanically

The campaign measured reading; the bench measured **writing**. Three real
open defects from tester reports (T1: the live test abandoned an eternally
PENDING job; T2: the vault bootstrap accepted a documentation placeholder as
a master key; T3: proofs #2/#3 — artefact existence and byte-exact `cmp` —
were "yours to perform by hand"). Each candidate got a fresh clone of
v1.13.10, the defect quoted verbatim, and Rule 29 quoted verbatim. The
arbiter first wrote a private reference solution per task (proving
feasibility and calibrating diff size), then graded a 100%-mechanical grid:
*the test fails on unpatched code* (30, blocking), passes on patched (10),
full suite green (20), `shaper verify` green (10), the defect demonstrably
gone under an arbiter probe (20), diff ≤ 2× reference (5), the constraint
written into an INTENT when doctrinal (5). Self-declared results counted for
nothing; time was recorded wall-to-wall and **never graded**.

| # | Candidate | T1 | T2 | T3 | Total /295 | Wall time |
| :- | :--- | ---: | ---: | ---: | ---: | ---: |
| 1 | Claude Opus | 95 | **100** | 95 | **290** | 1711 s |
| 2 | Cursor Grok 4.6 | 95 | 95 | 95 | 285 | 618 s |
| 3 | Muse Spark 1.2 | 95 | 95 | 90 | 280 | **440 s** |
| 3 | Cursor Composer 2.5 | 95 | 95 | 90 | 280 | 519 s |
| 3 | Claude Sonnet 5 | 95 | 95 | 90 | 280 | 1370 s |
| 6 | Claude Haiku 4.5 | 0 | 95 | 90 | 185 | 489 s |

Readings the numbers support: **Opus** is the quality ceiling — the only
candidate to write constraints into INTENT files (Rule 35), and it
independently rediscovered and documented both traps the arbiter had met
writing the reference meta-test. **Grok** and **Muse** are the
time-to-quality line; **Composer** is the sprinter on well-framed tasks
(56–64 s each). **Haiku** scored 0 on the open-ended task (no Rule 29 test,
a sleep-based fix needing a live worker) and 95 the moment the brief named
the file and the behaviour — the "fast model on rails" line of AGENTS.md is
now a number. Nobody, the reference included, held diff sobriety on the
open-ended T3. The Gemini leg runs operator-side and will be appended.

**The bench produced real code.** The winning fixes were merged with
attribution in their commits (T1: Grok; T2 and T3: Opus) as v1.13.11 — and
the very next sealing run exercised Opus's merged proof standard in the
field: byte-exact artefact, `cmp` exit 0, all four proofs served.

## 4. Why these choices

- **Report-only testers**: a tester who fixes hides the defect from the next
  tester; the repository is the only thing allowed to fail.
- **Virgin tags + fact-based proofs**: shared tags once made one tester's
  claim unprovable; stopwatch proofs once put a 45× lie into the law.
- **One tester at a time, artifact-watched**: harnesses freeze silently;
  watch the container being born, never the process.
- **Mechanical grading + arbiter counter-verification**: self-declaration
  deceived this campaign twice. The instrument gets corrected, never the
  copy — one probe was fixed mid-bench when it judged a type name instead of
  the outcome, and both affected candidates were regraded identically.
- **Fixes ship their failing test (Rule 29), constraints climb into INTENT
  (Rule 35)**: the tree must remember. The suite grew 240 → 262 tests over
  the campaign; `shaper verify` stayed 8/8 throughout.

## 5. State at close

**v1.13.12 — sealed.** 262/262 tests on a naked clone, verify 8/8, fleet
map pinned, four sealing runs on record, 22 findings closed with their
tests. The claim at the top of this page survived its adversaries.
