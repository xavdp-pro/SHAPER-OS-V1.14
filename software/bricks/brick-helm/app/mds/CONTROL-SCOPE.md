# Agent Context Methodology: GENERIC vs SPECIALIZED

**Two-layer** architecture for the context injected at prime — designed to
be adaptive: a new agent on a different control scope for another
customer must work without changing code, only configuration.

## Layer 1 — GENERIC (`server/lib/agentSkills.js`)

Methods valid **everywhere, for any deployment**: document ingestion,
deliverables, API-first, master/subordinate orchestration, scheduling, model
routing, reborn, host-root powers. Never changes from one customer to another.

## Layer 2 — SPECIALIZED (`server/lib/controlScope.js`)

What **THIS specific deployment** controls: Cloudflare domains, cloud accounts,
accessible machines… **Different for each customer/installation.** Injected at
prime right after generic skills, under a dedicated header
`CONTROL SCOPE` — empty (nothing injected) if the deployment has nothing
configured, without different code.

### Current Example: Cloudflare (2026-07-23)

The operator controls domains such as **example.com** via a Cloudflare API
token (tunnel/DNS/subdomain management).

- `.env` (app + **both bridges**, cursor and claude — see below):
  ```
  CLOUDFLARE_API_TOKEN=...
  CLOUDFLARE_DOMAINS=example.com
  ```
- `controlScope.js` reads these variables and generates context text
  **without ever mentioning the plaintext token** — only its env variable
  name (`$CLOUDFLARE_API_TOKEN`), which the agent uses from its own
  shell commands/scripts (`curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" ...`).
  The secret never passes through conversation text / LLM logs.
- Verified: the token is present in the real environment of both bridge processes
  (`/proc/<pid>/environ`), not only in `app/.env` (which is read
  by a completely separate Express process — trap discovered and fixed).

## ⚠️ Trap Discovered: three distinct `.env` files, not just one

There are **three** `.env` files on this deployment, each read by a
different process — adding a variable to one is not enough:

| File | Process reading it | Purpose |
|------|--------------------|---------|
| `/apps/helm-v2/app/.env` | Express API (server/config.js) | HTTP responses, prime (context text) |
| `/opt/bridge/cursor/.env` | cursor bridge → **real cursor-agent process** | Effective shell of the Cursor agent |
| `/opt/bridge/claude/.env` | claude bridge → **real claude process** | Effective shell of the Claude agent |

**Any variable the agent must use in shell (tokens, external API keys)
must be in BOTH bridge `.env` files**, not just in `app/.env`. The
text context (prime) comes from the API so it reads `app/.env`, but the agent's real
shell comes from the corresponding bridge.

Furthermore, `bridge/claude/start-bridge.sh` used to do a simple `source .env`
followed by a **named export** (allowlist) — any new variable remained
invisible to the final process. Fixed to `set -a; source .env; set +a` (like the
cursor bridge): **every** `.env` variable is now automatically
exported, without having to edit the script for each new key — necessary so
the "specialized" layer remains truly adaptive without touching code.

## Future Evolution: per-customer vault (not now)

Currently `controlScope.js` reads local env. Architecture ready for a
vault: replace `loadFromEnv()` with a per-tenant vault loader — the rest
(generating context text, prime injection, "never plaintext secret" guardrail)
does not change. A new customer with a different control perimeter
(other domains, other cloud) will only require a new
config/vault entry, no new code.

See also `REMOTE3/Travaux/handoffs/BULLDOZER-INCIDENT.md` *(outside repo)* (why
bridge scripts lost executable permissions) and
[`DYNAMIC-ORCHESTRATION.md`](./DYNAMIC-ORCHESTRATION.md).
