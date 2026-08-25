# Helm — users & auth

> See also [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md) and [`VISION.md`](./VISION.md).

## Current state

| Layer | State |
|-------|-------|
| Login UI | Email (or username) + password |
| JWT cookie | `ca_token`, payload `{ sub, email, name, role }` |
| MariaDB `users` table | Admin CRUD + `password_hash` (bcrypt) |
| Demo account | `TheSuperUser` / `thesuperuser@helm.local` (API seed) |
| Magic links | **Not yet** — reserved columns |
| Admin role guard on `/admin` | **Not yet** |

## Login

`POST /api/auth/login` `{ email, password }`:

- Lookup by email, or by `name` (e.g. `TheSuperUser`), or local-part `@helm.local`
- Verifies `status === active` + `password_hash` (bcryptjs)
- Updates `last_login_at`
- HTTP-only cookie `ca_token` (7 days)

**Fill demo account** button on `/` pre-fills fields (no magic link).

## Operator Briefing

Field `users.briefing` (TEXT) — presentation + permanent guidelines for Cursor CLI.

| Timing | Behavior |
|--------|----------|
| Empty session (1st open) | `POST /api/session/prime` injects briefing + requests a "hello" |
| Emptying conversation | `POST /api/session/clear` (orchestrated: stop + timeline + reset + prime) |
| Manual CLI reset | `POST /api/session/reset` with `prime: true` |
| Edit / resend message | reset **without** prime |

UI: `/admin/briefing` (self) + field on admin user sheet.

## API

| Method | Path |
|--------|------|
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| GET | `/api/auth/me` — includes `briefing` |
| PATCH | `/api/auth/me` — `{ name?, briefing? }` |
| POST | `/api/session/prime` |
| POST | `/api/session/clear` — `{ conversation }` — complete orchestrated clear |
| POST | `/api/session/reset` — `{ conversation, prime? }` |

## Admin (bookmarkable tabs)

| URL | Content |
|-----|---------|
| `/admin` | → `/admin/agent` |
| `/admin/agent` | AI agent name |
| `/admin/briefing` | Operator briefing (presentation / CLI guidelines) |
| `/admin/voices` | TTS voices |
| `/admin/users` | Users list |
| `/admin/users/new` | Creation (+ optional password) |
| `/admin/users/:id` | Modification |

Also: `GET/POST/PATCH/DELETE /api/users` (admin CRUD).

All protected by `authMiddleware` (JWT session).

## `users` Schema

- `email`, `name`
- `role`: `admin` \| `operator` \| `viewer`
- `status`: `active` \| `pending` \| `disabled`
- `password_hash` — bcrypt (current auth)
- `briefing` — presentation / Cursor CLI guidelines (sessions)
- `magic_token_hash`, `magic_token_expires_at` — reserved for magic links
- `last_login_at`, `notes`, timestamps

Seed at API startup: upsert demo admin `TheSuperUser` (+ demo briefing if empty).

## Files

| File | Role |
|------|------|
| `server/lib/db.js` | mysql2 pool + `ensureUsersSchema` + demo seed |
| `server/lib/password.js` | bcrypt hash / verify |
| `server/lib/demoAdmin.js` | Demo seed credentials |
| `server/lib/sessionPrime.js` | Session startup message (briefing + hello) |
| `server/lib/usersStore.js` | CRUD + `findUserForAuth` |
| `server/routes/auth.js` | Login / logout / me |
| `server/routes/session.js` | Reset / prime / stop |
| `server/routes/users.js` | Express user routes |
| `src/pages/Login.jsx` | Login UI + demo button |
| `src/pages/admin/AdminBriefing.jsx` | Briefing edition |
| `src/lib/demoCredentials.js` | Frontend pre-fill |
| `src/pages/admin/AdminUsers.jsx` | Admin UI |

## Planned Next Steps

1. Magic link (email + hashed token)
2. Enforce `role` on `/admin/*` (admin only)
3. Additional demo accounts / dedicated demo UX
