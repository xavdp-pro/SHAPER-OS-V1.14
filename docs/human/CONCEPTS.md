# Concepts — how Shaper is built (reference)

Read after a first install, or before if you want the map.  
Install steps stay in [`START-HERE.md`](./START-HERE.md). Lifecycle (DEV / TEST / PROD) is [`LIFECYCLE.md`](./LIFECYCLE.md).

The software repo states the same law in `RULES.md` and `docs/PERIMETERS.md`. This page is the plain-language reference.

---

## 1. Fractal means “same shape, different scale”

You do not rewrite vault, logs, or the scheduler for each project. You **reuse** a brick. You change **parameters**.

That idea repeats at four scales:

| Scale | What it is | What you add |
| :---: | :--- | :--- |
| **0** | One brick / one package | Code + unit tests + `INTENT.md` |
| **1** | One **universe** | `manifest.json`, tasks, `ctx-universe.md` — no copy of packages |
| **2** | One **host** (laptop, VPS, LXC) | Podman, volumes, this machine’s `.env` |
| **3** | A **fleet** | Several hosts, public domain, tunnel, optional private network |

If you copy a `Containerfile` into a universe, you broke the fractal. Specialize with `instance.json`, task files, and env — never by forking the brick.

Silence in `topology.json` (no extra port/path declared): the agent may choose, as long as each brick’s `INTENT.md` still holds. A human override is written into topology or a local `deps.json` — not hardcoded in shell.

---

## 2. Perimeters — three fences, not three folders

A **perimeter** is a **boundary of knowledge and duty**.  
It answers: *what is this piece allowed to know, and what must it never do?*

It is **not** DEV / TEST / PROD (that is the life of one install — [`LIFECYCLE.md`](./LIFECYCLE.md)).  
It is **not** the four fractal scales (brick → universe → host → fleet).  
It is **not** “three git repositories”.

You draw the fence **before** you design or deploy a component. Every brick, package, or app sits in **exactly one** perimeter. If it sits in two, the design is wrong.

### Why fences

Without them, the operator cockpit fills up with invoices, client chat, and scrapers. Secrets start containing business rules. The agent that should only store passwords starts “knowing” your customers.

The fence is there so:

- the **foundation** stays dumb and reliable (encrypt, log, queue) — even if the LLM is down;
- the **agent layer** can pilot **you** (voice, jobs, `/console`) without becoming the product you sell to clients;
- **business apps** can live, die, and brand themselves without rewriting the OS.

### The three perimeters

| Perimeter | Plain name | Allowed to do | Forbidden |
| :--- | :--- | :--- | :--- |
| **1** | Foundation | Secrets, audit, auth, generic jobs, boot | Business rules, CRM schemas, “send this invoice”, a required LLM |
| **2** | Agent layer | Wake agents on a clock or a job; operator cockpit and memory | Client-facing shops, portals, “the product for the customer” |
| **3** | Business apps | Invoices, CRM, client chat, vertical tools — own port, own volume, own life | Living inside `/console`; teaching vault what a “client” is |

The software repo shortens these to **P1 / P2 / P3** (*P* = perimeter). Same three fences.

**Golden rules**

1. Foundation never knows business apps. Vault does not store “how we invoice”.  
2. The cockpit (`/console`) is for the operator and the agents — not for your customers.  
3. A business app is built as its own program. It may **call** the foundation; it must not **merge** into Helm.

First install uses perimeters 1 and 2 (local stack ± `/console`). Perimeter 3 comes after [`PROOF.md`](./PROOF.md).

---

## 3. Two agents, two files

| When | Who | Reads |
| :--- | :--- | :--- |
| **Install** | IDE agent | Universe `INTENT.md` → `manifest.json` → `AGENT-DEPLOY.md` |
| **Runtime** | Agent inside the stack (beats / inject) | `context/ctx-universe.md` only |

Do not use `ctx-universe.md` to decide how to build images.

---

## 4. Naming (so logs and containers stay readable)

Use placeholders; pick a slug such as `shop` or `acme`.

| Thing | Pattern |
| :--- | :--- |
| Universe folder | `<univ_slug>/` or `universes/<univ_slug>/` |
| Brick directory | `brick-<name>` |
| Package | `@shaper/<name>` |
| Image | `localhost/shaper-<name>:<tag>` |
| Running container | `<univ_slug>-<brick>` |
| Lifecycle siblings | `<univ_slug>-dev`, `<univ_slug>-test`, `<univ_slug>-prod` |

Default ports (one stack on one host): vault `8610`, logger `8620`, Maestro `8630`, queue `8640`, Helm `8650`, OpenCode bridge `4440`. A second universe on the same host needs different binds.

---

## 5. Tests (three floors)

Nothing is “ready to promote” until its floor is green.

1. **Unit** — `npm test` (`packages/*/test`). Fast. No live stack. **Must be green on a fresh clone.**  
2. **Integration / live** — `npm run test:live` (`universes/_template/test/socle-live.test.js`). Needs the tier-a stack **up**. **Must be green. Never skip.**  
3. **Universe live** — the universe you deployed runs its own contract and live suites. Maintainers and regression — not the first-install gate.  
4. **Operator proof** — [`PROOF.md`](./PROOF.md) order → action → log.

Running live tests *before* deploy, watching them fail, and continuing anyway is a **violation**, not a strategy.  
Running only units and never live tests after deploy is also a **violation**.

---

## 6. Git tags, data, and backups

- **Code:** promote with an immutable tag (`v1.x.y`). Production must not track a floating `latest` by habit.  
- **Data:** persistent **Podman volumes** (`sav/` bind-mounts). Code update must not wipe them.  
- **Rollback:** previous tag + restart. Do not “fix prod by editing files on the box”.

**Multi-level backup (all five = covered)** — law: [`software/RULES.md`](../../software/RULES.md) Rule 16:

1. **Infra** — entire container (LXC/CT snapshot).  
2. **Files** — those persistent volumes as **`tar.bz2`** (same spirit as turbinobash-web `tb app sudo/backup`; exclude `nosav/`).  
3. **Database** — dumps, not hope.  
4. **Git** — tags (code, not customer data).  
5. **S3 / R2** — off-site copy of the archives.

Level 2+3 are the data delta in a PRA restore. They do not replace the TEST rebuild.

---

## 7. Mail and customer data

DEV and TEST use a **dedicated** mailbox or a stub (`MAIL_AGENT_STUB=1`).  
Never point a test universe at a production inbox.

---

## 8. What you do not mix

| Do | Do not |
| :--- | :--- |
| Reference `software/bricks/...` | Copy packages into the universe |
| Generate vault keys at install | Commit `.env` |
| Put client UI in its own app | Put the shop inside `/console` |
| Rebuild TEST from empty | Keep a dirty TEST “because it works” |
