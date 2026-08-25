# turbinobash — Agent Bootstrap (Generic)

> **Mirror copy** automatically injected into Cursor via `.cursor/rules/turbinobash-ecosystem.mdc` (`alwaysApply: true`).
> This file remains the readable reference in helm mds and on gbs-h1.
>
> Reference installation: **gbs-h1** — `/var/lib/turbinobash-web` (already active, do not re-clone inside `mds/`).

---

## Canonical Sources (Server)

| Doc | Path on gbs-h1 |
|-----|----------------|
| Daily ops | `/var/lib/turbinobash-web/README.md` |
| Framework `tb` | `/var/lib/turbinobash-web/docs/FRAMEWORK.md` |
| Upstream repo | https://github.com/xavdp-pro/turbinobash-web |

```bash
ssh gbs-h1 'less /var/lib/turbinobash-web/README.md'
ssh gbs-h1 'less /var/lib/turbinobash-web/docs/FRAMEWORK.md'
```

On gbs-h1: `/conf/mode` = active hosting profile (`nginx`, `apache`, `hybrid`, `proxy`, `noweb`).

---

## Principle: One `{mon-app}` Variable Everywhere

When turbinobash creates an app like **`helm-v1`**, **the exact same identifier** is used everywhere:

| Element | Value | Example `helm-v1` |
|---------|-------|-------------------|
| Turbinobash app name | `{mon-app}` | `helm-v1` |
| Unix user | `{mon-app}` | `helm-v1` |
| MariaDB database | `{mon-app}` | `helm-v1` |
| MariaDB user | `{mon-app}` | `helm-v1` |
| File root | `/apps/{mon-app}/` | `/apps/helm-v1/` |
| Source code | `/apps/{mon-app}/app` | `/apps/helm-v1/app` |
| DB password | `/apps/{mon-app}/etc/mysql/localhost/passwd` | existing file |

**One name everywhere** — this is the turbinobash convention. No divergence without an explicit migration.

### Standard Hierarchy `/apps/{mon-app}/`

```
/apps/{mon-app}/
├── app/              # Code (git) — Development CWD
│   └── webroot/      # Document root (if web profile)
├── etc/
│   ├── mysql/localhost/passwd   # DB password (do not commit)
│   ├── php/version              # PHP version (if applicable)
│   └── ssh/passwd               # App SSH password (if applicable)
├── log/
├── sav/              # Generated persistent files (outside git)
├── tmp/
│   └── sessions/     # PHP sessions (writable by app user)
└── nosav/            # Cache / large files — **excluded from backups**
```

---

## `tb` Command

```text
tb <module> <script-path> [arguments…] [--options]
```

| Command | Role |
|---------|------|
| `tb app sudo/create {mon-app}-v1 --certbot` | Create app + user + DB + vhost + SSL |
| `tb app sudo/bulldozer {mon-app}-v1` | Fix file ownership/permissions (app user) |
| `tb app sudo/backup {mon-app}-v1` | Backup files + DB |
| `tb app sudo/remove {mon-app}-v1` | Remove app |
| `tb app sudo/way/proxy/create {app} http://127.0.0.1:PORT --certbot` | Reverse proxy |
| `tb app sudo/way/noweb/create {app}` | App without vhost (Node, cron, API) |
| `tb mysql sudo/db/dump {mon-app}-v1` | SQL Dump |

Discovery: type `tb app` then TAB TAB.

System backups: `/var/sav1/<hostname>/` (`auto/`, `manual/`).

---

## `{mon-app}` Rule in Code

> **`{mon-app}` must NEVER be hardcoded** — infer it from the `/apps/{mon-app}/...` path at runtime.

**Node.js:**
```js
const monApp = process.cwd().match(/\/apps\/([^/]+)/)?.[1]
  || __dirname.match(/\/apps\/([^/]+)/)?.[1];
```

**Bash:**
```bash
MON_APP=$(realpath "$PWD" | grep -oP '(?<=/apps/)[^/]+')
PASSWD_FILE="/apps/${MON_APP}/etc/mysql/localhost/passwd"
```

**PHP (WordPress):**
```php
define('DB_NAME', $_SERVER['USER']);
define('DB_USER', $_SERVER['USER']);
define('DB_PASSWORD', trim(file_get_contents("/apps/{$_SERVER['USER']}/etc/mysql/localhost/passwd")));
define('DB_HOST', 'localhost');
```

---

## Database — Agent Rules

| Rule | Detail |
|------|--------|
| DB already exists | Do not `CREATE DATABASE` |
| User already exists | Do not recreate MySQL user |
| Password | Read `/apps/{mon-app}/etc/mysql/localhost/passwd` — **never hardcoded in code** |
| Application code | **`mysql2` only** (Node) — no `mysql -e` in code |
| Shell diagnostics | `mysql {mon-app}` or `tb mysql` — outside code only |
| Transactions / FK | No transactions or application-level FKs (project convention) |

---

## Typical Deployment (Node / PM2 App)

```bash
# On server (e.g. gbs-h1), root or tb user
cd /apps/{mon-app}/app
npm install
npm run build          # if frontend
# PM2 under {mon-app} user — PM2_HOME=/apps/{mon-app}/.pm2
tb app sudo/bulldozer {mon-app}
```

From Asus (if rsync configured):
```bash
cd ~/Bureau/NOW3/mds/{projet}
npm run sync:h1        # or rsync to /apps/{mon-app}/app
```

---

## Apps on gbs-h1 (Reference)

| App | Code Root | Profile |
|-----|-----------|---------|
| helm-v1 | `/apps/helm-v1/app` | noweb + MariaDB |
| cursorauto-v1 | `/apps/cursorauto-v1/app` | noweb |
| freetier-v1 | `/apps/freetier-v1/app` | web |
| sciento-v1 | `/apps/sciento-v1/app` | web |
| crmdemo-v1 | `/apps/crmdemo-v1/app` | web |

Each app may have its **specific** `mds/rules-ia.md` or `mds/rules.md` — this file remains the **generic turbinobash bootstrap**.

---

## `rules` Files by App (Existing Templates)

On gbs-h1, draw inspiration from:

| App | File |
|-----|------|
| helm-v1 | `/apps/helm-v1/app/mds/rules.md` |
| sciento-v1 | `/apps/sciento-v1/app/mds/rules-ia.md` |
| crmdemo-v1 | `/apps/crmdemo-v1/app/mds/rules-ia.md` |

Recommended structure for **any new app**:

```
/apps/{mon-app}/app/mds/
├── rules-ia.md           # Agent rules (this bootstrap + app specific)
├── AGENT-CONTEXT.md      # Identity, ports, URLs, stack
└── stack.md              # Detailed infrastructure
```

---

## Agent Behavior

1. **Read this file** + `rules-ia.md` of target app before acting.
2. **Do not improvise** outside `/apps/{mon-app}/` and `tb` conventions.
3. Human chat: **French** (spoken with maintainer) — code / comments / docs: **English**.
4. **Zero fake** — real data and real behaviors only.
5. **Commit** allowed permanently — no need to ask (never secrets).
6. **Do not re-clone** turbinobash-web inside `mds/` — the reference is `/var/lib/turbinobash-web` on the server.

---

## Helm-v1 (Concrete Example)

| | |
|---|---|
| `{mon-app}` | `helm-v1` |
| URL | https://<PUBLIC_HOST> |
| Code | `/apps/helm-v1/app` |
| Asus Source | `/home/zaza/Bureau/NOW3/mds/helm-v1` |
| PM2 | `helm-api` :7826, `helm-vite` :7823 |

See also: [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md), [`rules.md`](./rules.md) (Helm specific).
