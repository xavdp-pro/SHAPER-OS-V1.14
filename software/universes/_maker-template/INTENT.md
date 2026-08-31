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

1. **Nothing can open a connection to it.** It listens on nothing and holds
   no certificate. It calls outward to ask for work and to report; a stolen
   credential lets someone impersonate a worker, never command a host.
   *(Doctrine: the direction of the link is the boundary.)*
2. **It executes a frozen recipe with typed parameters.** Data that came from
   a form never becomes part of a command: arguments are passed, never
   concatenated into a shell string. Pulling work is not permission to
   interpret it.
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
| `recipes/` | The frozen recipes, one per host kind (`lxd`, `proxmox`) |
