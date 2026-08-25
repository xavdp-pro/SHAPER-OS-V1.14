# Agent — Helm UI Development
 
**Read first:** [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md)
 
You work **in this repository** (`mds/helm-v1`) for https://<PUBLIC_HOST>.
 
## UI Stack
 
| Element | Path |
|---------|------|
| Routes | `src/App.jsx` |
| Console | `src/pages/Dashboard.jsx` |
| Admin users | `src/pages/AdminUsers.jsx` |
| Login | `src/pages/Login.jsx` |
| Sticky chat input | `src/components/ChatInput.jsx` |
| Timeline | `src/components/RunTimeline.jsx` |
| SSE Stream | `src/lib/runStream.js` |
| API client | `src/api/client.js` |
| Bridge proxy | `server/lib/bridgeClient.js` |
| Users DB | `server/lib/db.js`, `usersStore.js` |
 
## Rules
 
Full details: [`rules.md`](./rules.md) (MariaDB, secrets, ports).
 
- Code / comments: **English** — chat: **French**
- No `alert()` / `confirm()` / `prompt()` — React modals / toasts
- Conversation paths: `machine/user/name`
- Fetch via `src/api/client.js` only
- MariaDB: **mysql2** only (`server/lib/db.js`) — no `mysql -e` in code
- Zero fake / zero invented fallback
- Styles: Tailwind + existing classes (`glass`, `zone-sunk`, `btn-*`)
 
## Deployment
 
```bash
cd ~/Bureau/NOW3/mds/helm-v1
npm run sync:h1       # rsync → /apps/helm-v1/app
npm run deploy:dev    # sync + PM2 HMR
npm run deploy:prod   # build + preview
```
 
Health: `curl -s http://127.0.0.1:7826/api/health` (on h1)
 
## CLI Session
 
- Conversation: `Interface` → `gbs-h1/helm-v1/Interface`
- Workspace h1: `/apps/helm-v1/app`
- Bridge: `:4200`
