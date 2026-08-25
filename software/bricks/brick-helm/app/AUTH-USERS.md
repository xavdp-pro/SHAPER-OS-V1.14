# Helm — utilisateurs & auth

> Voir aussi [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md) et [`VISION.md`](./VISION.md).

## État actuel (POC)

| Couche | État |
|--------|------|
| Login UI | Mot de passe global `APP_PASSWORD` (héritage cursorauto) |
| JWT cookie | `ca_token`, payload `{ role: 'operator' }` |
| Table MariaDB `users` | CRUD admin opérationnel |
| Page admin | https://<PUBLIC_HOST>/admin/users |
| Magic links | **Pas encore** — colonnes réservées |
| Users démo / auth par email | **Pas encore** |

## API

| Méthode | Path |
|---------|------|
| GET | `/api/users` |
| POST | `/api/users` |
| PATCH | `/api/users/:id` |
| DELETE | `/api/users/:id` |

Toutes protégées par `authMiddleware` (session JWT).

## Schéma `users`

Prêt pour la suite (ne pas casser sans migration) :

- `email`, `name`
- `role` : `admin` \| `operator` \| `viewer`
- `status` : `active` \| `pending` \| `disabled`
- `password_hash` — auth mdp par user (futur)
- `magic_token_hash`, `magic_token_expires_at` — magic links (futur)
- `last_login_at`, `notes`, timestamps

Seed auto si table vide : `admin@helm.local` (admin).

## Fichiers

| Fichier | Rôle |
|---------|------|
| `server/lib/db.js` | Pool mysql2 + `ensureUsersSchema` |
| `server/lib/usersStore.js` | CRUD |
| `server/routes/users.js` | Routes Express |
| `src/pages/AdminUsers.jsx` | UI admin |
| `src/api/client.js` | `listUsers` / `createUser` / … |

## Suite prévue (ordre)

1. Auth réelle par utilisateur (email)
2. Magic link (mail + token hashé)
3. Appliquer `role` sur `/admin/*` (admin only)
4. Comptes démo
5. Remplacer progressivement le login `APP_PASSWORD`
