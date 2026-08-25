# Agent — développement Helm UI

**Lire d’abord :** [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md)

Tu travailles **dans ce dépôt** (`mds/helm-v1`) pour https://<PUBLIC_HOST>.

## Stack UI

| Élément | Chemin |
|---------|--------|
| Routes | `src/App.jsx` |
| Console | `src/pages/Dashboard.jsx` |
| Admin users | `src/pages/AdminUsers.jsx` |
| Login | `src/pages/Login.jsx` |
| Chat input sticky | `src/components/ChatInput.jsx` |
| Timeline | `src/components/RunTimeline.jsx` |
| Stream SSE | `src/lib/runStream.js` |
| API client | `src/api/client.js` |
| Bridge proxy | `server/lib/bridgeClient.js` |
| Users DB | `server/lib/db.js`, `usersStore.js` |

## Règles

Détail complet : [`regles.md`](./mds/rules.md) (MariaDB, secrets, ports).

- Code / commentaires : **anglais** — chat : **français**
- Pas `alert()` / `confirm()` / `prompt()` — modales React / toasts
- Chemins conversation : `machine/user/nom`
- Fetch via `src/api/client.js` uniquement
- MariaDB : **mysql2** uniquement (`server/lib/db.js`) — pas de `mysql -e` dans le code
- Zero fake / zero fallback inventé
- Styles : Tailwind + classes existantes (`glass`, `zone-sunk`, `btn-*`)

## Déploiement

```bash
cd ~/Bureau/NOW3/mds/helm-v1
npm run sync:h1       # rsync → /apps/helm-v1/app
npm run deploy:dev    # sync + PM2 HMR
npm run deploy:prod   # build + preview
```

Health : `curl -s http://127.0.0.1:7826/api/health` (sur h1)

## Session CLI

- Conversation : `Interface` → `gbs-h1/helm-v1/Interface`
- Workspace h1 : `/apps/helm-v1/app`
- Bridge : `:4200`
