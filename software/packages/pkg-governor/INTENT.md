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
2. **A maker's identity is its host.** Enrolment binds a credential to one
   hostname; a poll claiming another host is refused. Enrolment itself is the
   tandem's act (an operator credential), never self-service: the fleet is
   not a place one walks into.
3. **No work for bytes unproven.** A maker declares the matrices it holds,
   by digest, at every poll. Work whose digest the maker has not declared is
   withheld and answered with a preload instruction instead. (The image lock
   held digests the registry had never heard of — once. Never again.)
4. **One live row per (account, class).** Desired state is idempotent: asking
   twice creates once. The double-click births one universe.
5. **The poll is the heartbeat.** Every ask is dated. A host silent beyond
   the declared interval is listed as drifting — an alarm, never a green
   tile (Rule 27 carries it out of band).
6. **Deadlines are desired state.** A row past its deadline yields reap work
   on the next poll; destruction is scheduled and verified, never a timer
   inside a robot.
7. **No dependencies.** Node built-ins only; the storage is injectable so a
   real governor binds its own database (Rule 26) while the contract stays
   testable on a naked clone.

## How to run

```js
import { createGovernor, createGovernorServer } from '@shaper/pkg-governor';
```

See `test/governor-contract.test.js` — the contract is its tests.
