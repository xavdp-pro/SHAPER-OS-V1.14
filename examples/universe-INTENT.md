> **Intent Classification**: SPECIFIC INTENT (Universe: <univ_slug>)

# Universe: <univ_slug>

**Lifecycle:** `dev` | `test` | `prod`  (pick one — see `LIFECYCLE.md` in the kit)

## 1. Objective

<One sentence: what this install is for.>

## 2. Invariants

1. Secrets only via vault — never in git.
2. Every agent action is logged.
3. `npm test` green before images; `npm run test:live` green after the stack is up.
4. Client-facing apps are not served from Helm `/console`.
5. If `test`: rebuild from empty, then destroy. If `prod`: update by git tag only. If `dev`: no production mailboxes.

## 3. Files

| File | Role |
| :--- | :--- |
| `INTENT.md` | This file |
| `manifest.json` | Bricks + boot order |
| `AGENT-DEPLOY.md` | What the install agent may do |
| `context/AGENT-CONTEXT.md` | Runtime agent only |
