# /opt/bridge — bridge stack + AI CLI (outside turbinobash)

The entire **bridge** stack (HTTP servers, LiteLLM, CLI binaries) lives under **`/opt/bridge/`**,
not in `/apps/<app>/`. Backups and `tb app sudo/bulldozer` only touch `/apps/`.

## Layout

```
/opt/bridge/
├── scripts/           install-opt-clis.sh, migrate-from-apps.sh, opt-bridge-paths.sh
├── cursor/            cursor-agent-bridge (:4310 helm-v2)
│   ├── bin/cursor-agent
│   ├── versions/<ver>/
│   ├── server.mjs
│   ├── .env
│   └── start-bridge.sh
└── claude/            claude-bridge (:4320) + LiteLLM (:4330)
    ├── bin/claude
    ├── server.mjs
    ├── .env
    ├── litellm-config.yaml
    ├── .venv/         LiteLLM (Python)
    ├── node_modules/  npm dependencies (outside app backup)
    └── start-all.sh
```

The old `/apps/<app>/bridge/` no longer exists under helm-v2 — everything is here.

**Antigravity (`agy`)**: `/opt/bridge/antigravity/` — port **4330** on gbs-tools.  
API key and freeze: see [`AGY-ANTIGRAVITY.md`](./AGY-ANTIGRAVITY.md).

## Install / migration

**New machine** (root):

```bash
bash /opt/bridge/scripts/migrate-from-apps.sh   # from legacy /apps/<app>/bridge
# or, if already migrated:
bash /opt/bridge/scripts/install-opt-clis.sh    # CLI only
bash /opt/bridge/cursor/scripts/install-h1.sh   # cursor bridge + systemd
```

**Services** (`helm-v2` user):

```bash
systemctl --user -M helm-v2@ enable --now cursor-agent-bridge claude-bridge
```

## Configuration

| Variable | Default |
|----------|---------|
| `OPT_BRIDGE_ROOT` | `/opt/bridge` |
| `CURSOR_AGENT_BIN` | `$OPT_BRIDGE_ROOT/cursor/bin/cursor-agent` |
| `CLAUDE_BIN` | `$OPT_BRIDGE_ROOT/claude/bin/claude` |

`.env` files: `/opt/bridge/cursor/.env`, `/opt/bridge/claude/.env`  
(see also [`CONTROL-SCOPE.md`](./CONTROL-SCOPE.md) — agent shell ≠ `app/.env`).

Agent workspaces: always under `/apps/helm-v2/ws` (`CURSOR_WS_BASE`, `CLAUDE_WS_BASE`).

## Git

**Nothing under `/opt/bridge/` is in the app git backup**:

| Content | Versioned? |
|---------|------------|
| `cursor-agent`, `claude` (binaries) | No — machine installation |
| `.venv`, `node_modules` | No |
| `.env` (secrets) | No |
| `server.mjs`, scripts | Yes — repo [claude-code-llm](https://github.com/xavdp-pro/claude-code-llm) + cursor bridge on disk |

Source code can be cloned / rsynced to `/opt/bridge`; large artifacts remain outside git.

## Bulldozer

`tb app sudo/bulldozer helm-v2` does **not** touch `/opt/bridge/`.  
Inside the app, one may still need to fix: `esbuild` in `app/node_modules` → `bash app/scripts/fix-exec-bits.sh`.

See `REMOTE3/Travaux/handoffs/BULLDOZER-INCIDENT.md` *(outside repo)*, [`BRIDGE.md`](./BRIDGE.md).
