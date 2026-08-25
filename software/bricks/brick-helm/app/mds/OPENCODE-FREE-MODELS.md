# OpenCode — Free Models (without Claude Key)

When **agy** is at quota and one **does not want** an `ANTHROPIC_API_KEY` / Claude: run **OpenCode** on **Zen free** models.

Official doc: [opencode.ai/docs/zen](https://opencode.ai/docs/zen/).  
The bridge now exists: `/opt/bridge/opencode`, port **4340** on gbs-tools
(dedicated repo: [opencode-bridge](https://github.com/xavdp-pro/opencode-bridge)).
Helm registers it by default, alongside `cursor` and `agy`.
This document covers direct **CLI usage**; for console, use the bridge.

---

## What NOT to set

| Variable | Why |
|----------|-----|
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | Paid Claude — **unnecessary** for free models |
| `GEMINI_API_KEY` | Mixed up with agy / Gemini free-tier |
| OpenAI key | Paid Zen models |

No Claude login. The `*-free` and `big-pickle` IDs are **$0** on the Zen side (limited period, changing roster).

---

## Install (if `opencode` is missing)

```bash
curl -fsSL https://opencode.ai/install | bash
# typical binary: ~/.opencode/bin/opencode
export PATH="$HOME/.opencode/bin:$PATH"
opencode --version
```

---

## List `opencode` provider models

```bash
opencode models opencode
```

Look for `*-free` and `big-pickle` lines.

---

## Launch **without** Claude key

```bash
# Test
opencode run --model opencode/big-pickle "Reply with the single word PONG"

opencode run --model opencode/deepseek-v4-flash-free "Explain this repo in 5 bullets"
opencode run --model opencode/mimo-v2.5-free "Review this file for bugs"
```

TUI:

```bash
opencode
# /models → choose opencode/big-pickle or a *-free
```

Config (`~/.config/opencode/opencode.jsonc`) — **no** Anthropic key:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/big-pickle",
  "small_model": "opencode/deepseek-v4-flash-free"
}
```

---

## Free Models (Zen, August 2026)

CLI IDs = `opencode/<id>`. Source: [Zen](https://opencode.ai/docs/zen/).

| Name | ID | Notes |
|------|----|-------|
| Big Pickle | `big-pickle` | Stealth, general coding |
| DeepSeek V4 Flash Free | `deepseek-v4-flash-free` | Fast |
| MiMo-V2.5 Free | `mimo-v2.5-free` | Coding |
| Hy3 Free | `hy3-free` | Limited period |
| Laguna S 2.1 Free | `laguna-s-2.1-free` | Limited period |
| Nemotron 3 Ultra Free | `nemotron-3-ultra-free` | NVIDIA trial — **no personal secrets** |
| Nemotron 3.5 Lightning Free | `nemotron-3.5-lightning-free` | same NVIDIA |

Zen `claude-*`, `gpt-*`, `gemini-*` are **paid** (Zen or provider key) — do not select them if refusing an API.

If `opencode run` requests a Zen login solely for a `*-free` model, retry `big-pickle` / `deepseek-v4-flash-free`. This is **still not** a Claude key.

---

## OpenAI-compatible HTTP (without Anthropic)

Zen endpoint (free models, same `chat/completions` family):

```text
https://opencode.ai/zen/v1/chat/completions
```

Example (if an **OpenCode Zen** key exists — this is not Claude):

```bash
curl -sS https://opencode.ai/zen/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENCODE_ZEN_KEY" \
  -d '{
    "model": "big-pickle",
    "messages": [{"role":"user","content":"PONG only"}]
  }'
```

For freezing agents: **prefer CLI** `opencode run --model opencode/big-pickle` — often **without** `opencode auth login` on these IDs.

JSON list: `https://opencode.ai/zen/v1/models`

---

## vs agy (reminder)

| | agy | OpenCode free |
|--|-----|----------------|
| Auth | Google OAuth + `AQ.` | Not Claude; often no key |
| Helm HTTP | `http://127.0.0.1:4340` | opencode-bridge, `opencode-bridge.service` unit |
| Current quota | Individual quota ~107 h | Independent of Google agy account |

Do not mix `ANTHROPIC_*` into the `opencode` process environment.
