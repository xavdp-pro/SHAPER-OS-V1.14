# Package: @shaper/pkg-governor

## What it is

The governor's contract, executable. A governor is the universe that holds a
ledger and makes it respected: it writes desired state, makers come to ask
what should exist on their host, and it hears their silences. The demo SaaS
is a governor; a fleet manager is a governor; the maker never learns which —
it reads an address.

## Why it exists

The fractal's whole security model rests on one direction: what holds power
has no inbound door, what is reachable holds no power. That only works if the
asking side is a real contract — enrolment, identity, inventory, reporting,
silence — and not an improvised HTTP route per project. This package is that
contract, written once, so every governor speaks it and every maker reads it.

## Invariants

1. **The governor governs by writing, never by commanding.** Its only act is
   a ledger row of desired state. Work is derived from the gap between
   desired and reported, never pushed anywhere.
2. <a id="identity-is-the-host"></a>**A maker's identity is its host.**
   Enrolment binds a credential to one hostname; a poll claiming another
   host is refused, and so is a report on a row written for another
   machine: a stolen credential may lie about its own host's rows, never
   about another's. Each refusal is journaled — who, about which row, when
   — because a lie at the door is a security fact, not a 403. The journal
   is not capped or coalesced, on purpose: only an enrolled credential can
   write to it (an unknown token is a 401, unrecorded), so a journal that
   grows is one maker lying on repeat, and the answer is not a smaller
   journal but the tandem revoking that maker — the revocation is the
   alarm. Enrolment itself is the tandem's act (an operator credential),
   never self-service: the fleet is not a place one walks into.
3. **No work for bytes unproven.** A maker declares the matrices it holds,
   by digest, at every poll. Work whose digest the maker has not declared is
   withheld and answered with a preload instruction instead. (The image lock
   held digests the registry had never heard of — once. Never again.)
4. <a id="one-live-row"></a>**One live row per (account, class).** Desired
   state is idempotent: asking twice creates once. The double-click births
   one universe. A DEGRADED row is not a life to protect — for the
   environments a robot may end (dev, test, demo): asking again ends the
   broken one (its deadline becomes now, a maker reaps whatever
   half-exists) and births a fresh one, and pressed twice it still births
   one. A DEGRADED **prod** row is a life a robot may not end: the re-ask is
   refused as a typed fact carrying the row id — never an exception, never a
   twin — and the slot stays held until a human ends it (Rule 27, amended
   in the same release).
5. **The poll is the heartbeat.** Every ask is dated. A host silent beyond
   the declared interval is listed as drifting — an alarm, never a green
   tile (Rule 27 carries it out of band).
6. <a id="deadlines-are-desired-state"></a>**Deadlines are desired state.**
   A row past its deadline yields reap work on the next poll; destruction is
   scheduled and verified, never a timer inside a robot. A row past its
   deadline is never stamped: what was never born is offered its end, and
   the recipe proves the absence. The governor's offers are bounded like any
   corrective loop (Rule 27): a reap that fails is offered again after an
   exponential pause and never again past `maxHealingAttempts` — the row
   rests DEGRADED, the alarm leaves out of band, the governor is never the
   storm. A reap the recipe REFUSES (exit 4, a production universe) reaches
   the ledger under its own name, `REAP_REFUSED`: a refusal is a fact, not a
   failure, and the row is never offered again. A claim — STAMPING, REAPING,
   VALIDATING — that goes silent past its budget is offered again: a maker
   that died mid-work must not hold a row RECONCILING forever.
7. **No dependencies.** Node built-ins only; the storage is injectable so a
   real governor binds its own database (Rule 26) while the contract stays
   testable on a naked clone.
8. <a id="a-birth-is-a-fact"></a>**A birth is a fact, not a claim.** An
   event means what its name says only if its facts hold: STAMPED purrs only
   when the reported `state` says the container runs (the word, in any
   case — host tooling spells it its own way); a stopped container, or a
   stamp that ended without a line of facts, degrades the row and the ledger
   names the fact that was missing. The recipe looked and reported; the
   governor never purrs because a maker said so. The HTTP door answers
   enrol, poll and `/api/work/<rowId>/events` exactly — nothing else.

## How to run

```js
import { createGovernor, createGovernorServer } from '@shaper/pkg-governor';
```

See `test/governor-contract.test.js` — the contract is its tests.
