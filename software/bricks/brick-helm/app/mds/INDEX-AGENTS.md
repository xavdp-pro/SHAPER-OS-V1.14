# Agent Documentation Index — KovZu (helm-v2)

**Read first:** [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md) · [`rules.md`](./rules.md)

## ⚠️ Mandatory Target

| | |
|--|--|
| **Work here** | `/apps/helm-v2/app` · https://**<PUBLIC_HOST>** (gbs-tools) / ${SHAPER_PUBLIC_HOST} depending on tunnel |
| **Forbidden** | `/apps/helm-v1/app` · <PUBLIC_HOST> (unless explicitly requested) |
| **Forbidden** | cursorauto |

Historical Cursor sessions often mention "helm" / helm-v1. **Any new KovZu request = helm-v2.**

This `mds/` folder is the source of truth for Cursor agents working **in parallel**.

## Where to start

| Priority | Document | Content |
|----------|----------|---------|
| 1 | [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md) | Identity, ports, plugin architecture, deploy |
| 2 | `REMOTE3/Travaux/handoffs/DEMANDES-AUDIT-HELM2.md` *(outside repo)* | **Requests list + code compliance** (OK / missing / improve) |
| 3 | `REMOTE3/Travaux/handoffs/TRAVAIL-RECENT-JUIL-2026.md` *(outside repo)* | Summary of July 2026 Cursor sessions |
| 4 | [`FEATURE-SESSIONS-WORKSPACES.md`](./FEATURE-SESSIONS-WORKSPACES.md) | Stepper, SSH machines, paths, titles |
| 5 | [`FEATURE-VOICE-PRESENTATION.md`](./FEATURE-VOICE-PRESENTATION.md) | Voice, karaoke, Reborn, presentation |
| 6 | [`FEATURE-UI-CONSOLE.md`](./FEATURE-UI-CONSOLE.md) | Scroll, help ?, wake lock |
| 7 | [`TIMELINE-SYNC.md`](./TIMELINE-SYNC.md) | Server timeline, run_id contract, multi-bridge builder |
| 8 | [`VOICE-NAMES.md`](./VOICE-NAMES.md) | Machine names on mic: lexicon, corrector, aliases |
| 9 | [`BRIDGE.md`](./BRIDGE.md) | What is a bridge, how it works, traps (separate .envs) |
| 10 | [`OPT-BRIDGE.md`](./OPT-BRIDGE.md) | Bridge stack under `/opt/bridge` (outside app backup, outside bulldozer) |
| 10b | [`AGY-ANTIGRAVITY.md`](./AGY-ANTIGRAVITY.md) | **Key `AQ.` / agy** — do not put `GEMINI_API_KEY` (429 freeze) |
| 10c | [`OPENCODE-FREE-MODELS.md`](./OPENCODE-FREE-MODELS.md) | OpenCode **without Claude key** — `opencode/big-pickle` and `*-free` |
| 11 | [`UNIVERSE-V1.md`](./UNIVERSE-V1.md) | **Universe** — echo-system, master vault, freetier → vault |
| 12 | [`PLAN-SYMPHONY-PILOT.md`](./PLAN-SYMPHONY-PILOT.md) | **Integrated pilot** — vault + codex + maestro waves together |
| 13 | [`PLAN-VAULT-V1.md`](./PLAN-VAULT-V1.md) | Secrets vault — home `/apps/vault-v1/app/mds/` |
| 14 | [`PLAN-CODEX-V1.md`](./PLAN-CODEX-V1.md) | Registry for **agent context**, digests, agentic infra (≠ vault) |

## Useful Cursor Sessions (transcripts)

Agents can check transcripts in the Cursor workspace (not in the git repo):

| Session | Main Subject |
|---------|--------------|
| [Voice & KovZu infra](5e16752c-c1cb-4fe1-8050-ab927677d3e9) | Bridge, chat voice, Groq ack, Cartesia karaoke, multi-language |
| [Deliverables & voice admin](ae6b430b-dc9d-4031-9f4f-8d969b34028d) | Tables/charts format, voice admin saved vs active, karaoke ≠ display |
| [Current state assessment](60cf676a-99b9-4a6a-b09a-3510438c9115) | Synthesis helm-v1 / helm-v2 |
| [Presentation & helm-v2](0f9ca16e-7b2e-4cc2-90fe-cdf61180b500) | Session prime, ? button, presentation |

## Known Machines & Workspaces

| Machine | User | Session Example | Typical Workspace |
|---------|------|-----------------|-------------------|
| **gbs-h1** | helm-v2 / Xavier | Interface | `/apps/helm-v2/app` |
| **acer** | zaza | NOW2 | `/home/zaza/Bureau/NOW2` |
| **asus** | zaza | CURSOR / NOW3 | `/home/zaza/Bureau/CURSOR` |

KovZu session format: `machine/user/name` → URL `/console/machine/user/name`

## Common Rules (reminder)

- Human chat: **French** — code / comments: **English**
- Frontend fetch: `src/api/client.js` only
- DB: **mysql2** only
- No `alert` / `confirm` / `prompt`
- **Do not modify** helm-v1 nor cursorauto unless explicitly requested
- **Commit permanently authorized** — no need to ask (never secrets)
- Deploy: `npm run deploy` from `/apps/helm-v2/app`

## Priority Next Steps (VISION)

Real auth + magic links → mobile voice → desktop WebSocket → CRM POC

See [`VISION.md`](./VISION.md).
