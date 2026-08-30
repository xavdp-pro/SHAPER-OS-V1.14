# PREREQUISITES — what must be true before an agent starts

> **The rule (Rule 0J applied to the start line).** An agent does **not**
> begin a deployment while a prerequisite below is not met. The gate is
> mechanical: `npm run preflight` (from `software/`) must exit 0. There is
> exactly one exception: the human working WITH the agent may overrule it —
> `SHAPER_HUMAN_OVERRIDE=1 npm run preflight` — and that override is the
> human's word, given explicitly, in this session; an agent never sets it
> for itself, and it records the override and the failures it covered in
> its report.

## 1. Infrastructure (per machine — ask, never invent)

| Prerequisite | How to check | Who provides it |
| :--- | :--- | :--- |
| A host with native LXC (or Proxmox) | `lxc list` answers | operator |
| The `podman-univ` LXC profile | `lxc profile show podman-univ` | operator |
| **The podman registry of THIS machine** | `curl -sf http://$SHAPER_REGISTRY/v2/` | **operator — one registry per machine, recorded in the fleet map (`fleet.yml` → `machines:`). The address must be reachable from INSIDE a universe LXC — a loopback answered on the host names the LXC itself. If you do not know it: ASK. If the human is absent: STOP and write it down.** |

## 2. Tools on the deploy host

`git`, `podman`, `curl`, `python3`, `openssl`, `node` (built-ins only — the
verifier and the preflight run on a naked clone, before any `npm install`).

## 3. The shell contract

`SHAPER_REGISTRY` and `SHAPER_IMAGE_TAG` are exported in **your** shell and
die with it. A harness that opens a fresh shell per command (`lxc exec`
does) re-exports them before every step that builds, pushes or deploys.

## 4. The minimum `software/.env` — created at Step 4.1, listed here once

| Variable | Minimum | Produced by |
| :--- | :--- | :--- |
| `VAULT_MASTER_KEY` | 64 hex chars, never a `<placeholder>` | `openssl rand -hex 32` |
| `VAULT_TOKEN` | 48 hex chars, never a `<placeholder>` | `openssl rand -hex 24` |
| `OPENCODE_MODEL` | the cheapest engine that answered (Rule 7) | **measured at Step 4.2b** — it cannot be known before the bridge image exists; `podman-up.sh` halts without it |

Everything else in `.env.example` is either a port with a sane default or a
**tier-b key** (Groq, Deepgram, …): those are optional — a missing tier-b
key is an honest halt of that perimeter (P3), never a fake and never a
blocker for tier-a. See `docs/human/KEYS-AND-ACCOUNTS.md`.

## 5. The two gates, in order

1. **`npm run preflight`** — at the start, right after the registry answer
   (runbook Step 0c): tools present, registry named and reachable, image tag
   named, and — if `software/.env` already exists — its vault keys real, not
   placeholders. Exit 1 = do not start.
2. **`podman-up.sh`** — at deploy: refuses to run without `OPENCODE_MODEL`
   and without real vault material. Its halts are by design; they name the
   variable.

A failed gate is a **measured result**: report it, do not work around it.
The only path past a red gate is the human's explicit override, and the
report says so.
