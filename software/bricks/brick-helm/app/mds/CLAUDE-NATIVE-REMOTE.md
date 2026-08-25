# Native Claude Code + Remote Control (without LiteLLM)

Allows driving **Claude Code on gbs-h1** from the **Claude mobile app**
(**Code** tab) with direct Anthropic **Sonnet** or **Opus** — not via LiteLLM.

## Two Claude modes on helm-v2

| Mode | Usage | Models | Mobile |
|------|-------|--------|--------|
| **Bridge + LiteLLM** | KovZu UI (`inject` / maestro tasks) | OpenRouter, Ollama, Kimi… | No |
| **Native + Remote Control** | Local session `claude remote-control` | Sonnet, Opus, Haiku (subscription) | Yes — Code tab |

Remote Control **does not work** if `ANTHROPIC_BASE_URL` points to LiteLLM
(see [Anthropic doc](https://code.claude.com/docs/en/remote-control)).

## Prerequisites (one time)

**From Helm (recommended)** — Admin → CLI → **Native Claude — Remote Control**:

1. Click **"Open Claude connection"** → a tab opens on claude.com
2. Sign in with your subscription
3. Copy the displayed **code** and paste it into Helm
4. Status → **Connected**

**In terminal** (alternative):

```bash
runuser -u helm-v2 -- env HOME=/apps/helm-v2 \
  PATH=/opt/bridge/claude/bin:$PATH claude auth login --claudeai
```

Verify:

```bash
runuser -u helm-v2 -- env HOME=/apps/helm-v2 \
  PATH=/opt/bridge/claude/bin:$PATH claude auth status
# → "loggedIn": true
```

## Launch a session visible on mobile

```bash
cd /apps/helm-v2/app

# Sonnet (default) — server mode, QR code + list in app
npm run claude:remote

# Opus
npm run claude:remote -- opus

# Interactive terminal + mobile in parallel
npm run claude:remote -- sonnet --interactive
```

Direct equivalent:

```bash
bash /opt/bridge/claude/scripts/native-remote-control.sh sonnet /apps/helm-v2/app
```

## On the phone

1. Open **Claude** app (Android / iOS)
2. Tab **Code**
3. Session **"KovZu — Sonnet"** (or Opus) appears with a green dot
4. Or scan the **QR code** displayed in the terminal (Space key)

In an already open session: `/remote-control` or `/rc` to activate it.

## Session Name

Default: `KovZu — Sonnet` / `KovZu — Opus`.

Customize:

```bash
CLAUDE_RC_NAME="helm-v2 debug" npm run claude:remote
```

## Files

| Path | Role |
|------|------|
| `/opt/bridge/claude/scripts/native-remote-control.sh` | Launcher (cleans LiteLLM env) |
| `/opt/bridge/claude/templates/claude-settings.native.json` | Settings without gateway |
| `scripts/claude-native-remote.sh` | helm-v2 wrapper |
| `/opt/bridge/claude/.env` | **Only** for headless bridge — do not source for RC |

## Do not confuse

- `claude-bridge` (:4320) + LiteLLM (:4330) → remains for **KovZu** (HTTP inject)
- `claude remote-control` → **human session** visible on mobile, native Anthropic models
