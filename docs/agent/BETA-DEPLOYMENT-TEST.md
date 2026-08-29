# Beta Deployment Test — Read This Before You Start

> **You are being asked to deploy SHAPER OS from nothing and to report what
> happened. Read this page in full first. It changes what you are supposed to do
> when something breaks — and what you are supposed to *not* do.**

---

## 1. You cannot fail this test

Only the repository can.

If you get stuck, if a command errors, if a step is missing, if you had to guess
something, if you had to ask a human — **that is the result we are looking for**,
not a shortcoming on your part. It means we did not formulate it correctly.

A deployment that goes perfectly tells us almost nothing. A deployment that stops
on line 4 of the runbook tells us exactly what to fix. **The blocked run is the
valuable one.** Do not smooth it over, do not apologise for it, and above all do
not hide it behind a workaround.

There is no such thing as an incident too small to report here. If you paused for
ten seconds to work out what a step meant, that pause is an incident.

---

## 2. Go all the way — and hand us the fix inside the report

**Do not stop at the wall.** If you can reproduce a defect, understand it and
correct it, do all three. An agent that proves a fix gives us far more than one
that describes a symptom.

What "all the way" means here:

1. **Reproduce it** — know what triggers it, not just that it happened once.
2. **Fix it**, in your clone.
3. **Prove the fix** with a non-regression test that **fails on the unpatched
   code**. A test that would also pass without your fix demonstrates nothing and
   we will reject it (Rule 29).
4. **Hand it over inside the report** — the diff and the test, as text, attached
   to the incident they belong to.

### What we ask you not to do

- **Do not push to a shared branch**, and do not open a fork or a pull request.
- **Do not fix silently.** A correction that appears without its incident is
  worse than no correction: we cannot tell what it was for, and the next tester
  meets the same wall with no record that anyone ever hit it.

That is the whole restriction, and it is narrow. It is not about trust — the two
reports we have received were both competent and both correct in what they
patched. It is about where a correction lands.

### Why the patch travels in the report rather than in git

1. **A correction placed in an instance dies with it.** This system destroys its
   test universes by design (Rule 10). Our own law now requires a fix to sit in
   the generic path — the brick, the package, the template — where it survives
   the universe that found it (Rule 29). Your clone is not that place; deciding
   where it is takes knowledge of the whole tree.
2. **Parallel pushing diverges repositories.** Not hypothetical: three clones
   recently reported three different test counts — 210, 212 and 215 — because
   each tester corrected what they met, in their own history. Reconciling that
   cost more than the defects did.
3. **The report is what makes the fix reusable.** A diff tells us what changed.
   The incident around it tells us why it was possible, which is what stops the
   next one.

So: **fix it, prove it, tell us everything — and let us be the ones to commit
it.**

## 3. Declare what you knew, and what the machine knew

Two declarations, because neither party can make the other's: the person who
asked you knows what they told you in earlier sessions, and only you know what
you actually read in this one.

Then a third thing, which is the one everyone forgets: **the terrain**. List what
the machine already held before you started — repositories, containers, images,
caches, shell history, environment files naming other versions — and say whether
you read any of it.

A template container on this project's test host was found carrying a full clone
of the previous version. An agent with no memory of the system would have been
handed it in three `ls` commands, and the report would still have said "no prior
exposure" in good faith. **A cold reader needs a cold terrain.** What the machine
offers is exposure too, and it is the kind nobody declares, because nobody put it
there on purpose.

## 4. Start from a known commit, and say which

Divergence is what makes reports impossible to compare, so:

```bash
git clone https://github.com/xavdp-pro/SHAPER-OS-V1.13
cd SHAPER-OS-V1.13
git log --oneline -1        # ← put this line in your report
```

Do not pull mid-run. If the repository moves while you are testing, your report
describes a state that no longer exists and nobody can tell which defects are
still real.

---

## 5. What to record, as you go

Write incidents down **when they happen**, not from memory at the end. An
incident you reconstruct afterwards loses the error text, which is the part we
need.

For each one:

| Field | Why we need it |
| :--- | :--- |
| **What you ran** | The exact command, copied, not paraphrased |
| **What you expected** | Where the expectation came from — which file, which line |
| **What happened** | The error, **verbatim**. Not summarised, not translated, not tidied |
| **Were you blocked** | Blocked / worked around / cosmetic |
| **What you did next** | Including the workaround, if any |
| **Did a human help** | If yes, what they told you — that sentence belongs in the repository |

That last row is the most valuable line in the whole report. Anything a human had
to explain to you is something the documentation should have said.

---

## 6. The report

One Markdown document. Deliver it whether the deployment succeeded or not.

```markdown
# Beta deployment report — <engine and version> — <date>

## Environment
Commit tested:      <git log --oneline -1>
Host / container:   <VPS, LXC, VM, laptop — and the OS>
Runtime:            <Podman/Docker version, Node version>
Tier deployed:      tier-a | tier-b
Prior exposure — mine:      none | read version <x> | discussed previously
Prior exposure — requester: <what they say they gave you, or "not declared">
Terrain already present:    <repos, containers, images, caches, env files the
                             machine held before you started — and whether you
                             read them>

## Result
<Did the stack come up? Which services? Did a real job run end to end?>

## Incidents
### 1. <one line: what stopped or slowed you>
- Ran:        <command>
- Expected:   <what, and from which file>
- Happened:   <verbatim error>
- Status:     blocked | worked around | fixed | cosmetic
- Next:       <what you did>
- Human help: <none | what you were told>
- Root cause: <why it was possible, not just what failed>
- Fix:        <the diff, as text — or "none, here is what I suspect">
- Proof:      <the non-regression test, and the failure message it produces
               against the unpatched code. Without that failure message we
               cannot tell the test proves anything.>

### 2. …

## Hesitations without an error
<Places where nothing failed but you had to infer, guess, or choose. These are
defects too — they simply have no error message.>

## Local state
<What you changed in your clone, and whether the run above was done before or
after those changes. We need to know which parts of your report describe the
repository as published and which describe your patched version.>

## Confirm
<No push to a shared branch, no fork, no pull request. Fixes are in this report.>
```

**An empty Incidents section is a valid report** — if it is true. It is not an
achievement to protect: a report with no incidents and no hesitations, from a
system this size, is more likely to mean the run was shallow than that the
documentation is perfect.

**And the report is the deliverable.** A test deployment that leaves a working
stack and no report has produced nothing we can use. A report with no working
stack, but with what stopped it written down precisely, has produced everything
we asked for.

---

## 7. What happens to your report

Your fixes are reviewed and placed where they survive — which is usually not
where you put them, and that is expected: you were deploying one universe, we
are keeping every future one working.

Every incident becomes, on our side, one of:

- a fix **in the generic path**, with a regression test that fails on the
  unpatched code (Rules 29, 20);
- a correction of the intent, when the documented intention was wrong (Rule 35);
- a line in the runbook or deployment contract, when it was an operational trap;
- an amendment to the law, when the rule itself was missing — which has already
  happened once, from exactly this kind of report.

You will not see a patch from us in return, and you should not wait for one. The
loop closes in the repository, not between us — and your name stays on the
commit that carries your fix.

---


## 7b. Report-only mode, and the build-vs-pull question

*(Added in V1.13.1 — a live campaign hit both gaps.)*

**Report-only mode.** An operator may mandate that testers fix NOTHING —
several models testing the same frozen tag must all measure the same state,
and the fixes are made once, together, afterwards. That mandate **overrides
section 2**: reproduce, capture the raw error, record your workaround as a
workaround, and deliver the report. Declare the mode at the top of your
report. Everything else here still applies.

**Build or pull?** Two legitimate paths exist and the answer depends on what
is being tested. *A beta run builds from source* — the question is "can a
cold agent build this"; pulling pre-built images would test the registry, not
the repository. *A fleet deployment pulls from the machine's registry* — that
is the normal path (RUNBOOK step 0b; the registry is an infrastructure
prerequisite). Say in your report which path you took and why.

## 8. Related

| If you were asked to… | Read |
| :--- | :--- |
| **Deploy and report** | This page, then [`RUNBOOK-EXPLICIT.md`](./RUNBOOK-EXPLICIT.md) |
| **Evaluate the documentation** without deploying | [`COLD-READ-TEST.md`](./COLD-READ-TEST.md) |
| **Operate the system** for real | [`BOOT-CONTRACT.md`](./BOOT-CONTRACT.md) |
