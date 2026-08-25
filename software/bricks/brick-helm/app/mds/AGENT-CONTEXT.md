# Helm-v2 — agent context (source of truth)

Human chat: **French**. Code / comments: **English**.

## Identity

| Element | Value |
|---------|-------|
| Product | **KovZu** — multi-CLI console (plugins) |
| turbinobash App | `helm-v2` (**noweb** profile + MariaDB) |
| Server | **gbs-h1** |
| Code | `/apps/helm-v2/app` |
| Repo | https://github.com/xavdp-pro/helm-v2 (private) |
| URL | **http://127.0.0.1:7923** |
| Unix / MySQL User | `helm-v2` |

Fork / evolution of helm-v1 — **do not mix** ports or bridges.

## Ports

| Service | Port |
|---------|------|
| Vite | **7923** |
| API | **7926** |
| cursor-agent-bridge | **4310** |
| claude-bridge | **4320** |
| LiteLLM (claude-code-llm) | **4330** |

helm-v1 remains on 7823 / 7826 / 4210.

## Plugin Architecture

```
Helm-v2 chat UI + API
        │
        ▼
  sessionOrchestrator (briefing, clear, prime — plugin-agnostic)
        │
        ▼
  agentAdapters (cursor / claude / generic — per-CLI specifics)
        │
        ▼
  agentPlugins (HTTP bridge registry)
        ├── cursor  → :4310 → cursor-agent CLI
        └── claude  → :4320 → Claude Code CLI (+ LiteLLM :4330)
```

### Adapter Contract (`server/lib/agentAdapters/`)

Each CLI exposes an adapter with:

| Capability | Description |
|------------|-------------|
| `stopRun` | Can interrupt a running run (`/conversations/stop`) |
| `resetSession` | Can reset the CLI context |
| `bindWorkspace` | Can bind a cwd per conversation |
| `modelField` | `composer` \| `litellm` \| `passthrough` for `/api/inject` |
| `transportLabel` | UI status label |

Methods: `resetSession`, `stopRun`, `buildInjectBody`.

Adding a CLI = new adapter file + `AGENT_PLUGINS` entry.

### Orchestrated Session API

| Route | Role |
|-------|------|
| `POST /api/session/prime` | Briefing + prime run (server timeline) |
| `POST /api/session/reset` | CLI reset; `{ prime: true }` reloads briefing |
| `POST /api/session/clear` | **Preferred in UI**: stop + empty timeline + reset + prime |

- Voice ack **Groq** before response, **regardless** of CLI / model.
- Cursor models: Grok 4.5 (low/medium/high × fast) + Composer 2.5.

## Deploy (gbs-h1, one-shot)

URL: **http://127.0.0.1:7923** — code: `/apps/helm-v2/app`

```bash
cd /apps/helm-v2/app
npm run deploy          # build + API :7926 + vite preview :7923
npm run deploy:front    # build + restart front only
npm run deploy:api      # restart API only
```

PM2: `helm-v2-api`, `helm-v2-vite` (+ `helm-v2-claude-bridge`, `helm-v2-litellm` if Claude).

Claude bridge: **`/opt/bridge/claude/`** ([claude-code-llm](https://github.com/xavdp-pro/claude-code-llm)).

Full bridge stack (CLI + HTTP servers + LiteLLM): **`/opt/bridge/`** — see [`OPT-BRIDGE.md`](./OPT-BRIDGE.md).

## Agent Docs (recent work)

**Parallel agents — helm-v2 target only:**

1. [`INDEX-AGENTS.md`](./INDEX-AGENTS.md)
2. `REMOTE3/Travaux/handoffs/DEMANDES-AUDIT-HELM2.md` *(outside repo)* ← requests + compliance
3. `REMOTE3/Travaux/handoffs/TRAVAIL-RECENT-JUIL-2026.md` *(outside repo)*

| Doc | Subject |
|-----|---------|
| [`FEATURE-SESSIONS-WORKSPACES.md`](./FEATURE-SESSIONS-WORKSPACES.md) | Stepper, machines, paths, CURSOR titles |
| [`FEATURE-VOICE-PRESENTATION.md`](./FEATURE-VOICE-PRESENTATION.md) | Voice, karaoke, Reborn, auto presentation |
| [`FEATURE-UI-CONSOLE.md`](./FEATURE-UI-CONSOLE.md) | Scroll, help ?, wake lock |

**Do not modify helm-v1** for KovZu.
