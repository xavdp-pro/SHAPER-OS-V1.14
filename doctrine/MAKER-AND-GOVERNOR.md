# The Maker and the Governor

> **Status**: founding doctrine, assembled on 2 September 2026 from the operator's
> rulings of 27 August – 1 September (the demo fractal's design sessions, kept
> with the project's notes outside this repository), the contract executable in
> `pkg-governor` and `_maker-template`, and the first birth in the `demo`
> environment (1 September). The contract was written before its philosophy.
> This document writes the philosophy, so that the second client of these
> organs — **WMANAGER**, a Windows fleet manager — inherits the *why* and not
> only the *how*. WMANAGER is the worked example throughout, as an example: its
> field survey lives with the project's notes, never here.
>
> Passed through an adversarial reading on 2 September and amended. Where the
> shipped code does not yet carry a mechanism this page describes, the page
> says **TARGET** beside it; the gaps are also recorded in
> [`CONVERGENCE-STATE.md`](./CONVERGENCE-STATE.md), amended in this release.

---

## 1. The law, in three lines

**The governor writes what should exist. The maker makes it true. Neither ever
commands the other: the maker asks, the governor answers, and the gap between
the ledger and what makers report is the only source of work.**

Everything else in this document is a consequence.

---

## 2. Why two organs, and not one

For a year the house could deploy, repair and restore — but always with a human
launching a script. `provision-lxc-univ.sh` existed; nobody called it. The
demo SaaS asked the question the house had never asked: *what makes a universe
that does not yet exist, with no human at the keyboard, on a host the requester
cannot reach?*

The answer split in two, and the split is the doctrine:

| | The governor | The maker |
| :--- | :--- | :--- |
| What it holds | **the ledger** — the desired state | **root on one host**, in its vault |
| What it does | writes rows, hears silences | executes frozen recipes, reports facts |
| What it never does | touch a machine | decide anything |
| Who reaches it | humans and makers, by its two doors | **nobody** — it listens on nothing |
| How many | one per ledger — a governed scope, what a class's `governedBy` names | **one per machine**, never per project |

**One organ cannot be both.** A thing that holds the ledger *and* root on hosts is
reachable and powerful at once — the exact combination
[`DIRECTION-IS-THE-BOUNDARY.md`](./DIRECTION-IS-THE-BOUNDARY.md) forbids. A thing
that only executes but also decides is a robot with opinions, and a robot with
opinions cannot be audited. The split is not modularity for its own sake: it is
the only shape in which *a form field can never reach a shell*.

---

## 3. The governor

### 3.1 Definition

The word was born on 31 August from the operator's phrase *"a maker inside a SaaS
manager, or a top-of-fractal manager"*. It names something the house had without
naming it: **the universe that holds a ledger and makes it respected.**

The demo SaaS is a governor. WMANAGER is a governor. CLINIC's SaaS will be one.
**The maker never learns which — it reads an address.** This is
[`THE-SYSTEM-LEARNS-NO-DIALECT.md`](./THE-SYSTEM-LEARNS-NO-DIALECT.md) applied to
the hierarchy itself: one does not know one's chief, one knows one's chief's
address — and a maker that serves several ledgers reads a table of addresses
(§4.3).

### 3.2 The three laws

1. **It governs by writing, never by commanding.** Its only act is a ledger row
   of desired state. Realisation belongs to makers. There is no "deploy" button
   in a governor; there is a "desire" and then there is watching.
2. **It is the only memory.** What is not in the ledger does not exist. What is
   in the ledger and not reported as running is a drift, therefore work. A
   governor that forgot its rows would abandon every universe it asked for —
   which is why the ledger is read back in full at boot, unlike a queue whose
   durability is evidence and never resumption.
   *Today the governor derives work from state and deadline only; drift of a
   running instance is not observed. TARGET: the maker declares at every poll
   the instances it actually runs (by row id, from `lxc list`), the governor
   re-dates PURRING on each declaration, and a missing instance becomes stamp
   work.*
3. **It hears the silences.** It dates every maker's last call. Absence beyond
   the declared interval is an alarm out of band (Rule 27), never a green tile.
   A maker that calls and leaves empty-handed has *nothing to do*; a host that
   stopped calling is *dead*. The two are distinct events, and the poll is
   what distinguishes them. *(TARGET until the maker's manifest declares
   `alerting`, the maker declares its interval at every poll, and
   `silentMakers` is wired to that channel — today the silence is computed,
   not heard.)*

**Rule 36 and the governor — who is the Parent.** Rule 36 gives the Parent
universe the authority to instantiate, access and destroy its children, with an
SSH authority key that never leaves it. In this contract, that Parent is the
tandem and, for birth and end, the machine's maker acting on a row — never the
governor. The governor holds no key and opens no session; it writes. The
parent public key reaches a child through the stamp recipe, as a file, never as
a command built from the row.

### 3.3 The ledger

Rule 37 defines the ledger. **This contract amends its row and its automaton,
and says so** (the amendments land in Rule 37 and Rule 27 in this release):

- `tag` becomes `matrix` + `digest` — the artefact, not the repository tag;
- `bucket` is derivable and not stored; `id`, `account`, `deadlineAt`,
  `createdAt`, `updatedAt` and `params` are added;
- a fifth, terminal state **REAPED** enters the automaton — the failure it
  prevents: a reaped row still counted as living blocks its account forever
  and pins its matrix;
- a DEGRADED row leaves that state only by its account's new ask, and only for
  the environments a robot may end (Rule 27 amended, §10); a PROD row leaves it
  by human action alone;
- `pkg-governor` carries the ledger table contract; `brick-forge` no longer
  will.

The ledger is **the table of desired state and of what was reported about it,
one row per instance** — in the database of the governing universe. It is the
only store of instances: a class has a git repository; an instance never does.
An instance is a row, a vault and volumes.

Four stores that must never be confused:

| Store | Answers | Form |
| :--- | :--- | :--- |
| **git** | what a class IS | repositories, versions |
| **`fleet.yml`** | which classes and machines exist, at which tags | the map — never instances |
| **the artefacts** | the bytes we deploy | matrices (sha256), brick images (digests) |
| **the ledger** | what SHOULD exist, instance by instance, and what each maker last reported about it | one row per instance: desired state + dated events |

*The repository says what a class is. The map says which classes and machines
exist, at which tags. The ledger says which instances are desired and what was
reported. Work is the gap between a row and the facts reported for it (§1).
The gap between map and ledger is an audit, never maker work
([`FLEET.md`](../docs/architecture/FLEET.md), law 3).*

A row carries: `id`, `account`, `klass`, `matrix`, `digest`, `machine`, `env`,
`params`, `state`, `deadlineAt`, `createdAt`, `updatedAt`, `events[]`. States:
`DESIRED → RECONCILING → PURRING | DEGRADED | REAPED`. Transitions are **a
table, not branches** — a new event kind is one line. `VALIDATING` keeps the
row PURRING: a claim, not a verdict.

Four properties of the ledger that are not obvious until one needs them:

- **Desired state is idempotent.** One live row per `(account, klass)`; asking
  twice creates once. The double-click births one universe. A live row's
  `params` are immutable like its digest: a re-ask with different `params` is
  refused with the row id, never ignored in silence (§8.4, D1).
- **Deadlines are desired state.** A row past its deadline yields reap work on
  the next poll. Destruction is scheduled and verified, never a timer inside a
  robot (`pkg-governor/INTENT.md`, invariant 6). *The shipped code stamps a
  DESIRED row that is already past its deadline, then reaps it — a birth for
  nothing; the contract's intent is that a row past its deadline is never
  stamped. TARGET, recorded with the gaps.*
- **A degraded row whose env a robot may end (dev, test, demo) is not a life to
  protect.** Asking again ends the broken one and starts fresh, in the same
  poll. An account is never walled behind its own failure. **A degraded PROD
  row is a life to protect**: asking again is refused with the row id; its end
  is a human decision (Rule 27). A refusal is a fact, not a failure: the reap
  recipe's exit 4 becomes the event `REAP_REFUSED`, the row rests in DEGRADED,
  no twin is created, the reap is not offered again, and the alarm leaves out
  of band. Repeated reap failures on one row back off and stop after
  `maxHealingAttempts` (Rule 27) — a reconciliation loop that cannot give up
  is a storm generator.
- **A claim is not a life either.** `STAMPING` and `REAPING` are claims; the
  shipped code offers a `validate` claim again once it has gone silent past
  its budget, but a stamp or reap claim that went silent stays RECONCILING
  and is counted as living. *TARGET: a claim budget for stamp and reap —
  a STAMPING claim gone silent is re-offered.*

### 3.4 The two doors

A governor has exactly two doors and confuses them never:

- **The maker door**: the contract's own HTTP server, one token per maker,
  bound to an address reachable only over the VPN (published by socat on the
  mesh address — the house pattern). It answers `enrol`, `poll`, and `events`
  on `/api/work/<rowId>/events`. Nothing else.
- **The human door**: the product's ordinary web surface. It calls the governor
  in-process and **never exposes the maker protocol**.

The demo SaaS's SQL keeps only *who asked for what* (account → row id). The
instance's *life* — states, events, deadlines — lives in the governor's ledger
alone: its database. The JSONL journal in `pkg-governor` is the package's
reference adapter and the demo's transitional storage, recorded as a gap in
[`CONVERGENCE-STATE.md`](./CONVERGENCE-STATE.md) (Rule 26). Two truths would
be one too many.

### 3.5 Enrolment is the tandem's act

A maker never enrols itself. A human and their agent — root on the system,
coming in from underneath as `SECURITY-FOLLOWS-FUNCTION` describes — bring a
maker into being and declare it to its governor with the admin credential.
**The fleet is not a place one walks into.** Self-enrolment would mean that
whoever can run a maker can join the fleet.

Enrolment is also where **two names are bound**: `host`, what the kernel answers
when asked (`vps-053c1354`) — the identity, because it is the only name that
cannot drift from reality; and `fleetName`, what the map and the humans say
(`gbs-test`) — what a row names, because a row is written by a person or a
product, not by a kernel. The first birth found the defect this prevents: rows
written for `gbs-test` while the maker asked as its hostname, and work silently
never delivered.

---

## 4. The maker

### 4.1 Definition

**The hand of a machine.** It asks its governor what should exist on its host,
stamps universes from matrices, reports what happened, and goes back to asking.
It is the only actor that can make a universe that does not yet exist — *which
is why it cannot live inside one it stamps, and why it holds the root power of
its host in its vault.* It is a robot: it does not decide, it does not
interpret, it does not improvise.

**The maker is a universe (Rule 11), one instance per machine, the lowest floor
of the fractal — not outside it. What is outside the fractal is the root power
on the host that it holds in its vault.**

### 4.2 The twelve invariants (the law of `_maker-template/INTENT.md`)

1. **Nothing can open a connection to it.** No port, no certificate. It calls
   outward. A stolen credential may lie about its own host's rows, never about
   another's, and never command a host: the governor binds every report to the
   machine the row names, as it already binds every poll.
2. **It executes a frozen recipe with typed parameters.** Arguments are passed
   as argv, never concatenated into a shell string; the row's `params` reach
   the recipe as `SHAPER_PARAM_<KEY>` variables on a constructed environment
   (§8.4, D1). Pulling work is not permission to interpret it.
3. **It never chooses.** Which machine, which matrix, birth or move: the
   governor decides and writes it. The maker reconciles what it reads with what
   it observes.
4. **Its lanes are the capacity of its host, set from above.** A child asking
   whether it deserves more is judge and party (Rule 23). *TARGET: today the
   maker announces its lanes and the governor records them. The from-above
   assignment — lanes fixed at enrolment, echoed in the poll answer, never
   more work handed than lanes — is not built.*
5. **It declares itself by its hostname**, asked of the host, never by a
   configured label that can drift.
6. **It declares what it holds** — the matrices it carries, by digest, at every
   poll. A universe is never assigned to a machine that has not proven it holds
   the bytes; a `DESIRED` row whose digest the maker does not hold is named in
   the poll answer's `withheld` list, never skipped in silence. *(The image lock held digests the registry had never heard of —
   once. Never again.)*
7. **It is created and enrolled by the tandem.**
8. **Its silence is an event.**
9. **Two credentials, never confused.** The one that speaks to the governor may
   only ask and report. The one that acts on the host is the machine's own
   power, in this universe's vault, reachable by no one.
10. **A birth is reported from facts, never from an exit code.** A stamp ends
    with one line of facts — what the host observed of the child — and a stamp
    whose output holds none is a failure, not a birth. An end is proven by the
    recipe's exit code (absence verified, or not); a birth only by what it
    looked at.
11. **A refusal is reported under its own name.** A recipe may refuse — an
    unverified matrix, an absent one, a production universe asked to end — and
    says so by its exit code. The reap's refusal has its own event
    (`REAP_REFUSED`), because it is the one the governor would otherwise offer
    again at every beat; a stamp's refusal degrades the row as `STAMP_FAILED`
    and the row is never offered a stamp again, so it cannot storm.
12. **It adopts what it did not make, without touching it.** An adoption binds
    a ledger row to a container that already existed, named by the row's
    `instance` param, and is proven like a birth: by the facts the recipe looked
    at (the container runs, `legacy: true`), never by an exit code. The recipe
    creates nothing, launches nothing, and never exec's inside: a frozen tenant
    is frozen.

### 4.3 One maker per MACHINE, never per project

The operator asked, on 31 August: several fractals will share gbs-test — one
maker per project, or one for all? **One per machine**, for four reasons in
order of force:

1. **Multiplying holders of the same power isolates nothing.** Three makers on
   one host are three times root on that host — no partition gained, three
   secrets to rotate and to lose.
2. **The maker is a robot, not a brain.** It receives *which matrix* as a typed
   parameter. Precisely because it has no business logic, one suffices.
3. **Capacity is a property of the machine.** With three makers, nobody holds
   the budget: each believes it may launch five, the machine receives fifteen
   and dies. With one, its lanes ARE the host's capacity.
4. **The two axes stay orthogonal.** Adding a machine = adding a maker. Adding
   a fractal family = adding a matrix, touching no maker.

The day two projects require *different powers* (one touches DNS, the other
WireGuard), one splits — **by capability, never by project.**

*Proven today for one governor per machine. A maker serving N governors from
one vault-held table `{governorUrl, token}` with one shared lane budget is
TARGET; until it exists, reason 3 holds only because each machine has one
governor.*

### 4.4 The maker lives in an LXC — ruled, not yet built

Ruled by the operator on 31 August: *"more practical, and the hosts become
completely interchangeable."* The maker is a universe holding, in its vault,
the power to act on its own host.

This is an architectural property, not a convenience. If the maker is a
universe, **the host no longer holds anything that matters**: it is merely a
place where a maker runs. Replacing a machine becomes a restoration, not a
reinstallation (proven 30 August: a universe reborn on another host, encrypted
secret included). Adding a machine needs no ceremony: the new maker starts
asking and announces itself. The maker backs up, is watched and moves with the
tools the house already has — instead of being a script somewhere whose state
nobody knows.

**Ruled 31 August, not yet built.** The shipped recipes act on the host
directly and the poller asks under `os.hostname()`, which inside an LXC is the
container's name — a chosen label, the opposite of invariant 5. The LXC form
needs a hop whose arguments never cross a remote shell — the recipe travels to
the host and reads its positions from stdin as one JSON line, never as an ssh
command string — and an identity asked of the HOST (`ssh host hostname`),
tested with the hostile account string before it ships. TARGET.

**The maker does not belong to any project.** Naming it `univ-demo-maker` would
tie it to the most ephemeral of three clients and rebuild it twice (the lesson
Rule 29 already paid: *a correction that stays in an instance is deleted with
the instance*). Its home is the base, beside `_template`; each machine
instantiates one; its runtime slug names its machine.

### 4.5 The forge and the maker are not on the same floor

*"brick-forge is for podman, so another level; we are talking bare metal,
almost, even on a VPS."*

| | brick-forge | the maker |
| :--- | :--- | :--- |
| Where it lives | **inside** a universe — it is a brick | in its own LXC, outside every universe it stamps |
| What it touches | what already exists: restart, repair, redeploy | what does not yet exist: birth |
| Its level | podman | LXC / bare metal |

**One cannot be inside a universe that is not yet born.** That is the deep
reason the maker holds root on its host, from its own universe. The sharing,
in one line each: **the forge repairs bricks inside a living universe** (podman
level; drift at brick level); **the maker births and ends universes from
matrices** (LXC level; gap at instance level). The forge repairs what lives;
the maker gives birth. The lexicon's page test follows (§10): *who repairs?* —
the forge, inside a universe; *who births?* — the maker, from a row.

---

## 5. The recipe

A recipe is `<hostKind>-<workKind>.sh` — `lxd-*.sh` (shipped), `proxmox-*.sh`
(not yet written), and a third host kind whose token must not read as the LXD
CLI: `liblxc` (§8.4, D2). It receives **typed positional arguments** —
`rowId klass matrix digest account env` — plus the row's `params` as
`SHAPER_PARAM_<KEY>` variables on an environment the poller constructs (PATH,
HOME, LANG, LC_ALL and TMPDIR, the operator's `SHAPER_*` — never a
`SHAPER_PARAM_*` of the poller's own — and the row's allow-listed keys; nothing
else of its own process), and
interpolates none of them into a composed command. The instance name comes
from the **row id**, never from account text: the row is ours and its shape is
known; the account belongs to a stranger.

Every recipe ends with **one JSON line of facts**. The governor derives work
from facts, never from prose: the stamp says whether the child ships an
acceptance spec (`checks:true`), and from that fact alone the governor derives
`validate` work — learning nothing about what the class is. A stamp whose
output cannot be read as facts is `STAMP_FAILED`, never a success by default;
a stamp becomes PURRING only when the fact it reports is a container
`Running` — a stopped container never purrs.

Four work kinds, each one line in the maker's event table and one line per
outcome in the governor's transition table (three, four for `reap` with its
refusal), plus its recipe:

| Kind | What it does | What it reports |
| :--- | :--- | :--- |
| `stamp` | births an instance from a matrix, idempotent by row id | `STAMPING` → `STAMPED` / `STAMP_FAILED` |
| `reap` | ends an instance and proves the absence | `REAPING` → `REAPED` / `REAP_FAILED` / `REAP_REFUSED` |
| `validate` | runs the child's own acceptance spec | `VALIDATING` → `VALIDATED` / `VALIDATION_FAILED` |
| `adopt` | binds a row to a named existing container, looks, reports | `ADOPTING` → `ADOPTED` / `ADOPT_FAILED` |

`adopt` exists because the shipped stamp cannot adopt: its idempotence is keyed
by row id, and it would launch, then `exec` inside — the gesture forbidden on a
frozen tenant. The adopt recipe receives the container name through the
`params` slot (`SHAPER_PARAM_INSTANCE`), never `exec`s inside, reports the fact
`legacy: true`, and is not gated by the matrix inventory: an adopted row may
carry `digest: none`, and the contract says so. The class declares `instance`
as a `unique` string in its `paramsSchema`, so two rows can never bind the same
container.

Three obligations, each paid for on terrain:

- **Idempotent by construction.** A stamp replayed finds its instance and
  reports "already exists — nothing to stamp". A reap replayed finds nothing
  and exits 0: *a retry must never fail*, or the row stays DEGRADED forever.
- **The end is verified, not announced.** Reap destroys, then looks again, and
  only then reports. A GC that says "done" without looking is exactly the lie
  `proof.sh` was corrected for.
- **A robot never ends a production universe.** `env=prod` → refused, exit 4,
  reported as `REAP_REFUSED`: a fact, not a failure. Rule 10 destroys TEST
  after proof, Rule 36 destroys DEV after promotion; a PROD instance ends by a
  human decision, elsewhere. Every `<kind>-reap.sh` carries this guard before
  any prod row exists on its host kind.

**No recipe ships before it has run on real terrain.** A snippet published
untested has already cost a sealing run (finding F25 of
[`TESTING-REPORT.md`](../docs/TESTING-REPORT.md)). The proof table lives in
`recipes/README.md`, one section per shipped recipe — `stamp`, `reap` and
`validate` — with what was observed under which conditions, never a promise
(Rule 10).

---

## 6. The matrix

A **matrix** is the prefabricated universe image from which instances are
stamped: system, application, agent, seed data — baked together, versioned,
locked by fingerprint. Birth *instantiates*; it does not install.

Three words that must not be confused — two are already in the lexicon
([`LEXICON.md`](../docs/architecture/LEXICON.md)), the third is the candidate
(§10):

- a **class** is the definition (repository, manifest, INTENT);
- a **matrix** is the locked artefact built from the class, ready to stamp;
- an **instance** is a ledger row, born from a matrix.

Class : matrix :: source : binary.

**Ruled 31 August: a matrix is a content-addressed file** — a rootfs archive
and its sha256. The identity is the content, so it survives copying: the same
bytes on two machines carry the same identity, with no rebuild and no central
store. This was the only path through the blocker the demo met: *five builds of
one commit gave five fingerprints*, because the podman registry is per machine
and bakes its host into the locked identity. The sha256 names the stored file;
whether one pivot serves three host kinds — a bare rootfs hashed, wrapped at
import by each stamp — is decided by the second recipe, not by this page.
*"One truth" across host kinds is TARGET until `proxmox-*` or the third kind
exists and proves its matrix format in `recipes/README.md`.*

**Who makes a matrix: the tandem — the vibe coder and their AI agent.** Never
the maker, never the governor. The maker only stamps bytes it has been handed
and verifies they hash to their name; the governor only references a digest it
has been told exists. Baking a matrix — building the class, locking the
fingerprint, proving it, promoting it — is the work of the human and their agent,
root on the system, coming in from underneath. It is the same act as enrolment:
the fleet's identities and the fleet's artefacts both enter by the tandem's
hand, and by no other. A robot that could bake its own matrix could also bake
what it stamps, and the fingerprint lock would guard nothing.

Three cadences, never mixed:

1. **Stamping** (the fast clock): an instance is born from a frozen matrix —
   the maker's act.
2. **Evolving a matrix** (a build cycle): build, lock, prove, publish a new
   version — the tandem's act. Living instances do not move.
3. **Raising an instance** (a decision): carry it from one matrix version to
   the next — backup first, proof after.

**An instance is pinned to the fingerprint that birthed it.** Improving a
matrix touches no living instance. Without this rule, improving an image would
silently break clients in production — exactly what the fingerprint lock exists
to prevent. And **no fingerprint may be deleted while a living row references
it**: the ledger answers which digests are held (`referencedDigests`); *the
deletion gate that consults it is TARGET — today no GC of matrices asks.*

Maturity is the house's usual ladder — DEV explores and breaks, TEST rebuilds
from zero and proves then is destroyed, PROD — with one machine-checkable
invariant:

> **`maturity(matrix) ≥ environment(instance)`**

*TARGET: today the invariant binds by reading — the row has no maturity field
and no store carries the label; the governor's `matrices` table
`{digest, maturity, promotedAt}` and a refusal in `desire()` are a declared
gesture of the base.* A DEV instance from a PROD matrix is normal. A PROD
instance from a DEV matrix is refused: it is putting a client on the unproven.
One promotes **a fingerprint, never a recipe**: TEST→PROD moves a label on the
same bytes. Rebuilding is shipping something other than what was proven. Hence
the maturity is *not in the name* — what varies goes in structured data, never
in the identifier (Rule 37, the ZEST grammar).

---

## 7. The fractal, and its levels

The pattern nests. A governor's instances may themselves be governors of their
own children, each level speaking the same contract downward and asking the
same contract upward. This is [`FRACTAL-ARCHITECTURE-BY-EXAMPLE.md`](./FRACTAL-ARCHITECTURE-BY-EXAMPLE.md)
made concrete: the fleet manager of fifty children is a governor; each child
that governs something is a governor; and no level knows its chief beyond an
address.

What crosses a level boundary is **always and only**: desired state downward
(rows), facts upward (events), and silence in both directions. Never a
command, never a credential that commands, never a dialect.

The operator's three projects are three verticals of one fractal:

| | Demo SaaS | **WMANAGER** | CLINIC |
| :--- | :--- | :--- | :--- |
| Governor | the free SaaS | **the fleet manager, two administrators** | the paid SaaS |
| Account | a visitor | **a practice (a regulated profession)** | a clinic |
| Instance | a CRM with a deadline | **a VPN tenant universe** | a clinic's universe |
| Public face | sign-up, magic link, client space | **none** — the practices never log in | client space, back-office |
| Lifetime | a deadline, then reaped | **no deadline** | contractual |
| Regime | produce with Shaper OS | **full production** | full production |

The organs are identical. What changes is the content of the instance, its
lifetime and its public. CLINIC is the demo's *twin* (real accounts, client
space, near self-service onboarding — its own specification's *"a new client is
a row and a configuration, no provisioning"* is the ledger, the maker and the
matrix word for word). WMANAGER is the *cousin*: two administrators, no client
accounts, no public façade. It shares the machinery and the operator admin, not
the shop.

**Build order, ruled and kept**: demo first, WMANAGER second, CLINIC third —
*"one learns the gesture where a mistake costs nothing, then applies it where
it would cost dearly."* The condition for WMANAGER to start — *organs proven by
a demo that works, even without charm* — was met on 1 September 2026: governor
on one machine, maker and instance on another, a visitor over the public
internet, the fourth bar being the governor's own verification in a real
browser — fast and structured (Rule 10); the measured run and its conditions
live in the deployment note of that day, with the project's notes.

---

## 8. The worked example: a Windows fleet manager

### 8.1 What it is

**W = Windows.** A fleet manager for a few dozen regulated practices on
Windows, two administrators in two countries, no client login; one VPS running
plain LXC tenants, one in development, three frozen in pseudo-production;
everything derives from a tenant number `N`. Not a SaaS. The practices are
managed; they do not log in.

The business doctrine behind it: Shaper OS is the factory, not the product.
The product is *"a range of SME services pulled from the hat by sector"*. The
operator lays the base, proves it on one or two clients, then **hands the
fleet over** to its administrator and returns only for infrastructure. What
makes the hand-over durable is not prevention but **reversibility**: regular
backups of every system, with the restoration tested, not the backup. Three
nets with no overlap: backup for the noisy and reversible; tests and `shaper
verify` for the silent; the authority boundary (preflight, production halt,
recorded human override) for the irreversible — a mail sent, an invoice
issued, an intervention on a practice's workstation. None excuses the other
two.

### 8.2 What the terrain already runs

This section covers the **`liblxc` host family**: plain LXC on a Debian host —
not LXD, not Proxmox (Rule 11 asks a document that covers one family to say
which in its first paragraph; the family itself enters the law by D2, §8.4).

The host already runs the pattern this doctrine generalises —
[`DIRECTION-IS-THE-BOUNDARY.md`](./DIRECTION-IS-THE-BOUNDARY.md) names it:
*"WireGuard clients on `gbs-vps`: passive, no public address, they go fetch."*
Four tenants, each an unprivileged LXC with its own WireGuard server: T10 in
development — the only one that may be touched — and T11-T13 in
pseudo-production, **frozen**. *Pseudo*: born without Shaper OS inside (bare
Debian + WireGuard). Real production is the one that carries the universe
(Rule 11: LXC = universe, podman = brick). The host also carries production
applications and the root mesh, both under a standing prohibition.

**Everything derives from the tenant number `N`** — the single real parameter:
one overlay subnet, one host↔container subnet and bridge, one public UDP port
translated to the tenant, one firewall tag. A compromised tenant reaches the
internet and its own overlay, nothing else. A hand-written provisioning script
creates a tenant in seven steps, four of which act on the host outside the
container; its temporary name says everything: **these gestures have no
home.** A boot unit already sweeps every autostart container, raises WireGuard
in each and replays every firewall script — a reconciliation, but a blind one:
at boot only, no ledger, no report. **It is the maker's ancestor, and the exact
hole the maker fills.** One drift is already visible: a peer whose access was
never revoked. The ledger does not know it, therefore it should not exist —
the first proof to hand the administrator.

The tenants, the addressing plan, the script, the unit, the drift and the
Windows-side audit are the field survey of 2 September, kept with the
project's notes.

### 8.3 The mapping — what fits the contract unchanged

| Contract | WMANAGER |
| :--- | :--- |
| governor | WMANAGER itself, `pkg-governor` vendored WITH provenance recorded (the pinned exemption [`UNIVERSE-REPO-BIRTH.md`](../docs/agent/UNIVERSE-REPO-BIRTH.md) grants `pkg-verify`), replaced by the published package the day it exists; the storage adapter bound to WMANAGER's own database (Rule 26) |
| `account` | the product's own client identifier — an opaque id the product assigns, never free text |
| `klass` | `univ-wmanager-vpn` (to ratify, Rule 1 grammar) |
| `matrix` / `digest` | the tenant rootfs archive, baked by the tandem from the class repo `univ-wmanager-vpn` (born by [`UNIVERSE-REPO-BIRTH.md`](../docs/agent/UNIVERSE-REPO-BIRTH.md); T10 becomes its first DEV instance), proven TEST then promoted — never a snapshot of a hand-built container |
| `params` | `{ n }` — the tenant number, typed, unique per live row of the class (D1) |
| `machine` | `gbs-vps` (fleetName), bound at enrolment to the hostname asked of the host |
| `env` | `prod` for the frozen tenants — `liblxc-reap.sh` MUST carry lxd-reap's exit-4 guard before any prod row exists |
| `deadlineAt` | `null` — a practice has no expiry |
| maker | an LXC universe on `gbs-vps` (§4.4 — TARGET until the LXC form ships; until then the maker runs on the host), the host's power in its vault, token in its vault |
| silence | a tenant that stops reporting, a maker that stops calling → out of band |

**Adopting the existing tenants is the first reconciliation, and it needs the
fourth work kind.** The shipped stamp cannot adopt: its idempotence is keyed by
row id, and it would launch then `exec` inside — the gesture forbidden on a
frozen tenant. T11-T13 are adopted as rows of `univ-wmanager-vpn` with
`env: prod`, `digest: none` (allowed for an adopted row), and the fact
`legacy: true` reported by `liblxc-adopt.sh`, which binds the row to the named
container (`SHAPER_PARAM_INSTANCE`), looks, and reports without ever entering
it — not gated by the matrix inventory, proven on T10 first, one line in each
of the two tables. The class repo exists before adoption; T10 is its first
instance carrying Shaper OS. Until `adopt` is proven on that host, no DESIRED
row may name a machine holding a frozen tenant.

The product's own records feed facts, never decisions. WMANAGER **pulls** a
read-only inventory from them (a dedicated key, no write route) and reads
*its own copy* — slower to reflect a change, far more robust: WMANAGER keeps
working when the source is down. Identifiers that third-party systems assign
already live in those records; the tenant number has the same shape. **The
governor assigns, the records learn.**

### 8.4 What does not fit — three decisions, taken

**D1 — `N` has no place in the six positions: the `params` slot.** The recipe
may not derive `N` from `account` (invariant 3: it does not decide; and
`account` is a stranger's text). The matrix may not carry `N` (one archive per
tenant would break "promote a fingerprint"). The only conforming path, in the
base with its tests (Rule 29: what serves several projects lives in the generic
path; CLINIC will need it too):

- **Form.** `params` is a flat object of scalars (string, number, boolean),
  keys `^[a-z][a-z0-9_]{0,31}$`, validated by the governor against an
  allow-list of keys the product declares at creation —
  `createGovernor({ paramsSchema: { 'univ-wmanager-vpn': { n: { type: 'number', unique: true } } } })`.
  `desire()` refuses an unknown key, a non-scalar value, and — for a key marked
  `unique` — a value already held by a live row of the same `klass` (two DNAT
  rules on one port are a collision, not a product detail). A live row's
  `params` are immutable like its digest: a re-ask with different `params` is
  refused with the row id, never ignored in silence.
- **Transport.** Never a seventh argv carrying JSON (a blob, and `jq` inside a
  frozen recipe); never a string. Environment variables `SHAPER_PARAM_<KEY>`
  (key upper-cased), passed through the `env` option of `execFile` on a
  CONSTRUCTED environment — PATH, HOME, LANG, LC_ALL and TMPDIR, the operator's
  `SHAPER_*` (never a `SHAPER_PARAM_*` of the poller's own) and the row's
  allow-listed keys; nothing else of the poller's own process. This is what
  closes the door a ledger row
  carrying `LD_PRELOAD` or `BASH_ENV` would otherwise open into a root shell.
  The `lxd-*` recipes are unchanged; `liblxc-stamp.sh` reads `$SHAPER_PARAM_N`.
- **Assigning `N`** is the product's act, in process, before `desire()`,
  reading `listRows()` — the contract does not allocate, it guarantees
  uniqueness.

**D2 — a third host family, and its token is not `lxc`.** `lxd-stamp.sh` calls
a binary named `lxc` (the LXD CLI), and Rule 11 names its second family "native
LXC/LXD" with LXD commands: a kind called `lxc` would read as the family it is
not. The token is **`liblxc`** — the library, unpronounceable as the CLI:
`kind: proxmox | lxd | liblxc`, recipes `liblxc-stamp.sh`, `liblxc-reap.sh`,
`liblxc-adopt.sh`. Adding the family amends three texts in **one** PR, before
the first recipe exists: [`FLEET.md`](../docs/architecture/FLEET.md) (the
`kind` enumeration), Rule 11 ("two host families" becomes three, with the
nesting prerequisites of the liblxc family — `lxc.include`, an unprivileged
idmap — and the same proof, *launch a throwaway nested container*), and
`_maker-template/INTENT.md` (one recipe set per host kind) — amended in this
release.

The WMANAGER stamp does more than launch a container: four of the seven
provisioning steps act on the *host* outside it — bridge, DNAT, isolation
rules, a systemd unit. `liblxc-stamp.sh` is a wider recipe than its sisters.
It stays frozen, typed, idempotent step by step, and **proven on T10 only**
before it exists; its `reap` undoes the four host things and *proves the
absence*. Three conditions: the four host gestures derive only from the typed
`params` (`N`), never from `account`; `liblxc-reap.sh` carries lxd-reap's
exit-4 guard BEFORE any prod row exists; and the matrix format it consumes
(bare rootfs or unified tarball) is proven in `recipes/README.md` — §6's "one
truth" stays TARGET until that proof.

**D3 — which floor for the Windows workstations? Left open, bounded.** "One
live row per (account, klass)" — a practice has many workstations. Neither a
flat reading (one row per workstation) nor a fractal reading (the tenant
governs its workstations) is compatible with the contract *as written today*:
a workstation has neither matrix nor digest, so `desire()` refuses it and
`poll()` would withhold every stamp; a Windows workstation is neither LXC nor
podman (Rule 11); and a slug outside the Rule 1 grammar, or a position written
into an identifier, is refused by the lexicon. Deciding today would invent the
level that is still unruled — who launches the executable on a workstation,
how it enrols.

What is decided is the constraints any answer must satisfy: **a workstation is
not an instance of this contract: it is not born from a matrix, it is not a
container, it is a host.** What a tenant may hold for its workstations is a
ledger of desired configuration with its own work-kind table (enrol,
configure, revoke), spoken by an agent that calls out — the same DIRECTION and
the same shape (poll, inventory, events), not the same rows. Its key is
`(workstationId, klass)` where `workstationId` is assigned by the tenant, never
composed from a client name and a workstation name. The fractal reading —
the tenant is itself the governor of its workstations, and the workstation
agent does what a maker does: it calls out, receives, reports, listens on
nothing — stays the preferred hypothesis, because it makes the "fractal level
above" free instead of invented; it is confirmed or refuted by the first real
enrolment.

One lesson from the Windows side is doctrine already: the vocabulary of a
privileged component with no inbound door — it fetches instructions and acts
on remote machines — is lexically indistinguishable from command-and-control.
Keep it in files, never in messages; the cognition class is declared by
subject ([`COGNITION.md`](../docs/architecture/COGNITION.md), D-depth), never
by engine name. And a proof signed by the author of the code is not a proof —
a lesson, not yet a rule (see [`TESTING-REPORT.md`](../docs/TESTING-REPORT.md),
counter-verified from outside the tester). Assertion is not observation: a
service is running because a query said so, or the fact does not exist. The
workstation agent obeys the same law as the reap recipe: look, then say.

---

## 9. The test

Before shipping any governor, any maker, any recipe, answer three questions.
Any answer other than the one given means the design is not finished.

1. **Who can open a connection to the thing that holds root?** — *Nobody.*
   The host's own SSH door is the tandem's, from underneath (Rule 36), and is
   never the maker's.
2. **Where is the decision taken?** — *In a ledger row, by the governor.*
   Never in a recipe, never in a robot, never in a form. A recipe may REFUSE
   (prod, unverified bytes, absence) — it never CHOOSES.
3. **How do you know it happened?** — *The recipe looked, and reported a fact.*
   Never because it said so: a stamp purrs only on a reported `Running`, an
   unreadable stamp is a failure, and a report is accepted only from the
   machine the row names.

---

## 10. Lexicon amendments (Rule 37 — by amendment, never quietly)

Four nouns enter the lexicon in this release, each with the failure it
prevents written beside it (Rule 37, lexicon closure):

- **governor** — the universe that holds a ledger and makes it respected.
  *Prevents*: "the SaaS" and "the manager" naming two things — the product and
  the organ — and the maker learning which one it serves.
- **maker** — the hand of a machine: asks, stamps, reports, never decides.
  *Prevents*: a script on a host whose state nobody knows, and a form field
  reaching a shell.
- **matrix** — the locked, content-addressed artefact from which instances are
  stamped; baked by the tandem, never by a robot. *Prevents*: "image" meaning
  both a podman image and a universe archive, and five builds of one commit
  giving five fingerprints.
- **REAPED** — the fifth, terminal state, by amendment of Rule 37's automaton.
  *Prevents*: a reaped row still counted as living, blocking its account and
  pinning its matrix. With it, Rule 27's clause is amended: *a DEGRADED row
  leaves that state by its account's explicit new ask, for envs a robot may
  end; a PROD row only by human action.*

What does **not** enter: `stamp`, `reap`, `validate`, `adopt` — kinds of work,
a table, not nouns of the language (as `brick-forge` is not a new noun); they
live in `pkg-governor/INTENT.md`. `class` and `instance` — already there.

Three lines move together, amended in this release: the lexicon's **forge**
line becomes *"`brick-forge`: the organ that deploys/destroys/repairs BRICKS
inside a living universe (podman level; escalation restart → rebuild →
redeploy + R2). Universes are born and ended by the maker, from a ledger
row."*; the lexicon's page test becomes *"who repairs? (the forge, on drift,
inside a universe) — who births? (the maker, from a row)"*; and `FLEET.md`'s
last paragraph becomes *"Not a deploy tool (that is the forge for bricks, the
maker for universes)"*. Rule 37's page test follows them.
