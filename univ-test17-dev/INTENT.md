# Universe: univX — Template

> **Intent Classification**: SPECIFIC INTENT (Universe: univX)

## 1. Declarative Objective

<One sentence: what this universe demonstrates or runs in production.>

## 2. Invariants

1. <Security or sovereignty rule>
2. <Cadence / logging rule>
3. <Secret handling rule>
4. <Test / PRA rule>

## 3. Document map

| File | Role |
| :--- | :--- |
| `INTENT.md` | This file — law for the universe |
| `manifest.json` | Machine-readable brick graph + specialize paths |
| `AGENT-DEPLOY.md` | What the deploy agent may do autonomously |
| `context/AGENT-CONTEXT.md` | Business context for runtime AI at beat time |

Deploy agent: read files in order **INTENT → manifest → AGENT-DEPLOY**.
