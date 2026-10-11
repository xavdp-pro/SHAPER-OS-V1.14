> **Intent Classification**: SPECIFIC INTENT (Universe: <univ_slug>)

# Universe: <univ_slug>

**Lifecycle:** `dev` | `test` | `prod`  (pick one — see `LIFECYCLE.md` in the kit)

## 1. Objective

<One sentence: what this install is for.>

## 2. Invariants

1. Secrets only via vault — never in git.
2. Every agent action is logged.
3. `npm test` green before images; `deploy/proof.sh` and both drills green after the units are up — a health check is not a proof.
4. Every functional unit is one Podman holding its application and its own MariaDB server, under one name (Rules 4 and 26); the base units are univ-minimal's, at one recorded revision (`base/.shaper-revision`).
5. Client-facing apps are not served from Helm `/console`.
6. If `test`: rebuild from empty, then destroy. If `prod`: update by git tag only. If `dev`: no production mailboxes.

## 3. Files

| File | Role |
| :--- | :--- |
| `INTENT.md` | This file |
| `manifest.json` | Units + boot order — the four base units first |
| `AGENT-DEPLOY.md` | What the install agent may do |
| `context/ctx-universe.md` | Runtime agent only |
