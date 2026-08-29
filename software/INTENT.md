> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

# Software intent — `software/`

## Objective

Hold every **runnable** part of Shaper OS — packages, bricks, scripts, schemas,
and the canon — so that an agent can build, deploy, test and prove a universe
from this tree without ever copying it into one.

The kit-level intent (what the repository as a whole is for, and its sixteen
invariants) is [`../INTENT.md`](../INTENT.md). This file states only what is
specific to the software tree. It is not a copy of that file: until v1.8 it was
one, which left two candidates for the same authority.

## Invariants

1. **`RULES.md` lives here and is the canon.** 49 rules, uniform binding force,
   read in full. Everything else in the repository — principles, phases,
   runbooks, doctrine — indexes it. Nothing replaces it, abbreviates it, or
   substitutes a pointer for it.
2. **A brick is a container; a package is code.** `bricks/<name>/` holds the
   Containerfile and the brick `INTENT.md`; `packages/<name>/` holds the
   implementation and its tests. A brick that ships no `INTENT.md` is not
   deployable (Rule 0D).
3. **Generic here, specialised there.** Universes reference bricks through their
   manifest and specialise them by parameter. Nothing in this tree is ever
   copied into a universe folder (Rules 32, 33).
4. **`npm test` is the contract.** Native `node --test`, no external runner, and
   green on a fresh clone before any image is built (Rule 5). Live tests run
   after the stack is up, never before.
5. **Every fixed defect ships its test in the same commit.** A test that would
   also pass on the unpatched code proves nothing and must be rewritten
   (Rule 29).
6. **Secrets never enter this tree.** No `.env`, no vault file, no tunnel token,
   no `*.enc`, and no default API key inside a script.
7. **Schemas are law for manifests.** `schemas/universe-manifest.schema.json`
   defines what a universe may declare, including the `cognition` block
   ([`../docs/architecture/COGNITION.md`](../docs/architecture/COGNITION.md)).
   A manifest that does not validate is not deployed.

## Read first

[`RULES.md`](./RULES.md), then [`docs/PERIMETERS.md`](./docs/PERIMETERS.md) and
[`topology.json`](./topology.json). Install path for humans:
[`../docs/human/START-HERE.md`](../docs/human/START-HERE.md).
