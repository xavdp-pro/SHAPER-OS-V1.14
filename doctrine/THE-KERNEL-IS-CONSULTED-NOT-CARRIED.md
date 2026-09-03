# The Kernel Is Consulted, Not Carried

> **Status**: founding doctrine, stated by the operator on 2 September 2026,
> arriving at the end of a long exchange about a philosophical corpus he
> co-created with an outside agent (`doctrine/kernel/`):
> *"j'ai l'impression que c'est plus un guide structurel pour toi quand on
> dépile ce dont on a besoin pour la mécanique."*

## The law, in one line

**A rich cognitive framework is read once by whoever designs a component. It
is never loaded into the live context of the agent that runs it.**

## Why this is a law and not a style preference

The instinct, faced with a document as good as `doctrine/kernel/`'s, is to
put it in every agent's system prompt so nothing gets lost. That instinct is
exactly backwards, and testing it out loud is what surfaced the law:

Ask an agent to carry the whole thing — the ethics, the tension taxonomy,
Knowledge/Responsibility/Control, loop detection, the fractal governance
model — *while also* doing its actual job, and one of two things happens.
Either the philosophy erodes under the pressure of a long session and a
narrow task, silently, the way any instruction not backed by a mechanism
erodes; or it survives, and steals context and attention from the task the
agent was built to do. A voice agent qualifying a caller does not need to
hold Knowledge/Responsibility/Control in its live attention to be reliable —
it needs a short brief and a sharp STOP list. The depth belongs somewhere
else.

## Where the depth actually goes

Split by role, the same way the fractal already splits governor from maker:

| Layer | Carries | Lives |
| :--- | :--- | :--- |
| The acting agent (A1-shaped, whatever model runs it) | a narrow brief: local objective, scope, STOP conditions, escalation triggers | in the live conversation, small on purpose |
| The supervisor (A2) | tension detection, Knowledge/Responsibility/Control alignment, provenance | outside the live turn — a review pass, not a shared context |
| The parent / root | pattern review across many runs, the authority to change the acting agent's brief | further outside still |

The acting agent never inspects itself for the deep questions. Section 17 of
the kernel names this without our vocabulary: *"a system may inspect itself
more freely than it may rewrite the structural mechanisms its own existence
depends on."* Applied here: the child does not carry the philosophy that
would let it certify its own soundness — the parent does, from outside its
context window.

## What already proves this, before the doctrine had a name

`INTENT.md` has worked this way since before this document existed. No agent
loads a brick's full `INTENT.md` at every turn of running it; someone reads
it once, while building the thing, and what survives into the running system
is the derived, mechanical form — a test that fails on the unpatched code, a
schema that refuses malformed input, a recipe that hashes before it trusts.
The text stays in the repository. The invariant is what travels.

`doctrine/kernel/` is the same pattern one level up: a corpus an architect —
human or agent — reads while deciding what a role's narrow brief should
contain. It is filed in this canon so that reading is repeatable and the
corpus does not live only in one operator's head or one export folder. It is
filed in `doctrine/kernel/` rather than folded into `RULES.md` because it
stays deliberately agnostic of this system's vocabulary — see
`THE-SYSTEM-LEARNS-NO-DIALECT.md` for the sibling law about the vocabulary
a shared component is allowed to learn. A translation pass — turning
CORRECT/REPAIR/REBUILD/QUARANTINE or Knowledge/Responsibility/Control into
an actual enforced rule against Rule 11's podman bricks — is future,
concrete, and owned work, not this document.

## The test for whether this law is being kept

Before adding anything from `doctrine/kernel/` into a live agent's prompt,
system instructions, or per-turn context: name the mechanical artifact —
test, schema, refusal, STOP list — that the reading produced. If the answer
is "the text itself, so it remembers," the law is being broken.
