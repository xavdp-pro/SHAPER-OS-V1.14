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
   in the same release). How a human ends it today: the tandem ends the
   universe by hand on its host, then the maker of that machine reports
   REAPED on the row — the only credential the ledger lets write it (inv.
   2). The contract offers no explicit act of release: an `end`/`release`
   the tandem performs through the governor is a TARGET, not a hidden
   route, and until it exists an agent must not look for one.
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
   that died mid-work must not hold a row RECONCILING forever. Those
   re-offers are not yet bounded (TARGET): only REAP_FAILED events count
   toward `maxHealingAttempts`, so a maker that claims and dies every time
   is offered the same work again at every budget — a cadence of one per
   `claimBudgetMs`, never a storm, and its silence is heard through inv. 5.
   Bounding them means the governor writing a state of its own on a row no
   maker reported on; that act is designed with the explicit end above,
   not improvised here.
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
9. <a id="params-are-typed"></a>**A row's params are typed, allow-listed,
   immutable and unique — and never a shell's word.** A recipe may need a
   value the product assigned (a tenant's number, hence its bridge, its
   port, its unit) and may derive nothing from `account`, a stranger's
   text. So a row carries `params`: a flat object of scalars (string,
   number, boolean) under keys `^[a-z][a-z0-9_]{0,31}$`, held to an
   allow-list the product declares at creation (`paramsSchema`, per class:
   `{ n: { type: 'number', unique: true } }`). `desire()` refuses, as a
   typed fact naming the key, a key the grammar rejects, a key the class did
   not declare, a value that is not a scalar of the declared type — a class
   that declares nothing carries nothing. A living row's params are
   immutable like its digest: a re-ask carrying other params is refused
   with the row's id, never answered with the old row in silence. A
   `unique` value is carried by one live row of the class (two DNAT rules on
   one port are a collision, not a product detail): the ask is refused with
   the holder's id, and a REAPED row releases its value. One handover is
   allowed and bounded: the broken row a re-ask ends passes its value to
   the successor, and `poll()` withholds the successor's birth — a typed
   `withheld` entry naming the predecessor, never an empty answer — until
   that predecessor is REAPED, by the reap offered in the same beat or by a
   human when the reap rested (inv. 6). The params ride the work as data
   beside the six positions and reach the recipe as `SHAPER_PARAM_<KEY>`
   on an environment the maker BUILDS (maker template inv. 2): never a
   seventh argv, never a string, never `process.env` inherited — that
   inheritance is the door through which a ledger row would have carried
   `LD_PRELOAD` or `BASH_ENV` to a shell running as root. Assigning the
   value is the product's act, in process, before `desire()`, reading
   `listRows()`: the contract does not allocate, it guarantees uniqueness.
10. <a id="an-adopted-row-creates-nothing"></a>**An adopted row creates
   nothing.** A container that already exists — born by hand, before the
   ledger — is brought under the ledger by a fourth kind of work, `adopt`,
   never by the stamp: the stamp's idempotence is keyed by row id, its
   "already exists" is only ever its own replay, it launches what it does
   not find and exec's inside, and its work is withheld until a maker
   declares the matrix — which a container born of no matrix never has. An
   adopted row is written with `matrix: "none"` and `digest: "none"` (two
   words, so that a missing matrix or digest stays the defect it is) and
   names its container through the params slot, `instance`, which its
   class declares (`unique`, so that two rows never adopt one container);
   a nameless adopted row is refused, typed. Its birth is `adopt` work, not gated by the inventory and not
   preloaded; it purrs only on an ADOPTED whose facts hold — the container
   runs, and `legacy: true`, the recipe's own admission that the instance
   was born outside the ledger; ADOPT_FAILED degrades. Its digest is never
   a referenced matrix. What the adopt recipe of a host kind must do
   belongs to the class repository and is proven on terrain first
   (`recipes/README.md` says what it may and may not do); this package
   ships the two tables and no recipe. The `instance` param rides every
   work derived for the row — its end, and the validation an ADOPTED
   reporting `checks: true` derives exactly as a STAMPED does — so the
   reap and the validate recipes of that host kind must take the name from
   `SHAPER_PARAM_INSTANCE` too. Until an adopt recipe exists for a host
   kind and both read the variable, no adopted row may name a machine of
   that kind, and an adopt recipe must not report `checks: true`: the
   shipped `lxd-reap.sh` and `lxd-validate.sh` derive the name from the
   row id; the one would prove the absence of an instance it never looked
   for, the other would find no such instance (exit 2) and degrade a
   healthy tenant.

## How to run

```js
import { createGovernor, createGovernorServer } from '@shaper/pkg-governor';
```

See `test/governor-contract.test.js` — the contract is its tests.
