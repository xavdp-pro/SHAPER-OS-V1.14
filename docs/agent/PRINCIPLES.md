# The Generative Principles of SHAPER OS

> **Audience:** AI agents able to derive consequences from principles.
> **Status:** generative index — **not** authority. The binding text is
> [`software/RULES.md`](../../software/RULES.md) (49 rules) and [`LAW.md`](../../LAW.md).
> **Size:** read this file in full. It is short on purpose.

## How to use this file

The 49 rules of `RULES.md` are not 49 independent decisions. They are the
**consequences** of ten principles. If you can hold these ten, you can predict
most of the corpus before reading it, and you will recognise a violation even in
a situation no rule anticipated.

Three conditions of use, in order of severity:

1. **A principle never overrides a rule.** If your derivation contradicts
   `RULES.md`, the rule wins — and the contradiction is a defect: report it
   (Rule 35), do not silently pick a side.
2. **A principle is not a permission.** Deriving "this is obviously fine" from a
   principle is exactly how an architecture drifts. Derivation tells you where to
   look; the rule tells you what you may do.
3. **If you cannot derive, do not improvise.** Go to
   [`PHASES.md`](./PHASES.md) for the ordered process, or
   [`RUNBOOK-EXPLICIT.md`](./RUNBOOK-EXPLICIT.md) for literal steps.
4. **Facts are never derived.** Ports, paths, command order, key names and
   thresholds are read, not inferred — however capable you are. Deriving a
   command you could have read is the most expensive mistake available to a
   strong model.

---

## Principle 0 — The meta-principle

> **The code is the variable. Everything else is the constant.**

Model capability moves. The agent reading this file today is not the agent that
will read it in six months, and that agent will be better. SHAPER OS is built so
that a **more capable model produces better code — not a different
architecture.**

Therefore everything that is *not* code is written down explicitly: intent, law,
proof, lifecycle, perimeters, and the cognitive requirements of each brick. The
improvement lands where we want it (implementation quality) and cannot leak into
where we do not (architectural drift).

This is why the corpus is large and the freedom is real: **carte blanche on the
implementation, zero blanche on the frame.**

---

## The ten principles

| # | Principle | Reads as | Generates |
| :--- | :--- | :--- | :--- |
| 1 | **Intent precedes form** | Nothing exists before the intention that justifies it is written. `INTENT.md` before container, always. | 0C, 0D, 0E, 0I |
| 2 | **One intent, one container** | Isolation is the unit of intention, not a performance tactic. A brick that needs two isolations is two bricks. | 2, 3, 4, 8, 11, 13, 14, 26, 34 |
| 3 | **Nothing is true until proven from outside the producer** | A health endpoint is not a proof. A `COMPLETED` status is not a proof. The thing that made the claim never validates the claim. | 0G, 0J, 5, 18, 20, 25, 28 |
| 4 | **Authority descends, never ascends** | K+1 repairs K. Nothing repairs itself in flight. Keys go down as public, never up as private. | 23, 24, 25, 27, 36 |
| 5 | **Every surprise climbs back into the law** | An incident that produced only a fix produced nothing. It must also produce a test, and where the intention was wrong, a corrected intention. | 29, 35 |
| 6 | **The generic precedes the specific and is never copied** | You reference and specialise. You do not fork. A divergence that was not declared is contamination. | 0B, 1, 32, 33 |
| 6b | **The other-operator test** | Could a different person clone this, and deploy under **their** domain, accounts and names, changing environment values only? If anything in a tracked file only works for its author, it is a defect. | 0B — enforced by the domain-agnosticism guard test |
| 7 | **What proves must die** | TEST is rebuilt from nothing and destroyed. The ephemeral is unrecoverable by design. Only Git and exported evidence survive. | 10, 36 |
| 8 | **Form follows the recipient** | Cockpit is not a client tool. Simple mode carries no jargon. Agent context is pre-digested, never raw architecture. | 0, 0A, 0C, 0F, 0K, 6, 15, 17, 19 |
| 9 | **Code is disposable, data is not** | Two lifecycles that are never confused. You may destroy a universe; you may not destroy its data by accident. | 4, 9, 12, 16, 22, 26, 30, 31 |
| 10 | **Every task declares the intelligence and the speed it needs** | Capacity is a declared requirement of the work, not a property of whichever engine happened to be connected. | 0H, 6, 7, 21 — see [`COGNITION.md`](../architecture/COGNITION.md) |

---

## The same ten, as violation smells

Derivation is useful when it stops you. These are the signals that you are
breaking a principle *before* you can name which rule you broke.

| # | You are violating it when you catch yourself writing or thinking… |
| :--- | :--- |
| 1 | "I'll create the container now and write the INTENT after, so it's consistent with what I built." |
| 2 | "It's simpler to put both services in one container, they're related anyway." |
| 3 | "The health check is green, so the job worked." · "The agent returned COMPLETED, so the file is correct." |
| 4 | "I'll fix it directly on the running child, it's a small patch." · "I need the child's private key up here." |
| 5 | "It works now, I'll note it in my summary." (and nowhere in the repo) |
| 6 | "I'll copy the Containerfile into the universe and adapt it." · "I'll put my domain as the default so it works out of the box." |
| 7 | "The TEST environment still works, let's keep it — rebuilding takes time." |
| 8 | "I'll show the operator the full topology, more context is better." · "The owner can handle a little jargon." |
| 9 | "I'll recreate the volume, it's faster than migrating." |
| 10 | "Any model will do for this brick." · "The benchmark says it's the fastest, so use it." |

---

## The derivation test (how to falsify this file)

This abstraction is legitimate only while it survives two mechanical checks:

- **Coverage** — every rule in `RULES.md` traces to at least one principle. An
  orphan rule means either the abstraction is incomplete, **or** the rule is
  arbitrary and should be challenged. Both are findings worth reporting.
- **Fecundity** — every principle generates at least two rules. A principle that
  generates one is a rule wearing a costume; delete it.

**Current status:** the mapping in the table above was established by reading the
corpus, and it is asserted, not machine-verified. Principle 10 was, at the time
of writing, the thinnest: four rules pointed at it (0H, 6, 7, 21) without ever
naming it, which is what a missing principle looks like from the inside.

If you find an orphan rule, report it under Rule 35. Do not adjust the principle
to make it fit — that is how an abstraction stops describing the system and
starts inventing it.

---

## Where to go next

| You need | Go to |
| :--- | :--- |
| What you are allowed to do, right now | [`BOOT-CONTRACT.md`](./BOOT-CONTRACT.md) |
| The ordered process, phase by phase | [`PHASES.md`](./PHASES.md) |
| Literal steps, no derivation required | [`RUNBOOK-EXPLICIT.md`](./RUNBOOK-EXPLICIT.md) |
| Which brick does what, and what breaks without it | [`../BRICKS.md`](../architecture/BRICKS.md) |
| The binding law, in full | [`../../software/RULES.md`](../../software/RULES.md) |
