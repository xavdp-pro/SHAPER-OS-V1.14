# Orchestrator Agent Architecture + Task Queue

Infrastructure reflection document — Helm/KovZu.  
**Status**: design (not yet implemented in database).

---

## Intent

Separate two roles:

| Role | Talks to Human | Executes Code / CLI |
|------|----------------|---------------------|
| **Orchestrator** | Yes — dialogue, decisions, reformulation | No (or very little) |
| **CLI Worker** | No | Yes — one task at a time |

The orchestrator does not do everything: it understands, breaks down, queues, and reports back when the worker has finished.

---

## 3-Layer Model

```
┌─────────────────────────────────────────────────────────┐
│  Conversation Layer                                     │
│  Human (voice/chat) ↔ Orchestrator agent                │
└───────────────────────────┬─────────────────────────────┘
                            │ creates task / reads result
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Queue Layer                                            │
│  agent_tasks (MariaDB) → Worker / Cursor CLI            │
└───────────────────────────┬─────────────────────────────┘
                            │ reads snapshot / writes result
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Memory Layer                                           │
│  user briefing · agent_memory · session summaries       │
└─────────────────────────────────────────────────────────┘
```

---

## What Helm Already Has

| Element | Role |
|---------|------|
| `users.briefing` | Presentation + permanent operator guidelines |
| `sessionPrime` | Injected at CLI session startup |
| 1 conversation = 1 `chat_id` | Worker conversational memory (bridge `--resume`) |
| Bridge | 1 active agent per conversation; new message replaces current agent |

This covers the **operator profile**, but not yet a **task queue** nor **shared project memory**.

---

## Proposed MariaDB Tables

### `agent_tasks` — Work Queue

```sql
CREATE TABLE agent_tasks (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  conversation_id VARCHAR(255) NOT NULL COMMENT 'Helm conversation (orchestrator or worker)',
  status          ENUM('pending','running','done','failed','cancelled') NOT NULL DEFAULT 'pending',
  priority        INT NOT NULL DEFAULT 0,
  title           VARCHAR(500) NOT NULL,
  prompt          TEXT NOT NULL COMMENT 'Autonomous instruction for the worker',
  context_json    JSON NULL COMMENT 'Snapshot injected at launch',
  result_json     JSON NULL COMMENT 'Structured worker output',
  chat_id         VARCHAR(64) NULL COMMENT 'Worker Cursor thread (optional, per task)',
  worktree        VARCHAR(255) NULL COMMENT 'Git isolation if editing files',
  error_message   TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at      DATETIME NULL,
  finished_at     DATETIME NULL,
  INDEX idx_status_priority (status, priority, created_at),
  INDEX idx_user (user_id)
);
```

### `agent_memory` — Durable Memory ("Cultivated Context")

```sql
CREATE TABLE agent_memory (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  scope           ENUM('user','project','client') NOT NULL DEFAULT 'user',
  memory_key      VARCHAR(128) NOT NULL,
  content         TEXT NOT NULL,
  source_task_id  BIGINT UNSIGNED NULL,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_scope_key (user_id, scope, memory_key)
);
```

### `agent_session_summaries` — Optional

```sql
CREATE TABLE agent_session_summaries (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id VARCHAR(255) NOT NULL,
  summary         TEXT NOT NULL,
  token_estimate  INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conv (conversation_id, created_at)
);
```

---

## The 4 Context Levels

From most stable to most volatile:

| Level | Content | Storage | Injection |
|-------|---------|---------|-----------|
| **1. Permanent** | Who the human is, rules, stack, tone | `users.briefing` + `.cursor/rules` | Always (prime + each task) |
| **2. Project** | Architecture, decisions, conventions | `agent_memory` scope `project` | Code-related tasks |
| **3. Session** | Recent discussion thread | `chat_id` orchestrator | Human dialogue |
| **4. Task** | Precise objective + targeted files | `agent_tasks.prompt` + `context_json` | Single worker execution |

**Golden rule**: general context lives in **database**, not in implicit memory of a parallel agent.

---

## Context Cultivation Cycle

1. **Human speaks** → orchestrator listens (its own `chat_id`, lightweight).
2. **Decision** → "this is a code task" → `INSERT agent_tasks` with an **autonomous** `prompt` (worker should not guess).
3. **Worker starts** with:
   - user briefing;
   - relevant excerpt from `agent_memory` (not all);
   - task prompt;
   - `--worktree` if editing files.
4. **Task completion** → worker writes `result_json`.
5. **Orchestrator** reads result, replies to human in natural language.
6. **Memory update** (optional): if durable decision → upsert into `agent_memory`.

Example:

```
Human: "For Dupont, always check intra-EU VAT"
  → orchestrator: INSERT agent_memory (scope=client, key=client_dupont, content=...)
  → later, Dupont CRM task: context_json includes this memory
```

---

## Preparing Context for a Worker Task

Each task must be **self-sufficient**. Example `context_json`:

```json
{
  "briefing_excerpt": "Operator: Xavier, stack Node+MariaDB…",
  "memories": [
    { "key": "client_dupont", "content": "Always check intra-EU VAT" }
  ],
  "workspace": "/apps/helm-v1/app",
  "files_hint": ["server/lib/db.js", "server/routes/"],
  "constraints": ["mysql2 only", "no alert/confirm", "French UI"]
}
```

Worker prompt assembled server-side:

```text
[PERMANENT CONTEXT]
{briefing + selected memories}

[TASK]
{title}
{detailed prompt}

[CONSTRAINTS]
{constraints}

[EXPECTED RESULT]
Reply in JSON: { summary, files_changed, blockers }
```

The worker does **not need** the full voice transcript — only this snapshot.

---

## Queue: Processing Tasks

```
pending → (worker free?) → running → done | failed
               ↓ no
          remains pending (FIFO or priority)
```

- **1 active worker per conversation** (like bridge today).
- Parallelism = multiple `conversation_id` or worktrees, **not** the same `chat_id`.
- Orchestrator can enqueue N tasks; worker processes them one by one.

---

## Cursor CLI — Documentation Reminders

| Need | Cursor Mechanism |
|------|------------------|
| Resume thread | `--resume <chatId>` / `agent resume` |
| Parallel without git conflict | `--worktree [name]` |
| Conversation branch | `/fork` (interactive CLI) |
| Shared memory between parallel agents | **No** — each session has its own thread |

Ref.: [Using Agent in CLI](https://cursor.com/docs/cli/using), [Parameters](https://cursor.com/docs/cli/reference/parameters).

---

## Pitfalls to Avoid

| Pitfall | Why | Alternative |
|---------|-----|-------------|
| Single agent for everything | Saturated context, mixed dialogue + code | Orchestrator + workers |
| Sharing `chat_id` between parallel tasks | No live shared memory | 1 `chat_id` per thread |
| Injecting everything on each task | Exploded context window | Targeted selection from `agent_memory` |
| Relying on CLI to remember | Session tied to workspace, limited | DB = source of truth |

---

## Pragmatic Path for Helm

### Phase 1 — Minimal

- `agent_tasks` table alone.
- Orchestrator = current conversation (human).
- Worker = existing CLI inject; 1 task = 1 inject with briefing + structured prompt.

### Phase 2

- `agent_memory` table + admin screen to edit.
- Auto-summary at end of long session → `agent_session_summaries`.

### Phase 3

- Worktrees for parallel tasks.
- Priorities, cancellation, voice notification when `done`.

---

## Planned API (Outline)

| Method | Route | Role |
|--------|-------|------|
| `POST` | `/api/tasks` | Orchestrator creates task |
| `GET` | `/api/tasks` | List (status, user filters) |
| `GET` | `/api/tasks/:id` | Detail + result |
| `POST` | `/api/tasks/:id/cancel` | Cancellation |
| `POST` | `/api/tasks/dispatch` | Worker loop: picks next `pending` |
| `GET/PATCH` | `/api/memory` | CRUD `agent_memory` |

Worker loop (process or light cron):

1. `SELECT … FROM agent_tasks WHERE status='pending' ORDER BY priority DESC, created_at LIMIT 1 FOR UPDATE`
2. `status='running'`, assemble prompt, inject bridge.
3. At SSE `response_complete` → `status='done'`, `result_json=…`.

---

## Summary

- The human-facing agent **cultivates** context by writing to database (briefing + memory + well-crafted tasks).
- Workers **consume** short snapshots at each execution.
- The **DB** is durable memory; Cursor `chat_id` is only a **working session**, not the archive.
