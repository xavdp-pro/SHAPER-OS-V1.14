# The Seven Phases — The Process Spine

> **Audience:** any agent that knows *what* to do and needs to know *in what
> order*, and which rules bind right now.
> **Status:** index over [`software/RULES.md`](../../software/RULES.md). The
> rules are the law; the phases only tell you which of them are live at this
> moment.

The 49 rules have uniform binding force but they do not all apply at the same
time. Reading them as one flat wall is how an agent ends up applying a promotion
rule during exploration, or skipping a proof rule because it was in the same
paragraph as something already done.

These phases say *what must be true* at each point and *which rules bind*. They
do not carry the commands: those are in
[`RUNBOOK-EXPLICIT.md`](./RUNBOOK-EXPLICIT.md), and they are facts, not
derivations. Read them there rather than reconstructing them.

Seven phases, in order. **You are always in exactly one.** Each has a single exit
condition, and the exit condition is a fact, not a feeling.

---

## Phase 1 — Understand

**Purpose.** Load the frame before touching anything.

**You do.** Read [`LAW.md`](../../LAW.md), [`BOOT-CONTRACT.md`](./BOOT-CONTRACT.md),
[`PRINCIPLES.md`](./PRINCIPLES.md), the universe `INTENT.md` and its manifest,
then `software/RULES.md` in full. Identify your perimeter (P1 / P2 / P3).

**Binding now.** Rules 0, 0A, 0C, 0D, 6.

**Exit.** You can state, without re-reading: what this universe is for, what its
perimeter is, and which four to six invariants must never break.

**Wrong phase if.** You are editing files. Understanding produces no diff.

---

## Phase 2 — Authorise

**Purpose.** Establish what you may do, with what, and where.

**You do.** Confirm the granted perimeter. Identify the target host and the
isolation level (LXC, nesting). Verify every required secret is present,
non-empty, and not a placeholder — and halt for the human if one is missing.
Enumerate available engines, measure them from the target host, and select
against each brick's declared cognition ([`../COGNITION.md`](../architecture/COGNITION.md)).

**Binding now.** Rules 0H, 0J, 7, 9, 21, 24, 36.

**Exit.** Secrets verified, terrain identified, engine chosen **and the
measurement recorded**.

**Wrong phase if.** You are building images while a secret is still unverified.
A missing key discovered at container start costs an hour; discovered here it
costs a question.

---

## Phase 3 — Materialise

**Purpose.** Turn declared intention into running containers.

**You do.** One brick, one container. Start in the manifest's `bootOrder` groups.

**Image tags depend on the lifecycle, and this phase used to overstate it.** In
**DEV** you deploy what you just built locally, and a floating tag is the honest
way to say so. In **TEST and PROD** the tag is immutable: TEST proves a `v1.x.y`
and PROD deploys the tag TEST proved (Rule 0E, Rule 10). A tester followed the
DEV runbook, ran floating tags, and reasonably read this line as the repository
breaking its own law — it was this line being wrong, not the script. Generic bricks are
referenced and specialised, never copied.

**Binding now.** Rules 0B, 0E, 0I, 1, 2, 3, 4, 8, 11, 13, 26, 32, 33, 34.

**Exit.** Every container in the manifest is running on its declared tag, and
health is green — which proves the stack is **up**, and nothing more.

**Wrong phase if.** You are treating a green health endpoint as functional
proof. That belongs to Phase 4, and confusing the two is the most common failure
in this system.

---

## Phase 4 — Prove

**Purpose.** Establish, from outside the producer, that the system does the work.

**You do.** Units and contracts (`npm test`), then live tests once the stack is
up — never before. Then a real functional loop: a job through the queue, a
terminal state, a persisted answer, an artefact inspected **byte for byte** by a
controller that is not the agent that produced it, and an audit event correlated
with the job id.

**Binding now.** Rules 0G, 5, 18, 20, 23, 25, 28.

**Exit.** Evidence a third party can read without you: artefact, correlated log,
verdict. Not a transcript of your own confidence.

**Wrong phase if.** Your proof relies on the producer's self-report, or on shell
command substitution to compare bytes — `$(cat file)` strips trailing newlines
and will silently confirm a claim that is false. Use `cmp`.

---

## Phase 5 — Correct

**Purpose.** Convert every surprise into something the next agent inherits.

**You do.** For each incident: fix it, then ship the non-regression test that
fails on the unpatched code. Where the intention was wrong, correct the
`INTENT.md` — not only the code. Where an operational trap was found, write it
into the deployment contract. Bound your repair loop: exponential backoff, at
most five attempts on the same drift signature, then `DEGRADED` and escalate.

**Binding now.** Rules 27, 29, 35, 23.

**Where the fix goes.** In the generic path — the brick, the package, the
template, the example script — never only in the universe where it surfaced. A
`-test` universe is destroyed by Rule 10 and a `-dev` one is disposable, so a fix
written into an instance is deleted with it and the next clean sheet meets the
same wall. The test decides: if it would disappear with a universe, both the test
and the fix are in the wrong place (Rule 29).

**Exit.** No known defect without a test, no correction living only in your
context window, and no correction living only inside a universe.

**Wrong phase if.** You are about to write "it works now" anywhere.

---

## Phase 6 — Promote

**Purpose.** Move a proven state forward, immutably.

**You do.** Tag the proven commit. One canary child first, with bake time; a
canary is green only when a real deliverable passed its typed Rule 20 contract,
never because `/api/health` returned 200. PROD is updated **by tag** — never by
copying files from DEV, never by vibe on the live box. Data-bearing changes get
a snapshot first. Roll back down the hierarchy on failure.

**Binding now.** Rules 10, 20, 25, 30, 31, 33, 36.

**Exit.** Promoted on an immutable tag, or rolled back — with either outcome
recorded.

**Wrong phase if.** You are promoting a state that Phase 4 did not prove, or
recreating a data volume to make a deployment simpler.

---

## Phase 7 — Destroy

**Purpose.** Make the proof durable by making the prover disposable.

**You do.** Export sanitised evidence to the parent with checksums. Remove the
containers, then destroy the ephemeral universe — TEST, dev sandboxes, scratch
volumes, ephemeral routes. Keep Git and the exported evidence. Nothing else.

**Binding now.** Rules 10, 12, 16, 31, 36.

**Exit.** The ephemeral is gone and unrecoverable **by design**, and the record
survives without it.

**Wrong phase if.** You are keeping a TEST universe "just in case". A retained
TEST becomes a second DEV and stops proving recovery — which was its only job.

---

## The one-line version

> Understand before you may. Authorise before you build. Build before you claim.
> Prove before you promote. Correct before you forget. Promote by tag. Destroy
> what proved it.
