# The Boot Contract

> **Audience:** every AI agent, at every capability level, before any other action.
> **Status:** operational contract. It grants and it limits. It does not replace
> [`software/RULES.md`](../../software/RULES.md).
> **Cost of skipping it:** the human has to dictate these twelve points by hand,
> which is exactly the failure this file exists to remove.

You have landed in a repository you did not write. Twelve statements define what
you are, what you may do, and when you must stop. Read all twelve before acting.

---

## 1 — Read before you act

Understand the repository in depth before changing anything. `software/` is the
runnable system, `doctrine/` is the corpus, the universe folders are
materialisations. You execute **this** architecture. You do not invent another
one, and you do not soften the law.

## 2 — You are authorised, within a perimeter

Your authority is **granted, not assumed**. On a working machine where the human
has granted passwordless `sudo` — say so explicitly before relying on it — you may
install what you genuinely need for the work and the tests.

The grant covers **the tools of the job**. It never covers the destruction of
state you did not create: never wipe a volume, a database, or a universe you did
not provision, and never touch a production universe to make a test pass. If you
are unsure whether a machine carries production, treat it as though it does.

## 3 — The terrain is nested, and it is not your laptop

```
VPS (test host)  →  dedicated LXC  →  several Podman containers
```

Real work happens in an isolated LXC on the test host, never directly on a host
that carries production. Nesting is enabled for rootless Podman inside the LXC.
A laptop install is **DEV**, whatever you call it (Rule 10, `LIFECYCLE.md`).

> **Where the commands are.** Nothing in this contract is a command list. The
> exact ordered pipeline lives in [`RUNBOOK-EXPLICIT.md`](./RUNBOOK-EXPLICIT.md),
> and it is authoritative for every agent at every capability level: commands are
> facts to be read, never derived.

## 4 — This system is built for agents, not for a human installer

There is no installer monolith and there is no implicit human procedure. The
authority documents *are* the installation: `INTENT.md`, the rules, the
manifest, the proofs. If a step is not derivable from those, that is a defect in
the documents — report it (point 8), do not invent the step and move on.

## 5 — One brick, one Podman container

A SHAPER brick is a container. Not a module inside a monolith, not two services
sharing one image because they are related. Isolation is the unit of intention
(Rule 2 of the [principles](./PRINCIPLES.md), Rules 3, 4, 8, 11, 26).

## 6 — Every brick has an explicit start order

The manifest declares `bootOrder` as ordered groups. You do not start containers
in the order you happen to have built them, and you do not rely on retry loops to
paper over a missing dependency. If a brick has no declared position, that is a
manifest defect — fix the manifest, not the timing.

## 7 — Choose the engine by measurement, not by reputation

Before selecting a model or CLI, check what is actually available and actually
responsive **from the target host**. Published throughput tables are advisory;
measured availability is mandatory. Each brick declares the cognition it
requires — see [`../COGNITION.md`](../architecture/COGNITION.md). Reserve ultra-fast engines
for acknowledgments and voice micro-tasks; never expose them as general agent
chat models (Rules 0H, 7, 21).

## 8 — Every incident climbs back into the repository

This is the rule that keeps the system alive across agent generations. When
something breaks and you adjust, the correction never stays in the code alone and
never stays in your context. It becomes, as applicable:

| The incident revealed | It must produce |
| :--- | :--- |
| A defect in the implementation | The fix **and** a non-regression test that fails on the unpatched code (Rule 29) |
| A missing constraint | A rule, or an amendment to an existing rule |
| A wrong or incomplete intention | An updated `INTENT.md` (Rule 35) |
| An operational trap | A line in the deployment contract or runbook |
| A verified outcome | A proof or a verdict file |

And it goes in the **generic path**, not in the universe where you met it. A
universe is destroyed; the brick, the package and the template survive. If the
test you just wrote would vanish with the universe, the fix is in the wrong
place — move both.

An incident that produced only a fix produced nothing. The next agent will hit
it again. An incident corrected inside a universe produced nothing either: the
next agent will hit it again on a clean sheet, which is exactly what happened
between v1.7 and v1.8.

## 9 — Test what happens, not what is declared

A health endpoint answering `200` is not proof that a job ran. A `COMPLETED`
status is not proof that a file is correct. Proof is read **from outside the
thing that produced it** — the artefact inspected byte for byte, the audit event
correlated with the job id (Rules 0G, 20, 23). No fake, no fallback, no stub on
the way to green.

## 9b — If this is a beta test, the report is the deliverable

Operating the system and being asked to test it are different mandates. When a
human asks you to deploy this and tell them how it went, go all the way —
reproduce, correct, and prove the correction with a test that fails on the
unpatched code — and then deliver **the account, carrying your fixes inside it**.

A working stack with no report has produced nothing. A blocked run with the wall
written down precisely has produced everything that was asked for.

Do not push to a shared branch, do not fork, and never fix silently: by this
contract's own point 8, a correction belongs in the generic path where it
survives the universe that found it, and a tester's clone is not that place.
Protocol: [`BETA-DEPLOYMENT-TEST.md`](./BETA-DEPLOYMENT-TEST.md).

## 10 — Diagnostic mode changes nothing

When the human asks *what is wrong* or *what could be improved*, you analyse and
you report. You do not fix, refactor, or "just clean up while I'm here". A
diagnostic that silently mutates the system destroys the very state being
diagnosed. Ask for the go, then act.

## 10b — Never commit what is yours alone

Before every commit, apply the **other-operator test**: could a different person
clone this and deploy under their own domain, accounts, zones and mailboxes, by
changing environment values only?

A domain, a credential, an account or zone identifier, a mailbox, a public
hostname — none of these belong in a tracked file, not even as a convenience
fallback. `process.env.X || '<my real value>'` is a committed value with extra
steps: the fallback is what runs on everyone else's machine.

When a deployment genuinely needs a public name, **ask the human operator** for
it — the zone must already be managed in Cloudflare — and halt until they answer.
A domain is never invented, and never inherited from whoever wrote the file.

## 11 — Be transparent about state

**Every commit you produce names you.** The human is the author, and you are a
`Co-Authored-By` trailer carrying your engine and version (Rule 2). A history
that does not say which changes came from an agent cannot be audited later, and
this is the one thing that cannot be reconstructed after the fact.

At any moment the human must be able to know, without asking twice:

- what changed, and whether it is **committed**;
- whether it is **pushed**, and to which branch;
- whether a change came from **your test runs** or from the **human's own work**;
- whether the working tree is clean.

Generated artefacts, test residue, and real deliverables are never presented as
the same thing.

## 12 — Stop conditions are hard

Stop and hand back to the human when:

- a required secret is missing, empty, or a placeholder — halt before building
  or launching anything (see [`RUNBOOK-EXPLICIT.md`](./RUNBOOK-EXPLICIT.md));
- a test is red — stop, do not stub your way to green;
- an action would touch production, delete data, or exceed the granted
  perimeter;
- a rule blocks you — report the blockage, never edit the law to unblock
  yourself;
- you have retried the same repair five times — mark `DEGRADED` and escalate
  (Rule 27). A repair loop that cannot give up is a fault amplifier.

---

## Language

Technical text — code, tests, comments, documents, commit messages — is
**English**. Conversation with the human may be French. This is Rule 0, and it
exists so that the corpus stays readable by every agent that follows you.

---

## The forbidden list

- Skip `npm test`, `npm run test:live`, or the closed-loop verification scripts
- Commit `.env`, vault files, tunnel tokens, or `*.enc`
- Put default API keys in shell scripts
- Merge a client-facing UI into the operator cockpit (Rule 0F)
- Use production mailboxes in DEV or TEST (Rule 9)
- Copy `packages/` or a brick `Containerfile` into a universe folder (Rule 32)
- Self-mutate an active runtime you are running inside (Rule 23)
- Push to a whole fleet without a canary (Rule 25)
- Retry a failing repair forever instead of escalating (Rule 27)
- Close a bug without its non-regression test (Rule 29)
- Keep a TEST universe alive after it passed (Rule 10)
- Abbreviate, summarise, or replace `software/RULES.md` with a pointer — the
  canon is read in full or it is not law

---

## Done means

[`PROOF.md`](../human/PROOF.md) satisfied and live tests green, with the evidence
readable by someone who was not in the room. On failure: stop and show the
error, unedited.
