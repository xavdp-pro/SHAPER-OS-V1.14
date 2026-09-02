# The Maker and the Governor

> **Status**: founding doctrine, assembled on 2 September 2026 from the operator's
> rulings of 27 August – 1 September (demo fractal design sessions, `demoproof/`),
> the contract already executable in `pkg-governor` and `_maker-template`, and the
> first production birth (demo.xavdp.pro, 1 September). The contract was written
> before its philosophy. This document writes the philosophy, so that the second
> client of these organs — **WMANAGER**, Grégory's Windows fleet — inherits the
> *why* and not only the *how*. WMANAGER is the worked example throughout.

---

## 1. The law, in three lines

**The governor writes what should exist. The maker makes it true. Neither ever
commands the other: the maker asks, the governor answers, and the gap between the
ledger and the world is the only source of work.**

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
| What it holds | **the ledger** — the desired state | **root on one host** |
| What it does | writes rows, hears silences | executes frozen recipes, reports facts |
| What it never does | touch a machine | decide anything |
| Who reaches it | humans and makers, by its two doors | **nobody** — it listens on nothing |
| How many | one per fractal level | **one per machine**, never per project |

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
address.

### 3.2 The three laws

1. **It governs by writing, never by commanding.** Its only act is a ledger row
   of desired state. Realisation belongs to makers. There is no "deploy" button
   in a governor; there is a "desire" and then there is watching.
2. **It is the only memory.** What is not in the ledger does not exist. What is
   in the ledger and not running is a drift, therefore work. A governor that
   forgot its rows would abandon every universe it asked for — which is why the
   ledger is a journal read back in full at boot, unlike a queue whose
   durability is evidence and never resumption.
3. **It hears the silences.** It dates every maker's last call. Absence beyond
   the declared interval is an alarm out of band (Rule 27), never a green tile.
   A maker that calls and leaves empty-handed has *nothing to do*; a host that
   stopped calling is *dead*. The two are distinct events, and the poll is
   what distinguishes them.

### 3.3 The ledger

The canon (Rule 37) defines it: **the table of desired state, one row per
instance** — in the database of the governing universe. It is the only store
of instances: a class has a git repository; an instance never does. An instance
is a row, a vault and volumes.

Four stores that must never be confused:

| Store | Answers | Form |
| :--- | :--- | :--- |
| **git** | what a class IS | repositories, versions |
| **`fleet.yml`** | what SHOULD exist, at which versions | the map — never instances |
| **the artefacts** | the bytes we deploy | matrices (sha256), brick images (digests) |
| **the ledger** | what exists NOW | one row per instance |

*The repository says what a thing is. The map says what should exist. The
ledger says what exists. The gap between the last two is work.*

A row carries: `account`, `klass`, `matrix`, `digest`, `machine`, `env`,
`state`, `deadlineAt`, `events[]`. States: `DESIRED → RECONCILING → PURRING |
DEGRADED | REAPED`. Transitions are **a table, not branches** — a new event kind
is one line.

Three properties of the ledger that are not obvious until one needs them:

- **Desired state is idempotent.** One live row per `(account, klass)`; asking
  twice creates once. The double-click births one universe.
- **Deadlines are desired state.** A row past its deadline yields reap work on
  the next poll. Destruction is scheduled and verified, never a timer inside a
  robot (Rule 10).
- **A degraded row is not a life to protect.** Asking again ends the broken one
  and starts fresh, in the same poll. An account is never walled behind its own
  failure.

### 3.4 The two doors

A governor has exactly two doors and confuses them never:

- **The maker door**: the contract's own HTTP server, one token per maker,
  bound to an address reachable only over the VPN (published by socat on the
  mesh address — the house pattern). It answers `enrol`, `poll`, `events`.
  Nothing else.
- **The human door**: the product's ordinary web surface. It calls the governor
  in-process and **never exposes the maker protocol**.

The demo SaaS's SQL keeps only *who asked for what* (account → row id). The
instance's *life* — states, events, deadlines — lives in the governor's journal
alone. Two truths would be one too many.

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
It is the only actor in the fractal that can make a universe that does not yet
exist — *which is why it cannot live inside one, and why it holds root on its
host.* It is a robot: it does not decide, it does not interpret, it does not
improvise.

### 4.2 The nine invariants (the law of `_maker-template/INTENT.md`)

1. **Nothing can open a connection to it.** No port, no certificate. It calls
   outward. A stolen credential lets someone impersonate a worker, never
   command a host.
2. **It executes a frozen recipe with typed parameters.** Arguments are passed
   as argv, never concatenated into a shell string. Pulling work is not
   permission to interpret it.
3. **It never chooses.** Which machine, which matrix, birth or move: the
   governor decides and writes it. The maker reconciles what it reads with what
   it observes.
4. **Its lanes are the capacity of its host, set from above.** A child asking
   whether it deserves more is judge and party (Rule 23).
5. **It declares itself by its hostname**, asked of the host, never by a
   configured label that can drift.
6. **It declares what it holds** — the matrices it carries, by digest, at every
   poll. A universe is never assigned to a machine that has not proven it holds
   the bytes. *(The image lock held digests the registry had never heard of —
   once. Never again.)*
7. **It is created and enrolled by the tandem.**
8. **Its silence is an event.**
9. **Two credentials, never confused.** The one that speaks to the governor may
   only ask and report. The one that acts on the host is the machine's own
   power, in this universe's vault, reachable by no one.

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

### 4.4 The maker lives in an LXC

Ruled by the operator on 31 August: *"more practical, and the hosts become
completely interchangeable."* The maker is an ordinary universe holding an SSH
key to its own host (the `--gateway-ssh` pattern of `provision-lxc-univ.sh`).

This is an architectural property, not a convenience. If the maker is a
universe, **the host no longer holds anything that matters**: it is merely a
place where a maker runs. Replacing a machine becomes a restoration, not a
reinstallation (proven 30 August: a universe reborn on another host, encrypted
secret included). Adding a machine needs no ceremony: the new maker starts
asking and announces itself. The maker backs up, is watched and moves with the
tools the house already has — instead of being a script somewhere whose state
nobody knows.

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
| Where it lives | **inside** a universe — it is a brick | **on the host**, outside every fractal |
| What it touches | what already exists: restart, repair, redeploy | what does not yet exist: birth |
| Its level | podman | LXC / bare metal |

**One cannot be inside a universe that is not yet born.** That is the deep
reason the maker is outside the fractal, and therefore holds root. The forge
repairs what lives; the maker gives birth.

---

## 5. The recipe

A recipe is `<hostKind>-<workKind>.sh` — `lxd-stamp.sh`, `proxmox-reap.sh`,
and for WMANAGER `lxc-stamp.sh` (plain LXC, a third host kind). It receives
**typed positional arguments** — `rowId klass matrix digest account env` — and
interpolates none of them into a composed command. The instance name comes from
the **row id**, never from account text: the row is ours and its shape is
known; the account belongs to a stranger.

Every recipe ends with **one JSON line of facts**. The governor derives work
from facts, never from prose: the stamp says whether the child ships an
acceptance spec (`checks:true`), and from that fact alone the governor derives
`validate` work — learning nothing about what the class is.

Three obligations, each paid for on terrain:

- **Idempotent by construction.** A stamp replayed finds its instance and
  reports "already exists — nothing to stamp". A reap replayed finds nothing
  and exits 0: *a retry must never fail*, or the row stays DEGRADED forever.
- **The end is verified, not announced.** Reap destroys, then looks again, and
  only then reports. A GC that says "done" without looking is exactly the lie
  `proof.sh` was corrected for.
- **A robot never ends a production universe.** `env=prod` → refused, exit 4.
  Rule 10 keeps DEV and destroys TEST; a PROD instance ends by a human
  decision, elsewhere.

**No recipe ships before it has run on real terrain.** A snippet published
untested has already cost a sealing run (F25). The proof table lives in
`recipes/README.md`, with observed durations that are never promises.

---

## 6. The matrix

A **matrix** is the prefabricated universe image from which instances are
stamped: system, application, agent, seed data — baked together, versioned,
locked by fingerprint. Birth *instantiates*; it does not install.

Three words that must not be confused (candidates for the lexicon, Rule 37):

- a **class** is the definition (repository, manifest, INTENT);
- a **matrix** is the locked artefact built from the class, ready to stamp;
- an **instance** is a ledger row, born from a matrix.

Class : matrix :: source : binary.

**Decision (c), ruled 31 August: a matrix is a content-addressed file** — a
rootfs archive and its sha256. The identity is the content, so it survives
copying: the same bytes on gbs-test and gbs-p2 carry the same identity, with no
rebuild and no central store. An LXD import here, a Proxmox template there —
one truth. This was the only path through blocker B1 (*five builds of one
commit gave five fingerprints*; the podman registry is per machine and bakes
its host into the locked identity).

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

1. **Stamping** (seconds): an instance is born from a frozen matrix — the
   maker's act.
2. **Evolving a matrix** (days): build, lock, prove, publish a new version —
   the tandem's act. Living instances do not move.
3. **Raising an instance** (a decision): carry it from one matrix version to
   the next — backup first, proof after.

**An instance is pinned to the fingerprint that birthed it.** Improving a
matrix touches no living instance. Without this rule, improving an image would
silently break clients in production — exactly what the fingerprint lock exists
to prevent. And **no fingerprint may be deleted while a living row references
it**: the ledger is the reference counter.

Maturity is the house's usual ladder — DEV explores and breaks, TEST rebuilds
from zero and proves then is destroyed, PROD — with one machine-checkable
invariant:

> **`maturity(matrix) ≥ environment(instance)`**

A DEV instance from a PROD matrix is normal. A PROD instance from a DEV matrix
is refused: it is putting a client on the unproven. One promotes **a
fingerprint, never a recipe**: TEST→PROD moves a label on the same bytes.
Rebuilding is shipping something other than what was proven. Hence the
maturity is *not in the name* — what varies goes in structured data, never in
the identifier (ZEST).

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

The operator's three clients are three verticals of one fractal:

| | Demo SaaS | **WMANAGER** | CLINIC |
| :--- | :--- | :--- | :--- |
| Governor | the free SaaS | **the manager, two admins** | the paid SaaS |
| Account | a visitor | **a practice (notary, doctor, dentist…)** | a clinic |
| Instance | a 3-day CRM | **a WireGuard tenant universe** | a clinic's universe |
| Public face | sign-up, magic link, client space | **none** — the practices never log in | client space, back-office |
| Lifetime | 3 days, reaped | **no deadline** | contractual |
| Regime | produce with Shaper OS | **full production** | full production |

The organs are identical. What changes is the content of the instance, its
lifetime and its public. CLINIC is the demo's *twin* (real accounts, client
space, near self-service onboarding — its §4.3 *"a new client is a row and a
configuration, no provisioning, under 15 minutes"* is the ledger, the maker
and the matrix word for word). WMANAGER is the *cousin*: two administrators, no
client accounts, no public façade. It shares the machinery and the operator
admin, not the shop.

**Build order, ruled and kept**: demo first, WMANAGER second, CLINIC third —
*"one learns the gesture where a mistake costs nothing, then applies it where
it would cost dearly."* The condition for WMANAGER to start — *organs proven by
a demo that works, even without charm* — was met on 1 September 2026:
governor on gbs-p2 (CT 130, two podman bricks), maker and instance on gbs-test,
visitor over the public internet, **17.3 s from the press to the four bars,
the fourth being the governor's own verification in a real browser.**

---

## 8. The worked example: WMANAGER

### 8.1 What it is

**W = Windows.** The fleet manager for Grégory (gbsinfo.org): notaries, but
also doctors, dental practices, gynaecologists — *"a bit of everything"*,
regulated liberal and health professions, all on Windows. Two administrators,
Xavier and Grégory, one in Spain, one in France. Not a SaaS. The practices are
managed; they do not log in.

The business doctrine behind it: Shaper OS is the factory, not the product.
The product is *"a range of SME services pulled from the hat by sector"*.
Xavier lays the base, proves it on one or two clients, then **hands the baby
over** — to Grégory for the fleet — and returns only for infrastructure. What
makes the hand-over durable is not prevention but **reversibility**: regular
backups of every system, with the restoration tested, not the backup. Three
nets with no overlap: backup for the noisy and reversible; tests and `shaper
verify` for the silent; the authority boundary (preflight, production halt,
recorded human override) for the irreversible — a mail sent, an invoice
issued, an intervention on a notary's workstation. None excuses the other two.

### 8.2 What already exists on the terrain (surveyed 2 September, read-only)

`gbs-vps` (Debian 12, **plain LXC** — not LXD, not Proxmox) already runs the
pattern this doctrine generalises. The doctrine itself names it: *"WireGuard
clients on gbs-vps: passive, no public address, they go fetch."*

Four tenants, each an unprivileged LXC with its own WireGuard server:

| Tenant | Client | Status |
| :--- | :--- | :--- |
| T10 | — | **development** — the only one that may be touched |
| T11 | Triollier | pseudo-production — **frozen** |
| T12 | Perriat | pseudo-production — **frozen** |
| T13 | Dr Giorgi | pseudo-production — **frozen** |

*Pseudo*: born without Shaper OS inside (bare Debian + WireGuard). Real
production is the one that carries the universe (Rule 11: LXC = universe,
podman = brick). Standing prohibitions on the host: `/apps` (six production
apps) and the root mesh `wg0` (`10.87.78.0/24`, UDP 20000).

**Everything derives from the tenant number `N`** — the single real parameter:

```
overlay          10.100.N.0/24   (server .1, gregory .11, xavier .12)
host↔container   10.101.N.0/24   (host .1, CT .2)     bridge br-gbsN
public port      UDP 201NN  →  DNAT  10.101.N.2:51820
iptables tag     GBS-TN
```

The mechanism: one DNAT in `nat/PREROUTING`; permissions in **`DOCKER-USER`**
(Docker runs RustDesk on the same host and would clobber `FORWARD`); three
rings of isolation — allowed (VPN entry, established, egress), forbidden in
traversal (mesh, Grégory's LAN, both Docker networks, `wg0` in both
directions), forbidden toward the host itself in `filter INPUT`. A compromised
tenant reaches the internet and its own overlay, nothing else. Inside: a
split-tunnel with **no internet exit through the VPS** and `FORWARD DROP` —
peers do not talk to each other until explicitly opened.

The creation recipe exists: `/root/tmp-provision-t13.sh`, seven steps, T10
cloned as the template, keys written through the rootfs with the unprivileged
idmap. The `tmp-` prefix on a production recipe says everything: **these
gestures have no home.** And a boot service, `gbs-tenant-lxc-boot.service`,
already sweeps every autostart container, raises WireGuard in each and replays
every firewall script — a reconciliation, but a blind one: at boot only, no
ledger, no report. **It is the maker's ancestor, and the exact hole the maker
fills.**

A visible drift: a peer named `ordi-broken` whose access was never revoked. The
ledger does not know it, therefore it should not exist. The first proof to hand
Grégory.

### 8.3 The mapping — what fits the contract unchanged

| Contract | WMANAGER |
| :--- | :--- |
| governor | WMANAGER itself, `pkg-governor` vendored, storage bound to its base |
| `account` | the CRM client id (`clients.id`) — never free text |
| `klass` | `univ-wmanager-vpn` (to ratify, Rule 1 grammar) |
| `matrix` / `digest` | the tenant rootfs archive, **baked from T10 by the tandem**, sha256 |
| `machine` | `gbs-vps` (fleetName), bound at enrolment to the real hostname |
| `env` | `prod` for T11-T13 → **the reap recipe already refuses them (exit 4)** |
| `deadlineAt` | `null` — a practice has no expiry |
| maker | an LXC universe on gbs-vps, SSH key to its host, token in its vault |
| silence | a tenant that stops reporting, a maker that stops calling → out of band |

**Adopting the existing tenants is the natural first reconciliation**: write
rows for T10-T13 with the right `env`, let the maker see them `DESIRED`, let
`stamp` find them and report "already exists" — nothing recreated. The
idempotence was designed for exactly this.

The CRM feeds facts, never decisions. WMANAGER **pulls** a read-only inventory
(`GET /api/external/v1/…`, dedicated key, no write route, no pagination for a
few hundred kilobytes) and reads *its own copy* — slower to reflect a change,
far more robust: WMANAGER keeps working when the CRM is down. The CRM already
stores identifiers that third-party systems assign (`omada_site_id`,
`rustdesk_group_name`); `wg_tenant` on `clients` has the same shape. **The
governor assigns, the CRM learns.**

### 8.4 What does not fit — three decisions the base must take

**D1 — `N` has no place in the contract.** Six typed positions, no `params`
slot (verified in `index.js` and `poller.mjs`). The recipe may not derive `N`
from `account` (invariant 3: it does not decide; and `account` is a stranger's
text). The matrix may not carry `N` (one archive per tenant would break "promote
a fingerprint"). The only conforming path: **a typed `params` slot on the row,
passed to the recipe** — in the base, with its test (Rule 29: what serves several
projects lives in the generic path; CLINIC will need it too).

**D2 — the WMANAGER stamp does more than `lxc launch`.** Four of T13's seven
steps act on the *host* outside the container: netplan bridge, DNAT, fifteen
isolation rules, a systemd unit. `lxc-stamp.sh` is a wider recipe than its
sisters. It stays frozen, typed, idempotent, and **proven on T10 only** before
it exists; its `reap` undoes the four host things and *proves the absence*. And
`fleet.yml` admits only `kind: proxmox | lxd`: adding `lxc` is an amendment to
[`FLEET.md`](../docs/architecture/FLEET.md), which is doctrine — light, real,
by PR, never quietly.

**D3 — which floor for the Windows workstations?** "One live row per (account,
klass)" — a practice has many workstations. Two readings:

- *Flat*: each workstation is a row of class `wm-poste`, account `<client>/<poste>`.
  Simple; the manager then carries hundreds of rows of a different level.
- *Fractal*: **the tenant is itself the governor of its workstations.** The
  Rust agent on the workstation does what a maker does — it *calls out* to the
  tenant (it already does: it POSTs telemetry, it listens on nothing),
  receives its instructions, reports. WMANAGER sees practices; each practice
  sees its workstations. No inbound door anywhere.

The fractal reading reclassifies `agent-rust`: not an installer, **a workstation
maker** — whose contract should become the base's (poll, inventory, events),
not an ad-hoc `pilot.toml`. Stated as a hypothesis, not a ruling; it makes the
"fractal level above" free instead of invented.

### 8.5 What the Windows side has already taught

The workstation agent (`gbs-agent-setup.exe`, Rust, zero `unsafe`, no shell
concatenation, allow-listed remediation, snapshot rollback) passed 8/8 on the
test VM — **for the old binary**. An independent read of the source on
1 September found eight defects, one critical: the firewall rule opened SSH on
every profile from any address, annulling the entire "reachable only through
the tunnel" model with one line. Three more were of the same family: *a result
thrown away and success asserted* (`service_running: true` hard-coded, `icacls`
unchecked, `Spooler` hard-coded past its own allow-list). The validation report
had been written by the agent that wrote the code.

The lessons are doctrine, not anecdote:

- **A proof signed by the author of the code is not a proof** (Rule 0G, and
  `proof.sh` before it). Another pair of eyes, or none.
- **Assertion is not observation.** `service_running` comes from `sc query`, or
  it does not exist. The workstation agent obeys the same law as the reap
  recipe: look, then say.
- **Fleet operations are designed on day one.** Two keys in two countries means
  revocation and addition must be fleet-wide acts with approval — never a
  machine-by-machine tour.
- **Choose the model by subject, not by phase.** The vocabulary of this domain —
  a privileged component with no inbound door that fetches instructions and
  acts on remote machines — is lexically indistinguishable from command-and-
  control, and trips dual-use classifiers. Opus for maker, provisioning,
  privilege and security; Fable for the site, the CRM interface, the copy.
  Keep the heavy vocabulary **in files**, never in messages.

### 8.6 What stays open, honestly

- Where the WMANAGER governor lives: gbs-p2 or gbs-p3, a turbinebash app or a
  stamped universe. The first gesture, still unruled.
- Who runs the executable on a workstation — Grégory on site, a link, a GPO, a
  USB key. It changes the whole enrolment design. The current proposal: the
  operator clicks "enrol a workstation", the governor mints a single-use token
  (30 min), shows a short URL typed by hand during a RustDesk session; one
  binary, one SHA-256; **the operator is authenticated, not the URL.**
- TeamViewer or RustDesk (RustDesk is self-hosted and already in the CRM).
- What the client sees during enrolment — a word to say, and perhaps a trace
  of consent to keep, in regulated professions.
- HDS and GDPR: no longer theoretical, since the fleet holds health
  practitioners today (T13 is a doctor). Reserved, not resolved.

---

## 9. The test

Before shipping any governor, any maker, any recipe, answer three questions.
Any answer other than the one given means the design is not finished.

1. **Who can open a connection to the thing that holds root?** — *Nobody.*
2. **Where is the decision taken?** — *In a ledger row, by the governor.*
   Never in a recipe, never in a robot, never in a form.
3. **How do you know it happened?** — *The recipe looked, and reported a fact.*
   Never because it said so.

---

## 10. Lexicon candidates (Rule 37 — by amendment, never quietly)

- **governor** — the universe that holds a ledger and makes it respected.
- **maker** — the hand of a machine: asks, stamps, reports, never decides.
- **matrix** — the locked, content-addressed artefact from which instances are stamped; baked by the tandem, never by a robot.
- **stamp / reap / validate** — the three work kinds; the table grows by one line.

And one line of `LEXICON.md` to revisit: the forge is described as the organ
that "deploys/destroys/repairs (LXC, podman)". The operator's ruling bounds it
to podman and hands LXC to the maker.
