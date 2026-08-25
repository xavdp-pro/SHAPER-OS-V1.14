# Connecting `agy` (Antigravity) with an API Key

For **another agent** (other machine, other Unix user, process that **freezes**): do not paste a Gemini AI Studio key into `GEMINI_API_KEY`. This is the bug we previously had on helm-v2 / gbs-tools.

Live working reference: **gbs-tools**, user `helm-v2`, bridge **`:4330`**.

---

## HTTP Procedure — the other agent talks to the bridge (not `agy` directly)

The other agent **does not launch** `agy`. It calls **HTTP** `127.0.0.1:4330` (same machine) or an SSH tunnel to this port.

Token = **bridge** file (not the `AQ.` key):

```text
/apps/helm-v2/.config/antigravity-bridge/token
```

### 1. Health

```bash
TOKEN=$(cat /apps/helm-v2/.config/antigravity-bridge/token)

curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:4330/api/health
# { "ok": true, "service": "antigravity-bridge" }

curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:4330/api/status
```

### 2. Open SSE stream **before** injecting

```bash
curl -sS -N -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:4330/api/events?conversation=mon-agent"
```

Events: `connected`, `inject`, `response` (tokens), `response_complete`, `run_complete`, `log`.

### 3. Send message

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation": "mon-agent",
    "message": "Bonjour",
    "model": "gemini-3.7-flash-low"
  }' \
  http://127.0.0.1:4330/api/inject
```

`conversation` = stable id (like a room). Same id = same workspace under `/apps/helm-v2/ws/antigravity/<id>/`.

### 4. From another machine

```bash
ssh -N -L 4330:127.0.0.1:4330 gbs-tools
# then the curls above on http://127.0.0.1:4330
```

In Helm: `AGENT_PLUGINS=agy|http://127.0.0.1:4330|<token>`.

**Do not** put `AQ.` or `GEMINI_API_KEY` in the HTTP header. Only `Authorization: Bearer <token-bridge>`.

If `response_complete` has `"exit":1` and empty text: quota / Google login of the **agy process on gbs-tools**, not an HTTP bug.

**Workaround without Claude:** OpenCode free models — [`OPENCODE-FREE-MODELS.md`](./OPENCODE-FREE-MODELS.md) (`opencode run --model opencode/big-pickle`, **no** `ANTHROPIC_API_KEY`).

---

## 1. Two keys, two backends — do not mix

| Variable | Typical prefix | Backend | Effect |
|----------|----------------|---------|--------|
| **`ANTIGRAVITY_API_KEY`** | `AQ.` | Antigravity (Google account / `agy` CLI) | **This is the one** |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `AIza…` | **Gemini Developer API** (free-tier) | **429** quota, `*-flash-low` models **unknown**, agent **spinning / freezing** |

The official script **unsets** Gemini when starting the bridge:

`/opt/bridge/antigravity/start-bridge.sh`

```bash
# AQ.* is an Antigravity key, not a Gemini Developer API key.
unset GEMINI_API_KEY
unset GOOGLE_API_KEY
```

If you leave `GEMINI_API_KEY` in the `.env` of the **`agy` process**, the CLI forces `modelProvider: gemini` → freeze / 429.

---

## 2. Where to place the key (headless agent)

Agent HOME = the Unix user running `agy` (e.g. `helm-v2` → `HOME=/apps/helm-v2`).

### A. Bridge file (recommended)

`/opt/bridge/antigravity/.env` — **chmod 600**, bridge user:

```bash
ANTIGRAVITY_BRIDGE_PORT=4330
ANTIGRAVITY_BRIDGE_BIND=127.0.0.1
ANTIGRAVITY_BIN=/opt/bridge/antigravity/bin/agy
ANTIGRAVITY_WS_BASE=/apps/<mon-app>/ws/antigravity
ANTIGRAVITY_MODEL=gemini-3.7-flash-low
ANTIGRAVITY_API_KEY=AQ.xxxxxxxx
```

Do **not** add `GEMINI_API_KEY` here.

### B. Credentials file in agent HOME

`~/.config/antigravity/credentials.json` (chmod 600):

```json
{ "api_key": "AQ.xxxxxxxx" }
```

`start-bridge.sh` reads this JSON if `ANTIGRAVITY_API_KEY` is empty.

### C. Google Login (often required in addition to key)

The CLI might say `You are not logged into Antigravity` even with a key.

On gbs-tools we copied the desktop Google session:

| File | Role |
|------|------|
| `$HOME/.gemini/antigravity-cli/antigravity-oauth-token` | OAuth CLI |
| `$HOME/.config/antigravity/credentials.json` | key / creds |
| `$HOME/.gemini/antigravity-cli/settings.json` | model, effort, print |

Copy from a machine where `agy` **already responds** (**the same Google account** as the `AQ.` key), `chown` to the agent user.

### D. Procedure — other account (quota full on the first)

The `AQ.` key **does not change** the billed account. `agy` uses the **Google login** in `antigravity-oauth-token`. Without this file → `authentication required`. With the token of the account at quota → `Individual quota reached`.

**On the PC where the other Antigravity account is already logged in** (desktop Antigravity or responding `agy`):

```bash
# Linux / user who opened Antigravity
ls -l ~/.gemini/antigravity-cli/antigravity-oauth-token
# sometimes also:
ls -l ~/.config/antigravity/credentials.json
```

Copy **privately** (scp, no chat, no git) to gbs-tools, user `helm-v2`:

```bash
# from source PC (example)
scp ~/.gemini/antigravity-cli/antigravity-oauth-token \
  gbs-tools:/tmp/agy-oauth-new
```

**On gbs-tools** (root / agent):

```bash
HOME_AGY=/apps/helm-v2
install -o helm-v2 -g helm-v2 -m 600 /tmp/agy-oauth-new \
  "$HOME_AGY/.gemini/antigravity-cli/antigravity-oauth-token"
rm -f /tmp/agy-oauth-new

# AQ. key of the SAME account (already in /opt/bridge/antigravity/.env)
# do not leave GEMINI_API_KEY

systemctl --user --machine helm-v2@ restart antigravity-bridge
```

**Test** (should no longer mention quota / auth):

```bash
sudo -u helm-v2 -H env HOME=/apps/helm-v2 PATH=/opt/bridge/antigravity/bin:$PATH \
  timeout 45 agy -p 'Reply with the single word PONG' \
  --model gemini-3.7-flash-low --output-format text \
  --print-timeout 30s --dangerously-skip-permissions
```

If the desktop is **Windows**: the token is often located under  
`%USERPROFILE%\.gemini\antigravity-cli\antigravity-oauth-token`.

`settings.json` **must not** force Gemini:

```json
{
  "dangerouslySkipPermissions": true,
  "effort": "low",
  "model": "gemini-3.7-flash-low",
  "outputFormat": "stream-json"
}
```

**Forbidden**: `"modelProvider": "gemini"`.

---

## 3. Models (otherwise it freezes or "invalid model")

In Antigravity mode, `--model` requires an **effort suffix**:

| UI Family | ID to pass to `agy` |
|-----------|---------------------|
| Gemini 3.7 Flash low | `gemini-3.7-flash-low` |
| Gemini 3.6 Flash low | `gemini-3.6-flash-low` |
| Gemini 3.1 Pro | `gemini-3.1-pro-low` |

Helm normalizes: `gemini-3.7-flash` → `gemini-3.7-flash-low` (`server/lib/agentAdapters/agy.js`).

Another agent sending `gemini-3.7-flash` **without** `-low` may remain stuck.

Check:

```bash
sudo -u <user-agent> -H env HOME=/apps/<mon-app> \
  ANTIGRAVITY_API_KEY='AQ.…' \
  PATH=/opt/bridge/antigravity/bin:$PATH \
  agy models
```

---

## 4. Connecting another agent to the same `agy`

Same binary, separate **HOME / workspace / port**.

```
Browser / bot
    → your API
    → antigravity-bridge  127.0.0.1:PORT
    → spawn  agy -p "…" --model gemini-3.7-flash-low --output-format stream-json
```

1. Install CLI: `/opt/bridge/antigravity/bin/agy`
2. Copy `/opt/bridge/antigravity/` (server.mjs, start-bridge.sh) or reuse existing process **:4330** if on the same machine
3. Bridge HTTP token (not Google key):

```text
/apps/<mon-app>/.config/antigravity-bridge/token
```

Helm:

```bash
AGENT_PLUGINS=agy|http://127.0.0.1:4330|<token-bridge>
DEFAULT_AGENT_PLUGIN=agy
ANTIGRAVITY_BRIDGE_URL=http://127.0.0.1:4330
```

The **bridge token** authenticates KovZu ↔ Node. The **`AQ.` key** authenticates `agy` ↔ Google.

---

## 5. Why the other agent freezes (checklist)

1. `GEMINI_API_KEY` or `GOOGLE_API_KEY` in environment of `agy` process
2. `modelProvider: "gemini"` in `settings.json`
3. Model without `-low` / `-medium` / `-high`
4. No Google login (`antigravity-oauth-token` absent) → silent auth that never completes
5. Wrong HOME: `agy` writes into `/root/.gemini` instead of `/apps/<app>/`
6. Cold print mode: each `-p` restarts process + language server + silent auth (**2–8 s** min, not an infinite freeze)

systemd (helm-v2 example):

```ini
Environment=HOME=/apps/helm-v2
ExecStart=/bin/bash /opt/bridge/antigravity/start-bridge.sh
```

---

## 6. Test (without secrets in chat)

```bash
TOKEN=$(cat /apps/<mon-app>/.config/antigravity-bridge/token)

curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4330/api/status
# → "service":"antigravity-bridge","ready":true

curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"conversation":"diag-agy","message":"Reply only with: PONG","model":"gemini-3.7-flash-low"}' \
  http://127.0.0.1:4330/api/inject
```

Listen to SSE `GET /api/events?conversation=diag-agy`: `response_complete` + `exit: 0`.

Direct print (must answer, not stay open):

```bash
timeout 45 agy -p 'Reply with the single word PONG' \
  --model gemini-3.7-flash-low \
  --output-format text \
  --print-timeout 30s \
  --dangerously-skip-permissions
```

If it hangs > 45s: recheck §1 and §5.

---

## 7. gbs-tools paths (working reference)

| Element | Path |
|---------|------|
| Binary | `/opt/bridge/antigravity/bin/agy` |
| Bridge | `/opt/bridge/antigravity/server.mjs` |
| Key `.env` | `/opt/bridge/antigravity/.env` |
| Agent HOME | `/apps/helm-v2` |
| HTTP Token | `/apps/helm-v2/.config/antigravity-bridge/token` |
| Unit | `systemctl --user --machine helm-v2@ status antigravity-bridge` |
| Port | **4330** (on gbs-tools = Antigravity, **not** LiteLLM) |

Helm KovZu: `agy` plugin, model `gemini-3.7-flash-low`. Tested August 18, 2026: inject `AGY-PONG-18` OK.
