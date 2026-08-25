# Helm-v1 — fiche infra

> **Contexte complet pour les agents :** [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md)  
> **Vision / roadmap :** [`VISION.md`](./VISION.md)  
> **Users / auth :** [`AUTH-USERS.md`](./AUTH-USERS.md)

## En une page

| | |
|---|---|
| Produit | **Helm** — poste de commande |
| Origine | Fork de **cursorauto-v1** (<OTHER_PUBLIC_HOST> reste séparé) |
| Serveur | gbs-h1 |
| App tb | `/apps/helm-v1/` (noweb + MariaDB) |
| URL | https://<PUBLIC_HOST> |
| Vite / API | `:7823` / `:7826` |
| DB | MariaDB `helm-v1` — passwd `/apps/helm-v1/etc/mysql/localhost/passwd` |
| Source Asus | `~/Bureau/NOW3/mds/helm-v1` |
| Admin users | `/admin/users` |
| Login actuel | `APP_PASSWORD` (global) — magic links plus tard |

## PM2

- `helm-vite` — front HMR
- `helm-api` — Express

## Workspace Cursor

Ajouter : `/home/zaza/Bureau/NOW3/mds/helm-v1`  
La suite du POC se fait **ici**, pas dans cursorauto.
