# The law does not bend — SHAPER OS V1.13

This kit exists to **execute** Shaper OS, not to dilute it.

If a step is law, it is **mandatory**. Convenience is not a reason to skip it.

| We are determined | We do not |
| :--- | :--- |
| Unit tests green on a **fresh clone** before images | Skip tests because “the stack will fail them anyway” |
| Live tests green **after** the stack is up | Run live tests before deploy, then ignore the red |
| No secrets in git | Ship default API keys “so it works on my machine” |
| First install is **DEV** | Call a laptop **PROD** |
| TEST is rebuilt from empty, then **destroyed** | Keep a dirty TEST |
| `/console` is perimeter 2 | Put the client shop in Helm |
| Bricks are referenced, not copied | Fork Containerfiles into the universe |
| Voice in `/console` | Revive `/talk` or `/voice` |
| **Parent repairs Child ($K+1 \rightarrow K$)** | Let an agent modify its own active infrastructure in-flight |
| **Parent holds SSH authority ($K+1 \rightarrow K$)** | Pass private keys to children or mutate prod directly |
| **TEST rebuilt clean-sheet from zero** | Retain dirty artifacts or unverified caches during validation |
| **Quality Gate automated check** | Mark a job COMPLETED without test proof |
| **Simple mode is 100% jargon-free** | Expose P1/P2/P3/Maestro/Tokens to business owners |
| **Agent context is 100% pre-digested** | Overload an agent with out-of-scope system architecture |
| **Canary first, fleet second** | Push a config to 50 children at once |
| **A repair loop that can give up** | Hammer a failing child forever instead of raising `DEGRADED` |
| **Every fixed bug ships its test** | Close a defect on "it works now" |
| **The canon is read in full** | Replace `RULES.md` content with a pointer to itself |

If a check fails: **stop**. Fix it. Do not stub your way to green.

Software long form: `software/RULES.md`, `doctrine/`, `software/docs/PERIMETERS.md`.
