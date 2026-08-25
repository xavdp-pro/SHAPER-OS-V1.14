# Universe: univ-demo

> **Intent Classification**: SPECIFIC INTENT (Universe: univ-demo)

## 1. Declarative Objective

Public **Shaper OS** demonstration universe: a live operator cockpit visitors can try, break, and leave — restored every night so the next visitor starts clean.

## 2. Invariants

1. **No client data.** Only fictional / disposable demo state. Never connect a production mailbox or a real customer vault.
2. **Nightly restore at 02:00** (host local time / Europe continental). Database reference snapshot + volatile tmp cleared. Documented on the public site.
3. **Secrets stay out of git.** Tunnel tokens, API keys, MySQL passwords live under `/apps/…/etc` or `sav/` only.
4. **Three interaction modes** are first-class product claims (not decoration):
   - **Écran** — at a desk: see chat, tables, timelines on the screen.
   - **Télécommande** — phone as remote: voice / Stop here; results appear on the PC screen.
   - **Route (kit main libre / voiture)** — driving: ears only, short spoken answers, no tables until you stop.
5. **Perimeter law.** Helm `/console` is P2 (operator). Client CRM / shops stay P3 — never merged into this cockpit.
6. **Proof before promise.** `npm test` green in `software/` before treating a deploy as healthy.

## 3. Document map

| File | Role |
| :--- | :--- |
| `INTENT.md` | This file — law for the universe |
| `manifest.json` | Brick graph (vault → logger → bridge → queue → maestro → helm) |
| `AGENT-DEPLOY.md` | What the deploy agent may do |
| `context/AGENT-CONTEXT.md` | Runtime context for the demo agent |
| `scripts/nightly-restore.sh` | 02:00 restore procedure (DB + volatile state) |
| `deploy/univ-demo.env.example` | Env template (no secrets) |

## 4. Public surface

| | |
| :--- | :--- |
| **URL** | `http://127.0.0.1:8650` (public) · runtime **`/apps/univ-demo`** · Podman stack **`univ-demo-*`** |
| **Restore** | Every day at **02:00** — playground reset |
| **Kit** | This folder under SHAPER-OS-V1.6 |

Deploy agent: read **INTENT → manifest → AGENT-DEPLOY**.
