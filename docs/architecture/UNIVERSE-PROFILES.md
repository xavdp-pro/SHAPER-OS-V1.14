# Universe Profiles — Naming What to Build

> **Why this page exists.** Two agents were asked, in the same words, to build
> "the base universe". One built five containers, the other six. Neither was
> wrong: the phrase had no definition. This page gives the starting points names,
> so that a single word in a prompt settles what gets built — and everything
> after that word is yours to shape.

A profile is a **floor, not a cage.** It says where to start. What you add on top
is the work.

---

## The two floors

### `passive` — it runs, and it can be proven

```
logger                                    :8620
```

Plus whatever it watches: a website, a shop, a database, a document store. The
logger is the one brick that never leaves, because the currency of this system is
proof — a universe that cannot show what happened is outside the doctrine, however
well it works.

**Nothing reasons here.** No agent, no queue, no clock.

**Real examples:**

| What it is | Profile | Alongside |
| :--- | :--- | :--- |
| Site with sign-in | `passive +data` | the site container, `auth` |
| WordPress shop | `passive +data` | wordpress, mariadb, vitals probes |
| Public brochure site | `passive +public` | nginx or the static site |
| Document drop | `passive +documents` | — |
| Scheduled backups | `passive +clock` | `maestro` alone: a cron with an audit trail |

### `agent` — it reasons, works in the background, and starts on its own

```
vault    :8610      the secrets
logger   :8620      the memory and the proof
bridge   :4440      the agent
queue    :8640      asynchronous work, and the answer persisted
maestro  :8630      it starts by itself
```

Boot order: `vault ∥ logger → bridge → queue → maestro`.

**This is the default.** When nobody names a profile, this is what gets built.
It is what `manifest.tier-a.json` has always declared; `tier-a` stays as an alias
while existing manifests migrate.

Five bricks is the **floor for anything that thinks**, and each one earns its
place:

- Remove `maestro` and it only acts when asked.
- Remove `queue` and it acts but cannot prove: the answer lives on a connection
  that closes, which the v1.7 verdict names as a failed proof.
- Remove `vault` and it works only while it holds no secret — the queue writes
  job payloads to disk, so a secret travelling as a value becomes a secret in a
  file. With the vault it travels as a reference and is decrypted in memory.
- Remove `bridge` and nothing reasons: you are back to `passive`.
- Remove `logger` and nothing is provable.

---

## The options

They attach to either floor, in any combination.

| Option | Adds | What it buys |
| :--- | :--- | :--- |
| **`+documents`** | `ged`, `qdrant`, `@shaper/rag` | It knows things beyond the current task |
| **`+data`** | `mariadb` | Relational state that outlives the run |
| **`+web`** | `helm`, `auth` | A human who is not at a terminal can drive it |
| **`+public`** | `tunnel`, `waf` *(TARGET)* | Reachable from outside, with no inbound port open |
| **`+clock`** | `maestro` | For a `passive` universe only — `agent` already has it |
| **`+parent`** | `@shaper/supervisor`, children registry, SSH authority | It operates **other** universes |
| **`+intake`** | `@shaper/mail-agent`, `pipeline` *(TARGET)* | Work arrives on its own, from mail or documents |

`+web` and `+public` are separate on purpose: a cockpit reachable only on the
private address is a legitimate and much safer posture.

---

## Writing it in a prompt

Name the floor, add the options, then describe the work:

> *"Build me an **`agent +documents`** universe called `univ-devis-dev`, DEV
> lifecycle. It reads incoming quotes and produces a written summary each
> morning."*

The agent reads this page for the first half and builds exactly that. The second
half is where you shape — and where it stops guessing.

**Three things a profile does not say**, and that you must still give:

1. **The slug** — a container name is not a slug, and an agent that derives one
   from the other is guessing (Rule 1).
2. **The lifecycle** — DEV is kept, TEST is destroyed after it proves itself
   (Rule 10). "A test VPS" describes a machine, not a lifecycle.
3. **The intent** — what this universe is *for*. Principle 1: intent precedes
   form, and the profile is form.

---

## Declared, and checked

A name nobody verifies is decoration. The profile is declared in the manifest:

```json
{ "universe": "univ-devis-dev", "environment": "dev", "profile": "agent +documents" }
```

The repository suite fails if the declared profile and the actual bricks disagree
— a manifest that says `passive` while running maestro and a bridge is lying
about what it is, and the next agent will believe it.

Adding bricks beyond the profile is allowed and expected: that is the brodery.
The check verifies the **floor is present**, never that nothing was added.

---

## What no profile contains

Its own repair authority. A universe emits its vitals; a level above grades them
and repairs it (Rule 23), and where there is no level above, a human does
(Rule 24). `+parent` makes a universe the one who repairs — never the one who
repairs itself.

That absence is not a gap in the vocabulary. It is what stops an agent sawing the
branch it is sitting on.
