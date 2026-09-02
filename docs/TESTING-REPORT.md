# TESTING REPORT — how V1.13 was proven, by whom, and what it cost

> **Status**: dated snapshot — measurements of 29–31 August 2026 (§1–5) and
> of 2 September 2026 (§6–7). Model names here are data from those runs,
> never recommendations (Rule 7).

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
operator-side); the consolidated defect ledger runs **F1–F26**.

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
| 5 | v1.13.14 | Muse | Preflight gate green on first field use; **one regression** (F23: the vault-key halt crashed on its own message) → fixed in v1.13.15 |
| 6 | v1.13.15 | Muse | **Sealed** — "ZERO new workarounds; the sealing criterion is MET" |
| 7 | v1.13.17 | Muse | Sealed via a documented fallback; taught F24: the probe must be the contract, not an echo |
| 8 | v1.13.18 | Muse | **NOT sealed** — the referee's own untested probe failed every engine (F25) and the artefact path was ambiguous (F26); both fixes field-proven before publishing |
| 9 | v1.13.19 | Muse | **Sealed** — five checkpoints, the probe passed literally, zero workarounds |

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

**v1.13.19 — sealed.** 274/274 tests on a naked clone, verify 8/8, fleet
map pinned, nine sealing runs on record, 26 findings closed with their
tests. The late findings all came from sealing the sealers: the start line
became a mechanical gate, a halt learned to speak, Rule 7 grew two cursors
and its probe became the contract — and when the referee published an
untested probe, the next seal caught the referee. The claim at the top of
this page survived its adversaries, the referee included.

<a id="after-the-seal"></a>
## 6. After the seal — v1.13.20 to v1.13.34

**No sealing run took place after v1.13.19.** Everything below was proven by
the unit suite and `shaper verify` on the author's machine, and — for the
maker's recipes — by terrain runs the commit messages describe. None of it
was proven by a cold agent following the runbook literally. The suite counts
are measured on 2 September, on a checkout of each tag with its history
(the history-reading guards fail on a bare export); `shaper verify` was 8/8
at every tag.

| Date | Tag | What it brought | How it is proven |
| :--- | :--- | :--- | :--- |
| 31 Aug | v1.13.20 | This page's §2 and §5: seals 7–9, sealed at v1.13.19 | prose · 274 tests |
| 31 Aug | v1.13.21 | Doctrine n°9, *Direction is the boundary*: what holds power has no inbound door; what is reachable holds no power | prose; no code |
| 31 Aug | v1.13.22 | Doctrine n°10, *The system learns no dialect*: a component serving several variants reads a table, never branches on the variant | prose · 274 tests |
| 31 Aug | v1.13.23 | **The governor and the maker** — `pkg-governor` (the ledger contract: enrolment, desired state, idempotence, the poll as heartbeat) and `universes/_maker-template` (a poller that listens on nothing, frozen recipes, argv-only parameters); the naming guard learns that `_maker-template` is a mold | 288 tests (+14 in pkg-governor, 2 files) |
| 31 Aug | v1.13.24 | A machine has two names; enrolment binds host and fleet name. First recipe, `lxd-stamp` | governor-contract test; stamp terrain-proven per the commit |
| 31 Aug | v1.13.25 | `lxd-reap`: an end that is verified, not announced | recipe README; terrain-proven per the commit |
| 31 Aug | v1.13.26 | The governor's storage is injectable, as its intent already claimed (`createFileStorage`) | governor-contract test: restart and read back |
| 31 Aug | v1.13.27 | Two stamps of one digest raced on the import; per-digest lock | `stamp-recipe-lock` runs the real recipe twice against a shim `lxc` |
| 31 Aug | v1.13.28 | The HTTP door carries both names | `http-door-fleetname` speaks HTTP end to end |
| 31 Aug | v1.13.29 | A governor validates its child from facts, through the maker's hands: `lxd-validate`, the recipe's last JSON line as the event's facts | 302 tests (28 in pkg-governor, 6 files) |
| 31 Aug | v1.13.30 | A newborn is given time to open its eyes: validate waits for the child's first HTTP answer, bounded | `validate-recipe-waits`, shim-driven |
| 31 Aug | v1.13.31 | A degraded demo is not a wall: asking again reaps the broken row and births a fresh one | `validation` test |
| 31 Aug | v1.13.32 | The observation surface: `listMakers()` — presence, never power | 306 tests (32 in pkg-governor, 7 files) |
| 1–2 Sep | v1.13.33, v1.13.34 | The identity: the mascot opens the README, then fills the frame | no code · 306 tests |
| 2 Sep | *(untagged, on main)* | Doctrine n°11, *The maker and the governor* — the philosophy behind the contract, written after the contract was proven; then the operator's precision: a matrix is baked by the tandem, never by a robot | prose · 306 tests |

**What the governor arc is proven by.** 32 tests in seven files under
`software/packages/pkg-governor/test/`: `governor-contract` (16),
`validation` (6), `maker-poller` (4), `recipe-facts` (2),
`validate-recipe-waits` (2), `http-door-fleetname` (1), `stamp-recipe-lock`
(1). The recipe tests run the real `lxd-*.sh` against a shim `lxc` on `PATH`;
nothing is mocked inside the governor. One observation to carry forward: in
eight consecutive runs of the full suite on 2 September, `maker-poller`'s
*"form data reaches the recipe as argv, byte for byte"* went red once —
`RECONCILING` where `PURRING` was expected — because the test releases its
wait the moment the recipe was called, before the maker's report has reached
the governor. The code under test did nothing wrong; the test's clock is
ahead of the maker's. It is recorded here so that the next red is not
mistaken for a regression, and so that it gets fixed as a test defect.

<a id="the-2-september-audit"></a>
## 7. The 2 September audit

A cold reading of the repository at v1.13.34, by an agent with no memory of
the campaign, against the law it claims to obey. It found what the sealing
runs could not: the seals proved the runbook's path, and these defects sit
beside it. Listed soberly, without the fix; **every one of them is corrected,
each with a guard that fails on the unpatched tree (Rule 29), in the version
that follows this page.**

1. **A registry password tracked in a file the verifier never reads.** The
   check "no credential in tracked files" was green while a credential was
   tracked — invisible to `shaper verify` by the shape of its own scan.
2. **The master key archived beside the vault it encrypts.** A backup that
   carries both the ciphertext and its key is a plaintext with extra steps.
3. **Two families of ports.** The guide, the scripts and the bricks did not
   agree on which port a brick answers on; a reader could follow either and
   be right in one file and wrong in the next.
4. **Three tests never launched.** Guards that `npm test` did not look at —
   the same defect §4 records for `test-scripts-portability`, met again.
5. **Models named in the tree where Rule 7 says measured.** An engine pinned
   in a file is a recommendation the law forbids the repository to make.
6. **A Quick start that fails as written.** `cp .env.example software/.env`
   then `npm run vault:bootstrap` halted on the key the first command had
   just written, because nothing read the file; the build then halted on two
   variables no step had named. The one-click LXC guide could not run its own
   command (`scripts/` is `software/scripts/`, and `UNIV_SLUG` was never
   mentioned), and told the reader the opposite of what its script did on
   the host. The registry probe chose its scheme by the *presence* of
   `SHAPER_TLS_VERIFY`, so the runbook's own `false` meant `https`.
7. **Scripts that served no frame** (INTENT.md §16): two vault helpers still
   opened the shared storage path removed in V1.13.1; a universe factory
   wrote `apps/` and `quadlet/` for a grammar that no longer exists; the
   tool scaffold wrote a layer NAMING.md does not declare, a host state
   directory, and a test that asserted `true === true`.
8. **Nine field lessons absent from the tree.** Constraints learnt on
   terrain that lived in a commit message, a report, or an agent's context —
   and nowhere a future universe is built from (Rule 35).

What this audit adds to the method of §4: **a seal proves the path the
sealer walked.** The claim at the top of this page — a cold agent can
deploy from the repository alone — held for nine runs on the runbook's path
and said nothing about the README's, the guide's, or the scripts nobody ran.
A repository is read from every door, so every door gets its cold reader.
Measured on 2 September 2026, on a naked clone of the tree tagged
**v1.13.35** — eleven branches merged that day (secrets, ports and tests,
Rule 7, Rule 11, documented paths, two cleanup lots, the governor gestures,
the maker-and-governor doctrine after its adversarial pass, the law
amendments, the Rule 0 and single-copy residuals): **491 tests in 114 suites,
0 failures, verify 8/8**, and `git status` clean after the run. The number is
bounded by that tag and that clone; the next seal — a cold agent on the
runbook, the README and the guide, each door with its own reader — is what
turns it into a claim.
