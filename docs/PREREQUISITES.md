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
| The profile **applied** to the universe container | `lxc config show <univ> \| grep -A2 '^profiles:'` — never `lxc info`, which lists no profile; on Proxmox `pct config <vmid>` shows `features: nesting=1`. Set after launch, nesting applies only after `lxc restart` / `pct reboot` ([Rule 11](../software/RULES.md#rule-11-read-profiles-with-config-show)) | agent, at runbook Step 0a |
| `nftables` **inside** the universe LXC | `lxc exec <univ> -- dpkg -s nftables` | agent, at runbook Step 0a — podman's nested network dies opaquely without it ([Rule 11](../software/RULES.md#rule-11-nftables-inside-the-universe)) |
| **The podman registry of THIS machine** | `curl -sf http://$SHAPER_REGISTRY/v2/` | **operator — one registry per machine, recorded in the fleet map (`fleet.yml` → `machines:`). The address must be reachable from INSIDE a universe LXC — a loopback answered on the host names the LXC itself. If you do not know it: ASK. If the human is absent: STOP and write it down.** |

## 2. Tools on the deploy host

`git`, `podman`, `curl`, `python3`, `openssl`, `node` (built-ins only — the
verifier and the preflight run on a naked clone, before any `npm install`).
Inside the universe LXC, also `nftables` (podman's nested network) and
`iproute2` (`ss`, so the preflight can see which ports are already held —
without it the gate falls back to `/proc/net/tcp` and cannot name the holder).

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

**The file holds only variables.** Three kinds of line are admitted: blank,
`#` comment, and `KEY=value` where `KEY` matches `[A-Z][A-Z0-9_]*` (digits
allowed — `R2_BUCKET_NAME` is a variable). The deploy script `source`s the
file, so any other line is executed by bash; a human note written into it
killed a deploy silently. Both gates halt on such a line and quote it. A
note for a human goes behind `#`
([proof, lesson 7](./proof/proof-rule-11-in-production.md#a-variables-file-holds-only-variables)).

## 5. The two gates, in order

1. **`npm run preflight`** — at the start, right after the registry answer
   (runbook Step 0c): tools present, registry named and reachable, image tag
   named, and — if `software/.env` already exists — every line a variable and
   its vault keys real, not placeholders. Exit 1 = do not start. Run it
   **again** once the universe exists, as
   `node scripts/preflight.mjs --universe <path to <slug>-dev>` (runbook Step
   4.4): the ports its manifest declares must be free in this LXC — bricks run
   with `--network host`, and a service the container already runs holds the
   port first ([Rule 11](../software/RULES.md#rule-11-declared-ports-are-free)).
   Without `--universe` the port check is skipped out loud, never silently.
2. **`podman-up.sh`** — at deploy: refuses to run without `OPENCODE_MODEL`,
   without real vault material, and on an env file carrying a line that is
   not a variable. Its halts are by design; they name the variable, or quote
   the line.

A failed gate is a **measured result**: report it, do not work around it.
The only path past a red gate is the human's explicit override, and the
report says so.
