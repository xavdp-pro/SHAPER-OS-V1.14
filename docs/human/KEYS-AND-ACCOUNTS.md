# Keys and accounts — what you need, where to get it

Shaper OS is **agent-first**. You clone the repo, open it in an IDE with a capable AI agent (Cursor, Claude Code, etc.), and the agent **reads this file** to know which secrets exist, which ones it generates locally, and which ones you must paste from a vendor site.

**Never commit** `software/.env`, vault files, or tunnel tokens.

---

## Tiers (pick one path)

| Tier | Goal | Paid accounts? |
| :--- | :--- | :--- |
| **a — local DEV** | Vault, logger, bridge, queue, maestro on `127.0.0.1` | **No** — OpenCode free models ship in the bridge image |
| **b — voice + public URL** | Tier-a + Helm `/console`, mic, Cloudflare tunnel | **Yes** — Deepgram, Groq, Cloudflare (see below) |

Start with **tier-a**. Add tier-b only after `npm run test:live` is green.

---

## Full key map

| Secret | Tier | Who creates it | Get it here | Goes in |
| :--- | :---: | :--- | :--- | :--- |
| `VAULT_MASTER_KEY` | a | **Agent** (`openssl rand -hex 32`) | Nowhere — generated on your machine | `software/.env` + `software/resources/vault-resources.local.json` |
| `VAULT_TOKEN` | a | **Agent** (`openssl rand -hex 24`) | Nowhere — generated on your machine | same |
| OpenCode free model | a | **Nobody** | [OpenCode Zen free models](https://opencode.ai/docs/zen/) — no API key for default bridge | `OPENCODE_MODEL` in `.env` (default set) |
| `DEEPGRAM_API_KEY` | b | **You** (agent guides) | [Deepgram console](https://console.deepgram.com/signup) → **API Keys** → Create key | `software/.env` |
| `GROQ_API_KEY` | b | **You** (agent guides) | [GroqCloud console](https://console.groq.com/keys) → Create API key | `software/.env` |
| Cloudflare **tunnel token** | b | **You** (agent guides) | [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → Create tunnel → copy token | `<univ>-dev/sav/tunnel/token` (not git) |
| Cloudflare **account** (DNS) | b | **You** | [Cloudflare dashboard](https://dash.cloudflare.com/sign-up) — domain must be on Cloudflare | DNS + tunnel config |
| `PARENT_SSH_KEY` | a | **Agent** (`ssh-keygen -t ed25519 -N ""`) | Generated locally in Parent Vault / `sav/ssh/id_ed25519` | Parent `sav/ssh/` (Private key never leaves Parent) |
| `CHILD_AUTHORIZED_KEYS` | a | **Provisioning** | Derived from Parent `id_ed25519.pub` | Injected into Child `/root/.ssh/authorized_keys` at bootstrap |
| `JWT_SECRET` | b | **Agent** (`openssl rand -hex 32`) | Local only | `software/.env` |
| `CARTESIA_API_KEY` | optional | **You** | [Cartesia Play](https://play.cartesia.ai/) → API keys | `software/.env` |
| `ELEVENLABS_API_KEY` | optional | **You** | [ElevenLabs API keys](https://elevenlabs.io/app/settings/api-keys) | `software/.env` |
| `OPENROUTER_API_KEY` | optional | **You** | [OpenRouter keys](https://openrouter.ai/keys) | `software/.env` |
| Cloudflare **R2** (backups) | optional | **You** | [Cloudflare R2](https://dash.cloudflare.com/) → R2 → Manage API tokens | `software/.env` (`R2_*`) |

Template file: [`.env.example`](../../.env.example) → copy to `.env` or `software/.env`.

---

## The Vibe-Coder & AI Agent Contract (Strict Validation Protocol)

1. **Human's Responsibility**:
   - The human vibe-coder provides the root `.env` (at repository root `REMOTE3/.env` or `software/.env`).
   - The human provides the API keys for the desired services (Deepgram, Groq, Cloudflare).
2. **AI Agent's Strict Obligation (Mandatory Check & Halt)**:
   - **Inspect First**: Before running `podman-up.sh` or deploying any stack, the AI agent **MUST inspect the `.env`** to ensure that every required key for the requested tier is present, non-empty, and valid.
   - **Proactive Reclamation**: If a key is missing or is a placeholder, the AI agent **MUST HALT** and explicitly ask the human vibe-coder for the key, providing the direct signup/console link. The agent **MUST NOT** launch containers blindly hoping keys exist.
   - **Multi-Podman Key Propagation**: The AI agent is responsible for copying/syncing the validated keys into all required `.env` locations across universes and Podman containers (`software/.env`, `deploy/env`, `deploy/<univ_slug>.env`).

---

## ⚖️ Standard vs Freestyle Disclaimer (Responsibility Matrix)

| Mode | Conditions | Outcome | Guarantee |
| :--- | :--- | :--- | :--- |
| 🛡️ **Standard Recipe ("La Sauce Robuste")** | Human provides the complete `.env` with valid keys as specified in the checklist. AI agent validates and propagates before boot. | 100% Deterministic, Autonomous & Green from start to finish. Zero 401 errors. | **Guaranteed by Shaper OS doctrine.** |
| 🎨 **Freestyle Mode ("Liberté Totale")** | Human chooses to launch with partial keys, missing credentials, custom stacks, or modified rules while waiting for an account or key. | Degraded / inactive services (e.g. browser voice fallback instead of Deepgram HD, mock bridges, etc.). | **User's full responsibility.** If something does not work in freestyle, the human & agent manage it together. |

> [!IMPORTANT]
> **Freedom with Transparency**: You are 100% free to customize, hack, omit keys, or change the architecture with your AI agent. However, if you deviate from the standard verified checklist, you cannot claim the baseline system is broken. Respect the recipe for a 100% guaranteed predictable outcome.

---

## Agent workflow (browser-assisted)

If your IDE agent has a **built-in browser** (e.g. Cursor Browser), use it. The agent should:

1. Read [`AGENTS.md`](../../AGENTS.md), [`LAW.md`](../../LAW.md), [`START-HERE.md`](./START-HERE.md), this file.
2. **Verify root `.env`**: Check completeness of keys for target tier. Halt and ask the human if keys are missing.
3. **Generate** vault keys locally — do not ask the human to sign up anywhere for tier-a.
4. For tier-b, **open one vendor URL at a time**, wait for the human to sign in / create the key, then paste into `.env` / `software/.env`.
5. **Propagate** the validated `.env` to all universe/podman deployment directories.
6. **Never** paste keys into chat logs, commits, or example files.
7. Run the install pipeline; **stop on red tests**.

Copy-paste intent for your agent: [`examples/agent-KEY-COLLECTION-INTENT.md`](../../examples/agent-KEY-COLLECTION-INTENT.md)

---

## Human checklist (tier-a only)

- [ ] Clone repo, open in IDE with AI agent
- [ ] Paste intent from `examples/agent-KEY-COLLECTION-INTENT.md`
- [ ] Agent inspects `.env` and generates `VAULT_MASTER_KEY` + `VAULT_TOKEN`
- [ ] Agent runs `npm test` → build → universe → `test:live`
- [ ] No Deepgram / Groq / Cloudflare needed yet

## Human checklist (tier-b, after tier-a green)

- [ ] [Deepgram](https://console.deepgram.com/) — API key → `DEEPGRAM_API_KEY` in `.env`
- [ ] [Groq](https://console.groq.com/keys) — API key → `GROQ_API_KEY` in `.env`
- [ ] [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) — tunnel token → `sav/tunnel/token`
- [ ] Agent validates `.env`, propagates keys, sets `WITH_HELM=1`, deploys tier-b manifest, runs `npm run test:live:helm`

---

## Stripe, mail, CRM keys (later — perimeter 3)

Business integrations (Stripe, IMAP, Supabase, etc.) belong in **your universe** vault entries and `ctx-universe.md`, not in the foundation install. Your agent adds them when you shape ERP, shop, or CRM — see [`CONCEPTS.md`](./CONCEPTS.md) §2 (perimeter 3).

---

## Your domain — supplied, never shipped

This repository contains **no domain**. Not a default, not a fallback, not an
example that happens to resolve. Another person must be able to clone it and
deploy under **their** name by changing environment values only.

That means a public name is **asked for, at the moment it is needed**:

| When | What is needed | Who provides it |
| :--- | :--- | :--- |
| Local DEV (tier-a) | Nothing. Everything answers on `127.0.0.1`. | — |
| Public console, voice, a public URL (tier-b) | A hostname inside a zone **you already manage in Cloudflare** | You, at deploy time |
| A fleet of child universes | The zone, plus the manager and child slugs | You, at deploy time |

**Cloudflare is the prerequisite** for anything with a public name: the zone must
exist in your Cloudflare account before the tunnel can be created, because the
deployment creates the DNS record and the Zero Trust tunnel for you.

What the agent needs from you, and where it goes:

| Value | Environment variable | Never in |
| :--- | :--- | :--- |
| Public hostname | `PUBLIC_HOSTNAME`, `SHAPER_ALLOWED_HOSTS` | a tracked file |
| DNS zone | `DNS_ZONE` | a manifest committed to git |
| Cloudflare API token | `CLOUDFLARE_API_TOKEN` | a script, ever |
| Cloudflare account / zone id | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` | a script, ever |

An agent that cannot find these **halts and asks you**. It does not invent a
name, and it does not reuse one it found in the repository — there are none to
find, and a guard test fails the build if one ever appears
(`software/packages/pkg-logger/test/domain-agnostic.test.js`).
