# Helm — environment rules

> See also [`TURBINOBASH-BOOTSTRAP.md`](./TURBINOBASH-BOOTSTRAP.md) (`{mon-app}` convention — **mandatory**), [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md), [`AUTH-USERS.md`](./AUTH-USERS.md), [`VISION.md`](./VISION.md).

Document for agents: **how to behave** in Helm (gbs-h1), especially around MariaDB and code.

---

## Before implementing

1. Read [`TURBINOBASH-BOOTSTRAP.md`](./TURBINOBASH-BOOTSTRAP.md) (generic turbinobash — active install on gbs-h1 `/var/lib/turbinobash-web`)
2. Read [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md) (Helm source of truth)
3. Read [`VISION.md`](./VISION.md) (roadmap)
4. If auth / users → [`AUTH-USERS.md`](./AUTH-USERS.md)
5. Apply **this file** for runtime behavior

Human chat: **French**. Code / comments: **English**.

---

## Identity & Perimeter

| | |
|---|---|
| Product | **KovZu** — https://<PUBLIC_HOST> |
| Server | **gbs-h1** — code `/apps/helm-v1/app` |
| tb App | `/apps/helm-v1/` (noweb + MariaDB) — `{mon-app}` = `helm-v1` |
| Fork of | cursorauto — **do not modify** unless explicitly requested |
| Docker / packaging | **Later** — not now |

---

## Code / UI Rules

| Rule | Detail |
|------|--------|
| Zero fake | No invented data, no fallback "just to make it work" |
| Dialogs | No `alert()` / `confirm()` / `prompt()` — React modals / toasts |
| Frontend HTTP | Only via `src/api/client.js` (no `fetch` inside components) |
| Styles | Existing classes: `glass`, `input-field`, `btn-*`, `zone-sunk` |
| Git | Commit **permanently authorized** — no need to ask |
| Secrets | Never commit `.env`, tokens, `etc/mysql/`, `HUME_*` |

---

## MariaDB — Guidelines (mandatory)

Turbinobash app **helm-v1**: Unix / MySQL user = `helm-v1`, database = `helm-v1`.

### Access

| Element | Value |
|---------|-------|
| Host | `127.0.0.1` (default) |
| Port | `3306` |
| User | `helm-v1` |
| Database | `helm-v1` |
| Password | file `/apps/helm-v1/etc/mysql/localhost/passwd` |
| Env override | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_PASSWD_FILE` |

The code reads the passwd via `server/lib/db.js` (`mysqlConfig()` → `mysql2/promise` pool).

### Forbidden

- **No** `mysql -e`, `mariadb -e`, nor SQL shell in application code
- **No** client other than **`mysql2`** (Node package)
- **No** hardcoded password in repository
- **No** committing the `etc/mysql/.../passwd` file

### Mandatory in code

| Action | Where / how |
|--------|-------------|
| Connection | `getPool()` / `query()` from `server/lib/db.js` |
| Users schema | `ensureUsersSchema()` (CREATE IF NOT EXISTS + seed if empty) |
| Users CRUD | `server/lib/usersStore.js` — no ad hoc SQL in UI routes |
| Queries | Parameterized SQL (`execute` / `query(sql, params)`) — never concatenate inputs |
| Existing schema | Do not break reserved columns (magic link, `password_hash`) without explicit migration |

### Diagnostics (shell, outside code)

On h1 only, for verification — **do not** make it an application pattern:

```bash
# API Health (preferred)
curl -s http://127.0.0.1:7826/api/health

# Password (do not display in chat / commits)
PASS=$(cat /apps/helm-v1/etc/mysql/localhost/passwd)
# mysql -u helm-v1 -p"$PASS" helm-v1   # manual inspection only
```

---

## Ports & processes (do not confuse with cursorauto)

| Service | PM2 | Port |
|---------|-----|------|
| Vite HMR | `helm-vite` | **7823** |
| Express API | `helm-api` | **7826** |
| CLI Bridge | (separate) | **4200** |

cursorauto = **7623** / **7626** / <OTHER_PUBLIC_HOST> — out of scope.

---

## Helm Voice

| Element | Rule |
|---------|------|
| TTS | **Cartesia Sonic** or **Deepgram Aura** (`TTS_PROVIDER`) — WS stream `/api/voice/tts-stream` |
| STT | **Deepgram** Nova live WS (`DEEPGRAM_API_KEY`, `DEEPGRAM_STT_MODEL=nova-3`) |
| Emotions | Sonic tags `[calm]`, `[excited]`, … → `generation_config.emotion` |
| Cursor Agent | inject directive via `applyCursorLanguage` (Sonic tags if Cartesia) |
| Admin | https://<PUBLIC_HOST>/admin/voices — free FR/ES/EN catalog |

---

## Auth (current state)

| Layer | Rule |
|-------|------|
| Login | User auth (email + bcrypt) — no `APP_PASSWORD` |
| JWT | Cookie `ca_token` (`sub`, `email`, `name`, `role`) |
| Database users | Real admin CRUD — see [`AUTH-USERS.md`](./AUTH-USERS.md) |
| Next | Magic links + roles on admin routes — **to do** |

---

## Priority Next Steps

Email/password auth (+ magic links later) → mobile voice → desktop WebSocket → CRM POC → Docker (later).
