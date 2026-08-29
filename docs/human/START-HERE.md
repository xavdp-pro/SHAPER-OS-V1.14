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

**Shaper OS** runs on **your** Linux machine. It is a small operating system for an AI agent that **does work** — secrets, logs, jobs, tools — not only chat.

> You talk or type. The agent understands, does the work, writes a trace, and answers. You do not need a screen for yourself.

A web page is a later remote control. Invoices, CRM, client sites are later, as **separate apps**.

This first install is a **DEV** universe: on demand, allowed to break. It is not production. See [`LIFECYCLE.md`](./LIFECYCLE.md).

---

## Layout (one clone)

Everything is in **this repository**. Clone once ([`REPOS.md`](./REPOS.md)).

```
SHAPER-OS-V1.13/          ← repo root — every command below runs from here
├── README.md            ← the human door
├── AGENTS.md            ← the agent door
├── LAW.md               ← what is never skipped
├── docs/human/          ← you are reading this file, here
├── software/            ← packages, bricks, npm test, build scripts
└── <univ_slug>-dev/     ← first universe (you create this)
```

> Every command in this page is run **from the repository root**, not from this
> directory.

---

## Words for the install (full list in [`GLOSSARY.md`](./GLOSSARY.md))

| Word | Meaning |
| :--- | :--- |
| **Universe** | One install for one project (`<univ_slug>`). Config and data only. |
| **Brick** | One containerized service, reused everywhere. |
| **Vault / logger / queue / Maestro / bridge** | Secrets, audit, jobs, scheduler, AI CLI over HTTP. |
| **Helm / `/console`** | Optional web cockpit. |
| **Perimeter** | A fence of duty (foundation / agent / business). Explained in [`CONCEPTS.md`](./CONCEPTS.md) §2. Not DEV/TEST/PROD. |

---

## Who does what

**You:** Linux, Podman, Node 20+, git, API keys (voice only if tier-b), “install then prove”.

**Agent:** generate vault keys, create the universe from templates, run tests, build images, start containers, check health. **Never commit secrets.**

---

## Machine and accounts

```
Linux · git · Node.js >= 20 · Podman >= 4 · curl · openssl
```

**Local first (tier-a):** no paid cloud required. OpenCode free models sit inside the bridge image — [no API key](https://opencode.ai/docs/zen/).

**Public URL + voice (tier-b, after local health is green):**

| Account | Why | Get key |
| :--- | :--- | :--- |
| Cloudflare | Domain DNS + Zero Trust **tunnel token** | [Zero Trust → Tunnels](https://one.dash.cloudflare.com/) |
| Deepgram | Speech ↔ text | [console.deepgram.com](https://console.deepgram.com/) → API Keys |
| Groq | Fast “Got it…” — not the main thinking model | [console.groq.com/keys](https://console.groq.com/keys) |

Full table (optional keys, R2, Stripe later): [`KEYS-AND-ACCOUNTS.md`](./KEYS-AND-ACCOUNTS.md).  
Agent should use IDE **browser** to open each link and guide you — see [`examples/agent-KEY-COLLECTION-INTENT.md`](../../examples/agent-KEY-COLLECTION-INTENT.md).

Keys → `software/.env` from [`.env.example`](../../.env.example) (same template as [`software/.env.example`](../../software/.env.example)).  
Optional universe overrides: [`examples/universe.env.example`](../../examples/universe.env.example) → `<univ_slug>-dev/deploy/env`.  
Tunnel token → `<univ_slug>-dev/sav/tunnel/token` (not git).

---

## Install order

**Stop if a step fails.** Do not reorder. Do not skip a green check.  
[`LAW.md`](../../LAW.md) · agent detail: [`AGENTS.md`](../../AGENTS.md) and [`docs/agent/BOOT-CONTRACT.md`](../agent/BOOT-CONTRACT.md).

1. Clone this repo ([`REPOS.md`](./REPOS.md)). Node **≥ 20** (`software/package.json` `engines`).
2. Copy `.env.example` → `software/.env`. Agent writes `VAULT_MASTER_KEY` and `VAULT_TOKEN`. Human pastes Deepgram/Groq only if `WITH_HELM=1`. **No default keys in scripts.**
3. Copy `software/resources/vault-resources.dev.example.json` → `software/resources/vault-resources.local.json`. Align `masterKey` and `token` with `.env`. **No production mailbox** in DEV.
4. **Package units only** (must be green on a fresh clone):

   ```bash
   cd software && npm run vault:bootstrap && npm test
   ```

5. Build images:

   ```bash
   cd software && bash scripts/build-all-bricks.sh
   ```

6. Create `<univ_slug>-dev/` at repo root:
   - Copy `INTENT` template from `software/universes/_template/` (`context/`, `tasks/`)
   - Copy [`manifest.tier-a.json`](../../manifest.tier-a.json) → `<univ_slug>-dev/manifest.json`
   - Copy [`examples/universe-AGENT-DEPLOY.md`](../../examples/universe-AGENT-DEPLOY.md) → `AGENT-DEPLOY.md`; lifecycle = **dev**
   - Copy [`software/universes/_template/deploy/podman-up.sh`](../../software/universes/_template/deploy/podman-up.sh) → `<univ_slug>-dev/deploy/podman-up.sh`
   - Tier-b later: the `agent +web +public` manifest, in the [`SHAPER-OS-BRICKS`](https://github.com/xavdp-pro/SHAPER-OS-BRICKS-V1.13) catalogue and `WITH_HELM=1`
7. Start (from repo root):

   ```bash
   bash <univ_slug>-dev/deploy/podman-up.sh
   ```

   Health must be OK (script exits non-zero on FAIL):

   ```bash
   curl -sf http://127.0.0.1:8610/api/health   # vault
   curl -sf http://127.0.0.1:8620/api/health   # logger
   curl -sf http://127.0.0.1:4440/api/health   # bridge
   curl -sf http://127.0.0.1:8640/api/health   # queue
   curl -sf http://127.0.0.1:8630/api/health   # maestro
   ```

8. **Live tests — mandatory**, stack is up:

   ```bash
   cd software && npm run test:live
   ```

   Tier-b: also `npm run test:live:helm`.

   If red: **stop**. Fix the stack. Do not comment out tests.

---

## Next

1. [`PROOF.md`](./PROOF.md) — operator loop without a browser.  
2. `npm run test:live` must already be green (step 8).  
3. [`CONCEPTS.md`](./CONCEPTS.md) · [`LIFECYCLE.md`](./LIFECYCLE.md) before anything called production.
