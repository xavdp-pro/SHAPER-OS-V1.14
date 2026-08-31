# The System Learns No Dialect

> **Status**: founding doctrine, stated by the operator on 31 August 2026:
> *"in doctrine, because this interoperability is what keeps us alive."*
> Not elegance. Survival.

## The law, in one line

**A component that must serve several variants never branches on the
variant. It declares a contract and reads a table.**

## Why survival, and not craftsmanship

Everything under this system moves, and none of it asks permission:

- **The engines change every few months.** The fastest model on paper timed
  out twice from inside an LXC while a slower one did the work; the model
  that answered a probe in five seconds hung on the same job the next day.
- **The hosts change.** LXD here, Proxmox there, a plain VPS to start, a
  dedicated machine when a project scales.
- **The clients demand different ground.** One wants sovereignty, one wants a
  region, one wants his own brand on the screen.
- **The regulations change**, and they change where data may live, not how it
  is written.

A system that hardcodes any of these **dies with them**. Not dramatically:
it simply becomes the thing nobody dares touch, then the thing that must be
rewritten. A system that reads tables outlives every one of those changes
without a migration.

This is why the law belongs in doctrine and not in a style guide. Branching
on a variant is not ugly — it is **terminal**, on a delay.

## Where it already holds, and what each one buys

| Level | What interoperates | What makes it possible |
| :--- | :--- | :--- |
| Machines | LXD and Proxmox, any host | the fleet map declares a `kind`; the maker reads its host's kind instead of assuming it |
| Engines | five bridges, and the sixth | Rule 7: no model named in the canon, a depth and a throughput declared, measurement at deployment |
| CLI dialects | three vocabularies of termination | one table, quoted below |
| Projects | every vertical built on the same organs | maker, ledger, matrices, drift |
| Devices | phone and desktop on one session | declared interaction modes |
| Languages | down to the name of the pivot entity | vocabulary as structured data, never a concatenated string |
| Readers | the shopkeeper and the CIO, the human and the agent | one screen at two depths; `AGENTS.md` as the agents' door |

The canonical statement was already in the code before this page existed, in
`pkg-queue/worker.js`:

> *Bridges do not share a vocabulary: `bridge-agy` says `done` with an
> `exit_code`, `bridge-opencode` says `response_complete` with an `exit`, and
> cursor-agent says `result` with an `is_error` boolean. Three CLIs, three
> dialects, and there will be a fourth. **The queue must not learn either
> dialect in its logic — it reads this table**, and a new bridge is one line
> here rather than a branch somewhere in the flow.*

## The failure mode, and why it is invisible

A branch is always faster to write than a table. The debt is not visible the
day it is taken: it surfaces six months later, when the variant format has
quietly become a programming language nobody documented and no one can say
which combinations still work.

So the failure is not the branch. **The failure is that nothing notices the
branch.** Which is why this is enforced the way every other rule here is:

- **The first `if (variant === …)` in the generic path is a defect**, not a
  shortcut. It is corrected in the generic path and it ships its test, like
  any other defect (Rule 29).
- **A variant that needs code is a design finding**, not an exception. Either
  the contract was too narrow — widen the contract for everyone — or the
  thing is genuinely a different component, and it says so in its own INTENT.
- **The exception is declared, never discovered.** A component that truly
  must know its variant states it in its INTENT, with the reason. What is
  forbidden is the silent branch.

## The test

Before adding a case to any component that serves more than one caller, ask:
**would a new variant need a code change?** If yes, the design is not
finished — the variant belongs in a table, a profile, a manifest or an
environment, and the code belongs one level more abstract.

## What it is worth, in the operator's terms

- A better or cheaper engine ships tomorrow: measure it, adopt it, change no
  line.
- One client wants Proxmox, another a bare VPS: same matrix, two imports.
- One more trade to serve: a data file, not a deployment.
- A client requires their data in another country: move universes, rewrite
  nothing.
- A reseller wants their own brand on the screen: an environment variable.

Each of those five lines would be a project somewhere else. That is the
whole return, and it is only ever earned by refusing the shortcut.
