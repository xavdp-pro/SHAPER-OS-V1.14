# Orchestrator — Queue + Scheduling + Auto-correction (Plan)

> **Architecture plan** (July 23, 2026). Code will follow. Deliberate record
> of the whole dynamic architecture (Xavier's request).
> turbinobash app created: **`kovzu-orchestrator-v1`** (noweb profile + MariaDB).
> See also [`DYNAMIC-ORCHESTRATION.md`](./DYNAMIC-ORCHESTRATION.md),
> [`SHAPER-CONCRETION.md`](./SHAPER-CONCRETION.md).

## Goal

An engine that **queues, schedules, and dispatches tasks to cursor-agent CLI
agents across infrastructure**, collects **full feedback**, and
**self-corrects** to **never make the same mistake twice**. Driven by the master
agent OR by a human. **Multidimensional and adaptive**; the end user only sees
that "it works" (the rabona: the difficult move made simple and elegant).

## Location

- App: `/apps/kovzu-orchestrator-v1/app` (user + MariaDB DB `kovzu-orchestrator-v1`).
- **Noweb** profile: it is a background service (no vhost). Driven by KovZu
  (helm-v2) via an internal API + shared with the master agent.

## Components

1. **Queue** — table of tasks to perform (mission, target, schedule, priority,
   context, attempts, status).
2. **Scheduler** — triggers tasks: `cron` / `systemd` timer / **in-house loop**
   (event-driven, backoff, dependencies). Fixed time AND on change.
3. **Dispatcher** — launches cursor CLI agent on the **right machine**:
   - via the target machine's **bridge API** (**VPN WireGuard IP + token**),
     `POST /api/inject` with message/mission + workspace,
   - **or** via SSH (`~/.ssh/config`: user + path) if no bridge.
   - Target described by **machine / user / path (workspace)** — the
     KovZu convention (`node/user/conversation`).
4. **Feedback collector** — agent returns a **complete report**: did it succeed
   **autonomously**? errors encountered, what was done, produced artifacts.
   Stored per run (via bridge SSE + a structured final report).
5. **Planner agent (master)** — reads reports:
   - autonomous & OK → task done;
   - failure/anomaly → planner **reconnects** to **identify and fix**
     the problem (context, task, or what the agent did), reruns,
   - then **writes a lesson** so the same mistake is never repeated.
6. **Lessons store** — knowledge base of errors→fixes, **re-injected
   into context** of subsequent tasks (learning). This is the core
   "never the same mistake again".

## Data Model (MariaDB, to be created)

| Table | Role |
|-------|------|
| `tasks` | id, mission, target_node, target_user, target_path, model_tier, schedule (cron/at/event), priority, context (JSON), status, attempts, max_attempts, created_by (agent\|human), created_at |
| `runs` | id, task_id, started_at, ended_at, transport (bridge\|ssh), run_id bridge, autonomous (bool), success (bool), report (TEXT), error (TEXT) |
| `lessons` | id, signature (normalized error), context_hint, fix, task_kind, created_at — re-injected into next context |
| `schedules` | id, task_id, kind (cron\|timer\|event), spec, next_run_at, active |

## Complete Flow

```
Human / Master Agent
        │  creates/schedules a task (mission + target + context + schedule)
        ▼
     [Queue] ──(scheduler: time or event)──► [Dispatcher]
        │                                              │ bridge API (VPN IP+token) or ssh
        │                                              ▼
        │                                   cursor-agent CLI (target machine, workspace)
        │                                              │ executes mission
        │                                              ▼
        │                                   [Feedback] full report (autonomous? errors? artifacts)
        ▼                                              │
   [Planner agent] ◄────────────────────────────────┘
        │  autonomous OK → done
        │  otherwise → reconnects, fixes (context/task), reruns
        ▼
   [Lessons] ──► re-injected into context of subsequent tasks
```

## Transport (Launching Remote Agent)

- **Bridge (preferred)**: each machine exposes a cursor-agent-bridge on its
  **VPN IP** (WireGuard) with a **token**. Dispatcher performs `POST /api/inject`
  (mission) and listens to `/api/events` (real-time feedback + run_id).
- **SSH (fallback)**: `~/.ssh/config` provides user + host; launch/rerun agent
  in the desired **path (workspace)**.
- Target = **machine / user / path** — never hardcoded URLs; resolved at
  runtime (turbinobash convention `{mon-app}` + KovZu `node/user/conversation`).

## Routing & Control

- **Model routing** per task: lightweight (model + code) vs heavy artillery
  (full Cursor CLI agent). Chosen according to complexity.
- **Pilot**: master agent (auto-scheduling) **or** a human (KovZu UI).
- Master agent can **create a subordinate agent** (dedicated tb workspace) with
  **context it chooses**, and assign it a queue mission.

## KovZu Integration

- KovZu (helm-v2) = **cockpit**: create/schedule tasks, view queue,
  runs, feedback, lessons — in natural language / voice. End user only
  sees the result ("it works").
- Orchestrator = **engine**; bridge (per machine, VPN) = **transport**.

## Remaining Implementation (Phases)

1. MariaDB schema (`tasks/runs/lessons/schedules`) + `db.js` (mysql2).
2. Bridge dispatcher (VPN IP + token) + SSH fallback + SSE collection → `runs`.
3. Scheduler (in-house loop + cron/systemd option).
4. Planner agent: feedback reading, auto-correction loop, writing
   `lessons`, re-injecting into context.
5. Internal API + KovZu UI (queue, runs, lessons) + creation/scheduling by voice.
6. Security: isolation per machine/user, guardrails on sensitive actions.
