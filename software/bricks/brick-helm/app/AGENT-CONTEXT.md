# Helm-v1 — contexte agent (source de vérité)

**Lire ce fichier en premier** avant toute implémentation sur Helm.
Chat humain : **français**. Code / commentaires : **anglais**.

---

## Identité

| Élément | Valeur |
|---------|--------|
| Produit | **Helm** — poste de commande (gouvernail) |
| App turbinobash | `helm-v1` (profil **noweb** + MariaDB) |
| Serveur | **gbs-h1** |
| Racine h1 | `/apps/helm-v1/` |
| Code | `/apps/helm-v1/app` |
| Source Asus | `/home/zaza/Bureau/NOW3/mds/helm-v1` |
| URL | **https://<PUBLIC_HOST>** |
| User Unix / MySQL | `helm-v1` |
| Passwd DB | `/apps/helm-v1/etc/mysql/localhost/passwd` |

### Origine

Fork de **cursorauto-v1** (console web Cursor).  
cursorauto **reste actif** et séparé : https://<OTHER_PUBLIC_HOST> — **ne pas fusionner** sans demande.

---

## Vision produit (suite)

Helm = **tu gouvernes** ; desktop affiche ; Cursor construit.

1. **Core (fait)** — console web Cursor (timeline, stream, bridge CLI)
2. **Users (en cours)** — table MariaDB + admin CRUD ; login encore = `APP_PASSWORD`
3. **Auth réelle (à faire)** — users démo + **magic links** (colonnes déjà en BDD)
4. **Voix** — micro surtout sur **mobile** ; desktop = écran
5. **WebSocket** — mobile pilote le desktop (« montre les mails », « graphique factures »)
6. **POC CRM** — première app métier ; si récurrent → Cursor code la page, puis commande d’affichage
7. **Docker / packaging** — **plus tard**, pas maintenant

Voix émotionnelle (hors scope immédiat) : Hume EVI ou ElevenLabs v3 + tags `[sighs]` etc.

---

## Ports & process (gbs-h1)

| Service | PM2 | Port |
|---------|-----|------|
| Vite HMR | `helm-vite` | **7823** |
| Express API | `helm-api` | **7826** |
| cursor-agent-bridge | (séparé) | **4200** |

Tunnel Cloudflare : `<PUBLIC_HOST>` → `http://localhost:7823` (même tunnel h1 que <OTHER_PUBLIC_HOST>).

cursorauto (ne pas toucher) : Vite **7623**, API **7626**, URL <OTHER_PUBLIC_HOST>.

---

## Stack technique

```
Navigateur → <PUBLIC_HOST> → Vite :7823 + proxy /api → API :7826
                                                    → bridge :4200 → cursor-agent CLI
                                                    → MariaDB helm-v1
```

| Zone | Tech |
|------|------|
| Front | React + Vite + Tailwind v4 |
| Back | Express 5, JWT cookie `ca_token` |
| DB | **mysql2** uniquement (pas `mysql -e` dans le code) |
| Timelines | fichiers JSON `data/timelines/` (pas encore en SQL) |
| Deploy | `npm run sync:h1` / `deploy:dev` / `deploy:prod` |

### Règles UI / code

- Zero fake, zero fallback inventé
- Pas `alert()` / `confirm()` / `prompt()` — modales React / toasts
- Pas de `fetch` direct dans les composants → `src/api/client.js`
- Styles : classes existantes (`glass`, `input-field`, `btn-*`, `zone-sunk`)
- Git : ne pas committer `.env`, secrets, `etc/mysql/` ; commit seulement sur demande

---

## Auth & utilisateurs

| État | Détail |
|------|--------|
| Login actuel | Mot de passe global `APP_PASSWORD` (comme cursorauto) |
| Admin users | https://<PUBLIC_HOST>/admin/users |
| API | `GET/POST/PATCH/DELETE /api/users` |
| Table | `users` — voir `AUTH-USERS.md` |
| Seed | `admin@helm.local` (auto si table vide) |
| Suite | magic links + rôles sur routes ; **pas encore** |

Fichiers clés :
- `server/routes/auth.js` — login JWT
- `server/lib/db.js` + `usersStore.js` — MariaDB
- `server/routes/users.js` — API admin
- `src/pages/AdminUsers.jsx` — UI

---

## Fichiers UI importants

| Rôle | Chemin |
|------|--------|
| Routes | `src/App.jsx` |
| Console | `src/pages/Dashboard.jsx` |
| Console + voix opérateur | `src/pages/Dashboard.jsx` + `useChatVoice` — STT/TTS **dans `/console`** (P2). Pages `/talk` `/voice` **retirées** |
| Admin users | `src/pages/AdminUsers.jsx` |
| Login | `src/pages/Login.jsx` |
| Timeline | `src/components/RunTimeline.jsx` |
| Input sticky | `src/components/ChatInput.jsx` |
| Stream | `src/lib/runStream.js` |
| API client | `src/api/client.js` |

---

## Déploiement

```bash
# Asus — source
cd ~/Bureau/NOW3/mds/helm-v1
npm run sync:h1          # rsync → h1
npm run deploy:dev       # sync + PM2 HMR
npm run deploy:prod      # build + preview

# h1
cd /apps/helm-v1/app
pm2 restart helm-api helm-vite
curl -s http://127.0.0.1:7826/api/health
```

Création app (déjà fait) :
```bash
ssh gbs-h1 'tb app sudo/way/noweb/create helm-v1'
```

---

## Docs dans ce dossier

| Fichier | Contenu |
|---------|---------|
| **AGENT-CONTEXT.md** | Ce fichier — vue d’ensemble |
| **regles.md** | Comportement agent + pilotage MariaDB |
| HELM.md | Fiche courte infra |
| AUTH-USERS.md | Users / magic links |
| AGENT-DEV.md | Dev UI + session CLI |
| stack.md | Bridge / ports |
| VISION.md | Roadmap produit détaillée |

---

## Workspace Cursor

Ajouter le dossier projet :
`/home/zaza/Bureau/NOW3/mds/helm-v1`

La suite du POC se fait **dans Helm**, pas dans cursorauto.
