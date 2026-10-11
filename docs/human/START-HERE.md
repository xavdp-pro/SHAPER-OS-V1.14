# Start here — first install

You know Linux. You use an IDE with a capable AI agent.  
You do **not** know this project. That is expected.

**First move:** open this repo in your IDE and paste [`examples/agent-KEY-COLLECTION-INTENT.md`](../../examples/agent-KEY-COLLECTION-INTENT.md) to your agent.  
Keys and vendor URLs: [`KEYS-AND-ACCOUNTS.md`](./KEYS-AND-ACCOUNTS.md).

Tell the agent: **Read `AGENTS.md`, then `LAW.md` and `docs/human/START-HERE.md`, then install a local DEV stack. Do not skip tests.**

[`AGENTS.md`](../../AGENTS.md) is the agent's door — it routes the agent to the reading that matches its capability, so you do not have to.

After it is up, read [`CONCEPTS.md`](./CONCEPTS.md) and [`LIFECYCLE.md`](./LIFECYCLE.md). Those are the reference. This page is only **how to get something running**.

---

## What this is

**Shaper OS** runs on **your** Linux machine. It is a small operating system for an AI agent that **does work** — secrets, logs, jobs, tools — not only chat. Its first install is the floor everything stands on: four units — secrets, evidence, jobs, schedule — each with its own database.

> You talk or type. The agent understands, does the work, writes a trace, and answers. You do not need a screen for yourself.

A web page is a later remote control. Invoices, CRM, client sites are later, as **separate apps**.

This first install is a **DEV** universe: on demand, allowed to break. It is not production. See [`LIFECYCLE.md`](./LIFECYCLE.md).

---

## Layout (one clone, one universe beside it)

The software is in **this repository**. Clone once ([`REPOS.md`](./REPOS.md)).
Your universe lives **outside** it, inside the universe container.

```
SHAPER-OS-V1.14/          ← repo root — the build and the tests run from here
├── README.md            ← the human door
├── AGENTS.md            ← the agent door
├── LAW.md               ← what is never skipped
├── docs/human/          ← you are reading this file, here
└── software/            ← packages, bricks, universes/_template, npm test, build scripts

/apps/<univ_slug>/        ← your first universe: a copy of software/universes/_template
├── INTENT.md · manifest.json · cfg-universe.env (yours, never committed)
├── base/                ← the four base units, installed from one revision of this repo
└── deploy/              ← podman-up.sh · proof.sh · base.sh
```

> Every repository command in this page is run **from the repository root**;
> every universe command names `/apps/<univ_slug>/`.

---

## Words for the install (full list in [`GLOSSARY.md`](./GLOSSARY.md))

| Word | Meaning |
| :--- | :--- |
| **Universe** | One install for one project (`<univ_slug>`, beginning with `univ-`). Its settings, its image lock, its data. |
| **Unit** | One functional Podman: one application **and its own MariaDB server**, in one container, under one name (Rules 4 and 26). |
| **Base units** | Vault, Logger, Queue, Maestro — secrets, evidence, jobs, schedule. Every universe stands on these four (`univ-minimal`). |
| **Helm / `/console`** | Optional web cockpit, from the catalogue. |
| **Perimeter** | A fence of duty (foundation / agent / business). Explained in [`CONCEPTS.md`](./CONCEPTS.md) §2. Not DEV/TEST/PROD. |

---

## Who does what

**You:** Linux, a universe container (LXC with nesting), the machine's registry, the universe's name, “install then prove”. Vendor keys only if you ask for voice or a public URL.

**Agent:** copy the template, build and publish the images under a new tag, install the base units, bring them up, prove them. **Never generates, copies or commits a secret:** the base units generate their own at birth.

---

## Machine and accounts

```
Linux · git · Node.js >= 20 · Podman >= 4 · nftables · jq · curl · openssl · iproute2 · python3
```

**Local first (tier-a):** no paid cloud, no API key. The four base units call no vendor.

**Public URL + voice (tier-b, after the base is proven):**

| Account | Why | Get key |
| :--- | :--- | :--- |
| Cloudflare | Domain DNS + Zero Trust **tunnel token** | [Zero Trust → Tunnels](https://one.dash.cloudflare.com/) |
| Deepgram | Speech ↔ text | [console.deepgram.com](https://console.deepgram.com/) → API Keys |
| Groq | Fast “Got it…” — not the main thinking model | [console.groq.com/keys](https://console.groq.com/keys) |

Full table (optional keys, R2, Stripe later): [`KEYS-AND-ACCOUNTS.md`](./KEYS-AND-ACCOUNTS.md).  
Agent should use IDE **browser** to open each link and guide you — see [`examples/agent-KEY-COLLECTION-INTENT.md`](../../examples/agent-KEY-COLLECTION-INTENT.md).

The universe's settings: [`software/universes/_template/cfg-universe.env.example`](../../software/universes/_template/cfg-universe.env.example) → `/apps/<univ_slug>/cfg-universe.env` (the universe's name, the registry and tag; no secret).  
A vendor key goes where the unit that needs it reads it — never into the chat, never into Git.

---

## Install order

**Stop if a step fails.** Do not reorder. Do not skip a green check.  
[`LAW.md`](../../LAW.md) · agent detail: [`AGENTS.md`](../../AGENTS.md), [`docs/agent/BOOT-CONTRACT.md`](../agent/BOOT-CONTRACT.md) and, step by step, [`docs/agent/RUNBOOK-EXPLICIT.md`](../agent/RUNBOOK-EXPLICIT.md).

1. Create the universe container and clone this repo in it ([`REPOS.md`](./REPOS.md)). Node **≥ 20** (`software/package.json` `engines`).
2. **Package units only** (must be green on a fresh clone):

   ```bash
   (cd software && npm test)
   ```

3. Build and publish the images, under a tag the registry has **never** served:

   ```bash
   export SHAPER_REGISTRY=<this machine's registry> SHAPER_IMAGE_TAG=<a new tag>
   (cd software && bash scripts/build-all-bricks.sh)
   ```

4. Create the universe from the template, outside the repository:

   ```bash
   cp -r software/universes/_template /apps/<univ_slug>
   ```

   - Write its `INTENT.md` (what it is for; lifecycle = **dev**) and set `"universe": "<univ_slug>"` in `manifest.json`. The four base units stay as declared.
   - Tier-b later: catalogue units from [`SHAPER-OS-BRICKS`](https://github.com/xavdp-pro/SHAPER-OS-BRICKS-V1.14) (a private repository) — `brick-helm` is one; each joins only as a unit with its own MariaDB, and nothing in this repository switches it on.

5. Install the base units, then write the settings file:

   ```bash
   bash /apps/<univ_slug>/deploy/install-base.sh --shaper-repo "$PWD" --shaper-commit "$(git rev-parse HEAD)"
   cp /apps/<univ_slug>/cfg-universe.env.example /apps/<univ_slug>/cfg-universe.env   # SHAPER_UNIVERSE, registry, tag
   ```

6. Start:

   ```bash
   bash /apps/<univ_slug>/deploy/podman-up.sh --preflight   # says what it would do; changes nothing
   bash /apps/<univ_slug>/deploy/podman-up.sh
   bash /apps/<univ_slug>/deploy/base.sh install-renewal-timer.sh
   ```

   The script exits non-zero and names the cause when anything is wrong. The units answer on `127.0.0.1` only: vault `:8610`, logger `:8620`, maestro `:8630`, queue `:8640` — a health that answers proves a process is up, nothing more.

7. **Prove — mandatory**, units are up:

   ```bash
   bash /apps/<univ_slug>/deploy/proof.sh
   bash /apps/<univ_slug>/deploy/base.sh lifecycle-drill.sh
   bash /apps/<univ_slug>/deploy/base.sh restore-drill.sh
   node --test /apps/<univ_slug>/test/socle-live.test.js    # smoke test, not the proof
   ```

   Tier-b: the cockpit's live tests live in the catalogue, beside `brick-helm` — run them from there. This repository ships no tier-b test script.

   If red: **stop**. Fix the cause. Do not comment out tests.

---

## Next

1. [`PROOF.md`](./PROOF.md) — operator loop without a browser.  
2. `deploy/proof.sh` and both drills must already be green (step 7).  
3. [`CONCEPTS.md`](./CONCEPTS.md) · [`LIFECYCLE.md`](./LIFECYCLE.md) before anything called production.
