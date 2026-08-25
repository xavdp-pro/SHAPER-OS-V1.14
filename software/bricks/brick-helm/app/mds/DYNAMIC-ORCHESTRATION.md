# Dynamic Orchestration — Master Agent, Subordinate Agents, Scheduling

Vision note (July 23, 2026). **Common thread since the beginning of discussion:
these mechanics must live in the Cursor CONTEXT** (injected at prime +
recalled), not only in code. Encoded in `server/lib/agentSkills.js`.

## Philosophy: Total Dynamism

Xavier programs in **total abstraction and dynamism** — metaphor: "like a
PHP where the language writes itself". What we are building is **very dynamic**:
the system shapes itself, agents are created and configured according to
needs. This is not frozen software, it is a living foundation.

## 1. Master Agent → Subordinate Agents

The Cursor agent is **master**. Sometimes it is necessary for it to **install and
launch a subordinate Cursor CLI agent** — on a turbinobash workspace
(`tb app sudo/way/noweb/create …`) or another machine — **with a context that
the master chooses itself** for this agent, then delegates a mission to it.

→ An agent can therefore spawn others, each with its own mission context.
Agent tree, not a single agent.

## 2. Scheduling (Time + Events)

For an agent to act **at a fixed time** or **when something changes**, the
master sets up appropriate scheduling:
- `cron` (system), `systemd` (timer/service),
- or an **in-house cron** (application loop/scheduler) when more flexibility is needed
  (event trigger, backoff, dependencies).

Examples: monitor a mailbox and act, generate a report every Monday,
retry a task until a condition is met.

## 3. Model Routing (Just Enough Artillery)

Determine, **per task**, the right level of artillery:
- **Simple / fast / repetitive task** → a **lightweight model plugged into code**
  (inexpensive, deterministic).
- **Complex / open-ended task** → **heavy artillery = full Cursor CLI agent**
  (reasoning, tools, iteration).

The choice is made according to actual need, never "large model by default".
This is what makes the whole system economical AND powerful.

## 4. Reborn = Restart Fresh with Chosen Context (NOT from Scratch)

"Cursor Context" = the file/mechanism that Cursor uses to keep
session history. **Reborn**:
1. **empties** timeline / session history,
2. **reloads the chosen CONTEXT** (briefing + skills + mission),
3. the agent **restarts fresh on the right mission** — with fundamentals, not amnesiac.

This mechanism must be **clean and clearly explained in the agent's context**
(it must know how it works, and be able to explain it). It is also the one
reused when the master **chooses the context** of a subordinate agent
it creates.

## Agent Powers (non-sudo in app, but root on host) — VERY IMPORTANT

The agent is **NOT sudo in the app** (it runs as application user, preserving isolation).
**BUT** it has the ability to **connect via SSH (key) to the container HOST as root**,
to **remote control and shape its universe/container** as much as necessary.
Goal: give it **free hands to act in all circumstances** and reshape the container
(resources, config, network, services) without ever breaking app isolation.

- In app: application user, no sudo.
- To host: **`ssh root@localhost`** → connects to container HOST and obtains
  root → total container control (resources, config, network, services).
- This is the lever making infra remote control truly powerful:
  the agent must be able to **control the universe to which it is given access**.

(Encoded in context, `server/lib/agentSkills.js`.)

## Summary

KovZu does not orchestrate a single agent, but a **dynamic agent ecology**: a
master creating contextualized subordinates, scheduling their actions over
time, routing each task to the right model tier, and regenerating via reborn
on a chosen context. **The system shapes itself** — this is the dynamic
heart of Shaper made real. See [`SHAPER-CONCRETION.md`](./SHAPER-CONCRETION.md).
