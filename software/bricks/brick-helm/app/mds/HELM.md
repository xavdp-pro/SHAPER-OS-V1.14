# Helm-v1 — infra sheet

> **Full context for agents:** [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md)  
> **Vision / roadmap:** [`VISION.md`](./VISION.md)  
> **Users / auth:** [`AUTH-USERS.md`](./AUTH-USERS.md)

## In one page

| | |
|---|---|
| Product | **Helm** — control deck |
| Origin | Fork of **cursorauto-v1** (<OTHER_PUBLIC_HOST> remains separate) |
| Server | gbs-h1 |
| tb App | `/apps/helm-v1/` (noweb + MariaDB) |
| URL | https://<PUBLIC_HOST> |
| Vite / API | `:7823` / `:7826` |
| DB | MariaDB `helm-v1` — passwd `/apps/helm-v1/etc/mysql/localhost/passwd` |
| Asus Source | `~/Bureau/NOW3/mds/helm-v1` |
| Admin users | `/admin/users` |
| Current login | `APP_PASSWORD` (global) — magic links later |

## PM2

- `helm-vite` — front HMR
- `helm-api` — Express

## Cursor Workspace

Add: `/home/zaza/Bureau/NOW3/mds/helm-v1`  
The rest of the POC happens **here**, not in cursorauto.
