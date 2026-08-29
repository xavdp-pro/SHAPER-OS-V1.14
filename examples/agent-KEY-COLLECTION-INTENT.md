> **Intent Classification**: INSTALL ASSIST (Human + IDE agent)

# Agent intent — digest repo, collect keys, install DEV

Paste this to your IDE agent **after** cloning [SHAPER-OS-V1.13](https://github.com/xavdp-pro/SHAPER-OS-V1.13) and opening the folder.

---

## Your role

You are my **Shaper OS install agent**. You know Linux. I may not know this project. You execute the kit — you do not invent a new architecture.

## Read first (in order)

1. [`LAW.md`](../LAW.md)
2. [`START-HERE.md`](../docs/human/START-HERE.md)
3. [`AGENTS.md`](../AGENTS.md)
4. [`KEYS-AND-ACCOUNTS.md`](../docs/human/KEYS-AND-ACCOUNTS.md)

## Phase 1 — Digest the repository

- Confirm we are in the V1.6 monorepo (`software/packages` exists).
- Summarize in **5 bullets** what tier-a installs vs what tier-b adds.
- Tell me honestly which **external signups** I need (tier-a = **none**).

## Phase 2 — Keys (tier-a first)

1. **You generate** (never commit):
   - `VAULT_MASTER_KEY` → `openssl rand -hex 32`
   - `VAULT_TOKEN` → `openssl rand -hex 24`
2. Copy `.env.example` → `software/.env` and fill vault keys.
3. Copy `software/resources/vault-resources.dev.example.json` → `software/resources/vault-resources.local.json` — align `masterKey` and `token` with `.env`.
4. Do **not** ask me for Deepgram, Groq, or Cloudflare until tier-a tests are green and I ask for voice / public URL.

## Phase 3 — Strict `.env` Verification & Multi-Podman Propagation

Before launching the containers (`podman-up.sh`):

1. **Verify completeness**: Check `.env` at repo root (`.env`) or `software/.env`.
2. **Proactive Reclamation (Mandatory Halt)**: If any required key for the target tier (`DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `VAULT_MASTER_KEY`, `JWT_SECRET`, Cloudflare token) is missing or empty, **HALT IMMEDIATELY**. Do not launch containers blindly. Proactively prompt me with the vendor link from the table below and wait for me to paste the key.
3. **Propagate**: Copy/sync the validated `.env` to `software/.env` and universe deployment configs (`deploy/*.env`) so all Podman containers receive valid credentials.

| I need | Open this URL | Paste into |
| :--- | :--- | :--- |
| Speech (STT/TTS) | https://console.deepgram.com/ → API Keys | `DEEPGRAM_API_KEY` in `.env` |
| Fast voice ack | https://console.groq.com/keys | `GROQ_API_KEY` in `.env` |
| Public HTTPS tunnel | https://one.dash.cloudflare.com/ → Networks → Tunnels | `<univ>-dev/sav/tunnel/token` |

Guide me click-by-click. Wait for me to complete login / 2FA. I paste secrets **only** into local files — never into chat or git.

Optional later: [Cartesia](https://play.cartesia.ai/), [ElevenLabs](https://elevenlabs.io/app/settings/api-keys), [OpenRouter](https://openrouter.ai/keys) — only if brick INTENT requires them.

---

## ⚖️ Standard vs Freestyle Rule

- **Standard Recipe (100% Predictable)**: I provide the complete `.env` with valid keys. You validate, propagate, and execute. Outcome: 100% green and autonomous.
- **Freestyle Mode (My Responsibility)**: If I ask you to proceed with missing or partial keys (e.g. while waiting for an account), warn me of inactive/degraded features. Managing freestyle mode is my responsibility with you.

---

## Phase 4 — Install pipeline (do not reorder)

Execute exactly [`START-HERE.md`](../docs/human/START-HERE.md) § Install order:

```bash
cd software && npm run vault:bootstrap && npm test
bash scripts/build-all-bricks.sh
# create universe, podman-up, then:
npm run test:live
```

**Stop on any failure.** Do not skip tests. Do not commit secrets.

## Done when

- Tier-a: all health curls OK + `npm run test:live` green.
- Tier-b (if requested): `npm run test:live:helm` green.
- Point me to [`PROOF.md`](../docs/human/PROOF.md) for the operator loop.
