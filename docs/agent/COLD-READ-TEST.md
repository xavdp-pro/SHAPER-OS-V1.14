# Cold-Read Test — For an Agent Asked to Evaluate This Repository

> **You were asked to beta-test the documentation, not the software.** The
> question is not "is SHAPER OS good?" It is: **could you have acted correctly
> here without a human telling you things the repository should have told you?**

This test is the repository's own proof obligation applied to itself. A document
that only its author can follow has not been proven, exactly as a job that only
its producer validated has not been proven (Principle 3).

---

## Rules of the test

0. **Declare your prior exposure before anything else, and declare it twice
   over.** Have you read an earlier version of this repository, or discussed it in
   a previous conversation? Say it in the first line of your report and continue
   anyway. A reader who already knows the system cannot measure whether the
   documents teach it — but they can measure whether one document contradicts
   another, which a newcomer never sees. Both are real findings; conflating them
   is how a test lies about what it proved.

   **Two declarations are needed, because neither party can make the other's.**
   The person who asked you knows what they told you in earlier sessions; only
   you know what you actually read in this one. A report carrying only one of the
   two has an unverifiable claim at the top of it.

0b. **A cold reader is not enough — the terrain must be cold too.** Before you
   start, list what the machine already held: repositories, containers, images,
   caches, shell history, environment files naming other versions. Then say
   whether you read any of it.

   This is not a formality. A template container on the test host was found to
   carry a full clone of the previous version: an agent with no memory of the
   system was handed it in three `ls` commands. Nobody had noticed, because the
   protocol only asked what the *reader* knew. What the *machine* offers counts
   as exposure, and it is the kind nobody declares because nobody put it there on
   purpose.
1. **Read cold.** Do not accept a verbal briefing first. If a human explains
   something to you before you start, that explanation is a **finding**: write it
   down as "the repository should have told me this".
2. **Take your own row.** Start at [`../../AGENTS.md`](../../AGENTS.md) and follow
   the path for your capability class. Do not read the other class's path until
   the test is over — that is the thing being measured.
3. **Do not fix anything.** This is a diagnostic (Boot Contract, point 10). You
   report; the human decides.
4. **Record hesitation, not just error.** A place where you *guessed correctly*
   is still a defect. The next agent may guess differently.

---

## The seven questions

Answer all seven. Short answers, concrete references, no diplomacy.

1. **Where did you have to infer?** List every point where you supplied
   something the repository did not state — a path, an order, a threshold, a
   default, an intention. Quote the file and what you filled in.
2. **Where did you hesitate between two readings?** Any place where two
   documents could both be authoritative, or where the same word meant two
   things.
3. **What did you look for and not find?** Name the file you expected to exist,
   and where you expected it.
4. **What would you have done wrong** if no human had been watching? Be specific
   and unflattering. This is the most valuable answer in the list.
5. **What did you read that you did not need?** Volume is a cost. Name what your
   row could have skipped without any loss.
6. **Could you state, from memory after reading:** what this system is for, what
   you were allowed to do, when you had to stop, and what counted as proof? Say
   which of the four you could not state.
7. **Did your capability class match your row?** If you were sent to the dense
   path and had to reread, or to the literal path and found it insulting or
   under-specified, say so — the routing is a claim under test.

---

## Report format

Deliver one Markdown block, nothing else:

```markdown
## Cold-read report — <engine name and version> — <date>
Prior exposure — mine:     none | read version <x> | discussed previously
Prior exposure — declared
  by the requester:        <what they say they gave you, or "not declared">
Terrain already present:   <repos, containers, images, caches, env files found
                            on the machine before you started — and whether you
                            read them>
Row taken: high-abstraction | fast-light | IDE-paired
Context budget: <tokens, or "unknown">
Read in full: <files you actually read end to end>
Could not read in full: <files you skimmed or skipped, and why>

### 1. Inferred        <file:line> — I assumed X, the repository never said it
### 2. Ambiguous       <file A> vs <file B> — both could be authority on X
### 3. Missing         expected <path> — not found
### 4. Would have done wrong
### 5. Read but unnecessary
### 6. Could not state from memory
### 7. Routing verdict — correct row / wrong row, because…
```

---

## What happens to your report

Each finding becomes one of the following, and nothing is closed as "clarified in
chat" (Principle 5, Rules 29 and 35):

| Finding | Becomes |
| :--- | :--- |
| You inferred a fact | The fact is written where you looked for it |
| Two documents both looked authoritative | One is made canonical, the other references it |
| You could not state a rule from memory after reading it | The rule moves earlier, or gets shorter |
| A document was unnecessary for your row | The routing is corrected, not the document deleted |
| The row itself was wrong for your class | [`../../AGENTS.md`](../../AGENTS.md) is corrected |

A reader with prior exposure is not disqualified — the first external finding
that reached this repository, a rule recommending a model two generations out of
date, came from exactly such a reader, and only a reader who had seen the earlier
version would have caught a rule contradicting a newer document. Record the
exposure, then weigh the finding for what it is.

A report that produces no change to the repository was either perfect or not
read. Both are worth knowing.
