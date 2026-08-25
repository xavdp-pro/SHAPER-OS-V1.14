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

## 2. Do not fix anything. Do not fork. Do not propose a patch.

**This is the rule that matters most, and it is the opposite of what a capable
agent naturally wants to do.**

When you hit a defect:

- **Do not correct it** — not in the code, not in a script, not in a manifest.
- **Do not commit** anything, in your clone or anywhere else.
- **Do not open a fork, a branch, a pull request, or a patch proposal.**
- **Do not send us a diff.** We are not asking for one.

Work around it locally if you must in order to continue — and then **report both
the defect and the workaround**. Note what you had to do to get past it. That is
information; a silent workaround is a defect deleted.

### Why, concretely

1. **A fix made in your clone dies in your clone.** SHAPER OS destroys its test
   universes by design (Rule 10), and a correction that lives in an instance is
   deleted with it. Our own law says a correction must be placed in the generic
   path, where it survives — and only we can decide where that is (Rule 29).
2. **A fix hides the shape of the defect.** We need to see exactly what stopped
   you and what the error said, not what you did about it. The patch is the easy
   part; knowing that two independent testers hit the same wall is the finding.
3. **Parallel fixing produces divergent repositories.** This is not a
   hypothetical: three clones of this repository recently reported three
   different test counts — 210, 212 and 215 — because each tester corrected what
   they met. Reconciling that costs more than the defects did.

You are not being restricted because you are not trusted. You are being asked for
the one thing only you can produce: **an honest account of what a newcomer meets.**

---

## 3. Start from a known commit, and say which

Divergence is what makes reports impossible to compare, so:

```bash
git clone https://github.com/xavdp-pro/SHAPER-OS-V1.8
cd SHAPER-OS-V1.8
git log --oneline -1        # ← put this line in your report
```

Do not pull mid-run. If the repository moves while you are testing, your report
describes a state that no longer exists and nobody can tell which defects are
still real.

---

## 4. What to record, as you go

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

## 5. The report

One Markdown document. Deliver it whether the deployment succeeded or not.

```markdown
# Beta deployment report — <engine and version> — <date>

## Environment
Commit tested:      <git log --oneline -1>
Host / container:   <VPS, LXC, VM, laptop — and the OS>
Runtime:            <Podman/Docker version, Node version>
Tier deployed:      tier-a | tier-b
Prior exposure:     none | read version <x> | discussed previously

## Result
<Did the stack come up? Which services? Did a real job run end to end?>

## Incidents
### 1. <one line: what stopped or slowed you>
- Ran:        <command>
- Expected:   <what, and from which file>
- Happened:   <verbatim error>
- Status:     blocked | worked around | cosmetic
- Next:       <what you did>
- Human help: <none | what you were told>

### 2. …

## Hesitations without an error
<Places where nothing failed but you had to infer, guess, or choose. These are
defects too — they simply have no error message.>

## What I did NOT do
<Confirm: no fix committed, no fork, no patch. If you modified anything locally
to get past a step, list it here so we know your run is not reproducible as-is.>
```

**An empty Incidents section is a valid report** — if it is true. It is not an
achievement to protect: a report with no incidents and no hesitations, from a
system this size, is more likely to mean the run was shallow than that the
documentation is perfect.

---

## 6. What happens to your report

Every incident becomes, on our side, one of:

- a fix **in the generic path**, with a regression test that fails on the
  unpatched code (Rules 29, 20);
- a correction of the intent, when the documented intention was wrong (Rule 35);
- a line in the runbook or deployment contract, when it was an operational trap;
- an amendment to the law, when the rule itself was missing — which has already
  happened once, from exactly this kind of report.

You will not see a patch from us in return, and you should not wait for one. The
loop closes in the repository, not between us.

---

## 7. Related

| If you were asked to… | Read |
| :--- | :--- |
| **Deploy and report** | This page, then [`RUNBOOK-EXPLICIT.md`](./RUNBOOK-EXPLICIT.md) |
| **Evaluate the documentation** without deploying | [`COLD-READ-TEST.md`](./COLD-READ-TEST.md) |
| **Operate the system** for real | [`BOOT-CONTRACT.md`](./BOOT-CONTRACT.md) |
