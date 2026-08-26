# opencode-bridge

Pont HTTP + SSE devant le CLI [OpenCode](https://opencode.ai), au **même contrat**
que `cursor-agent-bridge`, `antigravity-bridge` et `claude-bridge`.

Il permet à une console type KovZu / helm-v2 de piloter OpenCode comme n'importe
quel autre CLI agent, sans code spécifique côté application.

## Particularité par rapport aux autres bridges

Cursor et Antigravity lancent **un process par run** et lisent son stdout.
OpenCode fournit un vrai serveur headless : le bridge lance **une seule fois**
`opencode serve`, s'abonne à son flux d'événements et le traduit vers le contrat commun.

C'est ce qui donne le **streaming token par token** (`message.part.delta`), là où
`opencode run --format json` ne renvoie le texte qu'en un seul bloc à la fin.

```
console ──HTTP──> opencode-bridge :4340 ──HTTP/SSE──> opencode serve :4341 ──> modèle
```

## API

| Route | Rôle |
|-------|------|
| `GET  /api/health` | Sonde publique (sans token) |
| `GET  /api/status` | État + `ready` (le serve répond) + modèle |
| `GET  /api/conversations` | Conversations enregistrées |
| `POST /api/inject` | `{ conversation, message, model?, attachments? }` |
| `GET  /api/events` | SSE, filtrable par `?conversation=` |
| `POST /api/conversations/stop` | `{ conversation }` ou `{ all: true }` |
| `POST /api/conversations/reset` | Oublie la session → prochain run repart à zéro |
| `POST /api/conversations/delete` | Retire la conversation du registre |
| `POST /api/upload` | Pièce jointe base64 dans le workspace |
| `GET  /api/fs/list?path=` | Listing de dossiers (sélecteur de workspace) |

Auth : `Authorization: Bearer <token>`, auto-créé dans
`~/.config/opencode-bridge/token` (chmod 600).

## Événements émis

Contrat commun à tous les bridges :

| Type | Quand |
|------|-------|
| `connected` | Ouverture du SSE |
| `inject` | Run accepté (porte `run_id`) |
| `thinking` | Deltas de raisonnement ; `subtype: completed` à la fin |
| `tool` | Outil démarré — `call_id`, `tool`, `input`, `command`, `cwd` |
| `tool_complete` | Outil terminé — `call_id`, `result` |
| `response` | Deltas de réponse — `delta` + `text` cumulatif |
| `response_complete` | Texte final |
| `run_complete` | Fin de run |
| `run_aborted` | Interruption via `/stop` |
| `ping` | Keepalive (25 s) |

Chaque événement d'un run porte `run_id` et un `seq` croissant.

## Correspondance avec les événements OpenCode

| OpenCode | Bridge |
|----------|--------|
| `message.part.delta` (part `reasoning`) | `thinking` |
| `message.part.delta` (part `text`, message assistant) | `response` |
| `message.part.updated` (part `tool`) | `tool` / `tool_complete` |
| `session.idle` | `response_complete` + `run_complete` |

Le type d'une part n'est pas répété dans les deltas : le bridge mémorise
`partID → type` depuis `message.part.updated` pour router chaque delta.

## Installation

```bash
cp .env.example .env && chmod 600 .env   # ajuster port / modèle / workspace
./start-bridge.sh
```

Le CLI `opencode` n'est pas versionné ici : l'installer dans `bin/opencode`
(ou pointer `OPENCODE_BIN` ailleurs).

## Modèles

`opencode models` liste ce qui est disponible. Les modèles suffixés `-free`
n'ont aucun coût et ne demandent pas de credentials.

Défaut : `opencode/nemotron-3-ultra-free` — validé sur appel d'outil `bash`,
tableau markdown et prose.

## Vérification

```bash
curl -s localhost:4340/api/health
T=$(cat ~/.config/opencode-bridge/token)
curl -s -H "Authorization: Bearer $T" localhost:4340/api/status
```

`ready: true` signifie que le `opencode serve` interne répond.

## Tests

```bash
npm test          # unitaires — traduction des événements, sans réseau ni modèle
npm run test:cli  # bout en bout — exige le bridge démarré
```

Les tests unitaires portent sur `translate.mjs`, volontairement sans I/O : il
reçoit un événement OpenCode et renvoie les événements canoniques à diffuser,
ce qui permet de rejouer des séquences réelles sans lancer de CLI ni consommer
de quota. Les formes d'événements utilisées viennent de captures réelles sur
opencode 1.18.15.

`scripts/test-cli.sh` vérifie l'installation réelle : authentification, run
complet avec appel d'outil, streaming effectif du texte, continuité de session
entre deux tours, stop, reset et garde-fous de validation.
