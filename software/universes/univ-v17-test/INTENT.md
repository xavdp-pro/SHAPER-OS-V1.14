# Universe: univ-v17-test — V1.7 Clean-Sheet Proof

> **Intent Classification**: SPECIFIC INTENT (Universe: univ-v17-test)
> **Lifecycle**: TEST — ephemeral and destroyed after evidence is exported.

## 1. Declarative Objective

Prove that an autonomous deploy agent can materialize the V1.7 Tier-A universe from this repository inside a fresh, unprivileged LXC on `gbs-test`, then obtain a real terminal response through the Podman queue-to-OpenCode path without human installation steps.

## 2. Invariants

1. The authority chain is `LAW.md` → `software/RULES.md` → this INTENT → `manifest.json` → every referenced brick `INTENT.md`; scripts only materialize that declared state.
2. The universe contains exactly the five bricks declared by the manifest: Vault, Logger, OpenCode bridge, Queue, and Maestro, started in `bootOrder` only after prior layers are healthy.
3. All SHAPER images use one immutable tag derived from the checked-out Git commit. No SHAPER `latest` tag may be deployed.
4. `BRIDGE_OPENCODE_STUB=0`, no production credential or mailbox is used, and no service is exposed publicly from the LXC.
5. State, audit, queue, and agent workspaces persist in universe-owned bind mounts; secrets exist only in ignored local files or the encrypted Vault.
6. Success requires tests plus evidence of a real queued job reaching a terminal state through OpenCode and an audit record. Once evidence is exported to the parent, the TEST LXC is destroyed.

## 3. Document map

| File | Role |
| :--- | :--- |
| `INTENT.md` | Specific law for this TEST universe |
| `manifest.json` | Machine-readable brick graph and specialization |
| `AGENT-DEPLOY.md` | Autonomous deploy-agent contract |
| `context/ctx-universe.md` | Runtime-agent context at beat time |
| `deploy/env.example` | Non-secret environment contract |

The deploy agent reads files in this order: **INTENT → PERIMETERS → manifest → AGENT-DEPLOY → topology → brick INTENT files**.
