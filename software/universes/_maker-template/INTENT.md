# Universe template: the maker

> **Intent Classification**: GENERIC INTENT (ships with the base, one per
> machine). **This template does not belong to any project.** It is named
> here only because the demo fractal is its first client; its home is the
> base repository, beside `_template`.

## 1. Declarative Objective

The hand of a machine. It asks its **governor** what should exist on
its host, stamps universes from matrices, reports what happened, and goes
back to asking. A governor is whatever universe holds the ledger it serves —
a demo SaaS today, a fractal manager tomorrow: the maker learns nothing about
which, it reads where to ask. It is the only actor in the fractal that can make a universe that
does not yet exist — which is why it cannot live inside one, and why it holds
root on its host. It is a robot: it does not decide, it does not interpret,
it does not improvise.

## 2. Invariants

1. <a id="never-command-a-host"></a>**Nothing can open a connection to
   it.** It listens on nothing and holds no certificate. It calls outward to
   ask for work and to report; a stolen credential lets someone impersonate
   a worker, never command a host — and, since the governor binds every
   report to the machine the row names, it may lie about its own host's
   rows, never about another's. *(Doctrine: the direction of the link is
   the boundary.)*
2. <a id="typed-parameters"></a>**It executes a frozen recipe with typed
   parameters.** Data that came from a form never becomes part of a
   command: arguments are passed, never concatenated into a shell string.
   Pulling work is not permission to interpret it. Two channels, and only
   two: the six positions of argv (rowId, class, matrix, digest, account,
   env), and the row's `params` as `SHAPER_PARAM_<KEY>` variables on an
   environment the maker BUILDS for the run — the host's few words a CLI
   needs (PATH, HOME, locale), the operator's own `SHAPER_*`
   configuration, and the row's allow-listed keys, held here to the same
   grammar the governor enforces (`^[a-z][a-z0-9_]{0,31}$`, scalars only)
   because a maker holding root trusts no ledger it cannot read. Never
   `process.env` handed down: an inherited environment is how a row
   carrying `LD_PRELOAD` or `BASH_ENV` would have reached a shell running
   as root. A work item carrying a key the grammar refuses is not run and
   not quietly cleaned — the run is refused and the refusal, naming the
   keys, rides the failure event into the ledger.
3. **It never chooses.** Which machine, which matrix, birth or move: the
   governing SaaS decides and writes it in the ledger. The maker only
   reconciles what it reads with what it observes.
4. **Its lanes are the capacity of its host, set from above.** It never
   widens itself: a child asking whether it deserves more is judge and party.
   *(Rule 23.)*
5. **It declares itself by its hostname, never by a configured name.** Its
   identity is the host it can actually act on, asked of that host, not a
   label written in a file that can drift from reality. The same discipline
   as a digest: the thing itself, never the name given to it.
6. **It declares what it holds.** At every poll it states its host, its
   version, its lanes and the matrices it actually carries with their
   digests. A universe is never assigned to a machine that has not proven it
   holds the bytes.
7. **It is created and enrolled by the tandem, and never enrols itself.** A
   human and their agent — root on the system, coming in from underneath —
   bring a maker into being and declare it to its governor. Self-enrolment
   would mean that whoever can run a maker can join the fleet; the fleet is
   not a place one walks into.
8. **Its silence is an event.** The poll is the heartbeat: nothing to do is a
   maker that calls and leaves empty-handed; a dead maker is a host that
   stopped calling. Absence beyond the declared interval is a drift and
   leaves out of band (Rule 27), never a green tile.
9. **Two credentials, never confused.** The one that speaks to the SaaS may
   only ask and report. The one that acts on the host is the machine's own
   power, held in this universe's vault, reachable by no one.
10. **A birth is reported from facts, never from an exit code.** A stamp
   recipe ends with one line of facts — what the host observed of the child
   — and a stamp whose output holds none is reported as a failure, not a
   birth: an end is proven by the recipe's exit code (absence verified, or
   not), a birth only by the facts it looked at.
11. **A refusal is reported under its own name.** A recipe may refuse — an
   unverified matrix, an absent one, a production universe asked to end —
   and says so by its exit code. Today only the reap's refusal has a name of
   its own (exit 4 → `REAP_REFUSED`), because it is the one the governor
   would otherwise offer again at every beat: a refused end retried forever
   is a storm on a row no robot may touch. A stamp's refusal (exit 2, the
   matrix absent; exit 3, its bytes unverified) degrades the row as
   `STAMP_FAILED` and the row is never offered a stamp again, so it cannot
   storm; a `STAMP_REFUSED` event is one line in both tables the day it is
   needed.
12. <a id="adopt"></a>**It adopts what it did not make, without touching
   it.** Four kinds of work, one table in the poller and one in the
   governor: `stamp`, `reap`, `validate`, `adopt`. An adoption binds a
   ledger row to a container that already existed — named by the row's
   `instance` param, read by the recipe as `SHAPER_PARAM_INSTANCE` — and
   is a birth to the ledger, so it is proven like one: by the facts the
   recipe looked at (the container runs, `legacy: true`), never by an exit
   code; an adopt recipe that ends without a line of facts is reported
   `ADOPT_FAILED`. The recipe looks and reports; it creates nothing,
   launches nothing, and never exec's inside the container it adopts: a
   frozen tenant is frozen. No adopt recipe ships with this template — it
   belongs to the class that needs it and runs on terrain before it is
   written down.

## 3. Cognition

The maker is a robot: the recipe needs no judgment. An agent may accompany it
to watch and to report anomalies — that agent has **no** hand on the host.

- **capacity-class**: none required for the recipe
- **role**: the accompanying watcher `requires` D1 / T1
- **degradation**: an unclear situation is reported and stops the job; it is
  never resolved by improvisation

## 4. Document map

| File | Role |
| :--- | :--- |
| `INTENT.md` | This file — law for the maker |
| `manifest.json` | Bricks, `alerting` (mandatory: silence must be heard) |
| `recipes/` | The frozen recipes, `<kind>-<work>.sh`: one per host kind (`lxd`, `proxmox`, `liblxc` — Rule 11's tokens, declared to the maker's recipe runner as `hostKind`; reading the kind from the host itself is TARGET; never the bare `lxc`) and per work kind. `lxd-*` ships; `proxmox-*` and `liblxc-*` are not yet written, and none ships before terrain (`recipes/README.md`) |
