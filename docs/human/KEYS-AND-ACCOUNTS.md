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
| OpenCode free model | a | **Nobody** | [OpenCode Zen free models](https://opencode.ai/docs/zen/) — no API key for the OpenCode bridge | `OPENCODE_MODEL` in `.env` — measured at deploy, never written here (Rule 7, runbook Step 4.2b); no default is set anywhere |
| Model of any other bridge this universe enables | a | **Agent** (by measurement) | Nowhere — the engines reachable from the target host, probed there | `CURSOR_MODEL` (bridge-cursor), `AGY_MODEL` or `ANTIGRAVITY_MODEL` (bridge-agy), `OLLAMA_MODEL` or `DEEPSEEK_MODEL` (bridge-deepseek) in `.env` — same standard, same halt without it |
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

Template file: [`software/.env.example`](../../software/.env.example) → copy to `software/.env`. It is the one canonical copy; the root `.env.example` is a symlink to it.

---

## Backups and the registry — what the operator scripts read

Four scripts under `software/scripts/` take their credentials from the
**exported environment** and from nowhere else: none of them sources
`software/.env` or a universe's `deploy/env` — by design, a backup script
does not execute the operator's environment file. None carries a default: a
required variable that is missing **halts the script, which names it**.

| Variable | Read by | Required? | What it does |
| :--- | :--- | :---: | :--- |
| `REGISTRY_HOST` — or `SHAPER_REGISTRY` in its place | `push-images-to-registry.sh` | **Yes** | The private OCI registry, `host:port`. `SHAPER_REGISTRY` is the name the [registry contract](../architecture/ARTIFACT-BOUNDARY.md) uses; either works |
| `REGISTRY_USER` | `push-images-to-registry.sh` | **Yes** | The registry account. No default — the one that shipped in V1.13 was the author's |
| `REGISTRY_PASS` | `push-images-to-registry.sh` | **Yes** | The registry password; it reaches `podman login` on stdin, never on a command line |
| `PRA_ENCRYPTION_KEY` | `backup-pra-sync.sh` | **Yes** | The key the off-site archive is encrypted with. Generated for backups only (`openssl rand -hex 32`); the script **refuses** a value equal to `VAULT_MASTER_KEY`, whether exported or found in a `.env` on disk |
| `PRA_DEST_HOST` | `backup-pra-sync.sh` | No | Where the encrypted archive is `rsync`ed; unset, it stays in `data/backups/` and the script says so |
| `MYSQL_USER` | `backup-local.sh`, `snapshot-universe.sh` | No | Set, it declares that this universe has a database to dump. Unset, both scripts print `SKIP` and report `"database":"skipped"` — never an empty dump passed off as one |
| `MYSQL_PASSWORD` | `backup-local.sh`, `snapshot-universe.sh` | With `MYSQL_USER` | Travels in `MYSQL_PWD`, never on a command line |
| `MYSQL_DATABASE` | `backup-local.sh`, `snapshot-universe.sh` | No | One schema to dump; unset, `--all-databases` |
| `MYSQL_HOST`, `MYSQL_PORT` | `backup-local.sh`, `snapshot-universe.sh` | No | Default to `127.0.0.1` and `3306` inside the scripts |

The example files are the record of the **names**, and declare every
variable above **empty**:
[`examples/universe.env.example`](../../examples/universe.env.example) for the
universe's own database (Rule 26: one MariaDB per universe),
[`software/.env.example`](../../software/.env.example) for the PRA key and
the registry account. The **values** live in the shell — or the cron
environment — that runs the script, never in a tracked file. From
`software/`:

```bash
set -a && source ../<slug>-dev/deploy/env && set +a   # exports MYSQL_* into this shell
bash scripts/backup-local.sh
PRA_ENCRYPTION_KEY=<backup-only key> bash scripts/backup-pra-sync.sh
export REGISTRY_HOST=<host:port> REGISTRY_USER=<account>
read -rs REGISTRY_PASS && export REGISTRY_PASS      # typed, not written into a history
bash scripts/push-images-to-registry.sh
```

A `MYSQL_USER` written into `deploy/env` and `backup-local.sh` run from a
fresh shell gives `SKIP`; a `PRA_ENCRYPTION_KEY` written into `software/.env`
gives the halt that names it — neither file is read as configuration.
`backup-pra-sync.sh` opens the `.env` files line by line for one purpose
only: to refuse a PRA key equal to the vault's.

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
- [ ] Agent validates `.env`, propagates keys, deploys the tier-b manifest from the [`SHAPER-OS-BRICKS`](https://github.com/xavdp-pro/SHAPER-OS-BRICKS-V1.13) catalogue, runs the catalogue's `brick-helm` live tests

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
