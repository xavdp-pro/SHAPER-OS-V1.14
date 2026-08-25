# Deferred Decisions

> Questions that are **important and deliberately not answered yet**. Each one is
> recorded with what must be true before it can be decided, so that it is not
> re-litigated every time someone notices it is missing — and not forgotten
> either.

A deferred decision is not a gap in the design. It is a decision **about
sequencing**, and it is written down for the same reason everything else here is:
so the next agent, and the next reader, inherit the reasoning instead of guessing
it.

Do not implement anything below because you found it here. Each entry names its
trigger; without the trigger, the answer is still "not now".

---

## 1. Rights, roles, and the human organisation

**The question.** The system is already multi-user. What it does **not** have is
a decision about what multi-user *means*: are these several accounts belonging to
one person who runs everything alone, or an organisation with a hierarchy — an
org chart the system must reflect, with rights and roles derived from it?

**Why it is not now.** Locking a permission model in place is the single hardest
thing to change afterwards. Every feature built on top of it inherits its
assumptions, and a wrong model does not announce itself: it quietly makes some
work impossible and some access too easy. Deciding it before the system has been
run in anger would mean deciding it from imagination.

**What must be true first.** Normal operation validated across **a number of real
contexts** — enough different universes, businesses and usage patterns that the
shape of who-does-what is observed rather than invented. The org chart, if there
is one, should be recognised in what people actually do.

**Why it matters that much.** This is the **final objective of the product**:
deciding rights and roles, and then locking everything down — paranoid mode,
deliberately. Not paranoid as a temperament, paranoid as a finished posture:
every capability granted on purpose, nothing reachable by default, and the
organisation's own structure expressed as authority rather than bolted on.

**Meanwhile.** Multi-user support stays as it is: functional, not authoritative.
Do not build features that assume a hierarchy, and do not build features that
assume its absence. Anything that would be painful to reverse under either answer
waits.

**Who decides.** The operator, explicitly. This is `D4` work — architecture and
law — and by [`COGNITION.md`](./COGNITION.md) it is never dispatched autonomously.

---

## 2. Independence from an external IDE

**The question.** Today an external IDE agent bootstraps the first universe. The
intended end state is that it no longer has to: the **master universe** talks to
the owner directly, and the system carries its own operation.

**Why it is not now.** The external IDE is what proved the bootstrap works at
all. Replacing a working bootstrap before the thing it bootstraps is
self-sufficient trades a proven path for an unproven one, at the exact moment the
system cannot yet catch its own failures.

**What must be true first.** A universe that can be raised, proved and repaired
without a human at an IDE — which is what the clean-sheet TEST lifecycle
measures, repeatedly, across contexts.

**Meanwhile.** Keep the IDE path first-class and keep it honest: everything an
IDE agent needs is written in the repository, never in a person's habits. The
cold-read protocol exists partly to enforce this — a document only an insider can
follow is a dependency on the insider.

---

## 3. The cognition router

**The question.** [`COGNITION.md`](./COGNITION.md) declares everything an
automatic engine router would need: capacity class, depth, throughput, horizon,
degradation. Nothing reads it yet; engine choice stays human (Rule 0H).

**Why it is not now.** The declaration is useful on its own and costs nothing to
be right about. A router is code: it needs its own intent, its own tests and its
own clean-sheet TEST before production, and it would be the component deciding
where every job goes — a bad one is worse than none.

**What must be true first.** The declarations must have been lived with long
enough to know they describe real work correctly. A router built on axes nobody
has stress-tested would encode today's guesses as tomorrow's dispatch.

**Design constraints already established**, for whoever builds it:
- **Deterministic first.** Rules decide the ordinary cases; paying a frontier
  engine to determine that a log line is a log line is the waste this is meant to
  end.
- **The classifier is itself a job.** If the router needs an engine to choose an
  engine, it has a circular dependency at cold start. The deterministic layer
  must be able to route the classifier without it.
- **It is not an authority.** A pure function from (declared requirement,
  measured inventory) to engine, with the decision **and the measurement that
  justified it** written to the audit log. Replacing "the human chooses" with "a
  box chooses and nobody knows why" would break Rule 0G.

---

## 4. ~~Who is the Parent when a universe runs inside an LXC?~~ — withdrawn

This entry claimed that Rule 36 and step 5 of the LXC guide contradicted each
other, and that arbitrating required first deciding where a fractal level begins.

That was wrong, and it was worth being told so. **The direction of travel settles
it without any question of level: a private key never moves.** The guide was
copying the LXC's private key into the agent container while the matching public
key sat in that LXC's own `authorized_keys` — handing a container the key to its
host. No reading of *who is the Parent* makes that acceptable, and none was
needed to see it.

The guide now does the only correct thing: the party that needs to *initiate* the
connection generates its own pair and sends **only its public key** to the party
it wants to reach. Revoking an access becomes removing one line instead of
rotating a key across everything that trusted it.

Left here rather than deleted, because a deferred decision that turns out to be a
plain defect is worth seeing once: the instinct to arbitrate between two
documents can hide the fact that both are wrong about something simpler.
