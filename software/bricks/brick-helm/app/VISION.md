# Helm — vision produit

> **Perimeter law**: KovZu `/console` = **P2**. Client tools (CRM, Desk) = **P3**. See [`../../../docs/PERIMETERS.md`](../../../docs/PERIMETERS.md).

## Métaphore

**Helm** = gouvernail.  
Tu diriges (voix / commandes) ; l’écran desktop montre ; Cursor fabrique ce qui devient récurrent.

## Architecture cible

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│ Mobile Helm     │ ─────────────────► │ Desktop Helm     │
│ Voice (micro)   │                    │ Desk (affichage) │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         │ STT / TTS                            │ UI pages métier
         ▼                                      ▼
┌─────────────────┐                    ┌──────────────────┐
│ Hub commandes   │ ─── si récurrent ─►│ Cursor CLI       │
│ + auth users    │                    │ (génère l’outil) │
└─────────────────┘                    └──────────────────┘
```

## Phases

| # | Phase | Statut |
|---|--------|--------|
| 0 | Console Cursor web (fork cursorauto) | **Fait** — <PUBLIC_HOST> |
| 1 | Admin utilisateurs MariaDB | **Fait** — CRUD ; login encore global |
| 2 | Auth réelle + magic links + users démo | **À faire** (P2 Helm) |
| 3 | Voix opérateur dans `/console` | **En cours** — STT/TTS, ack Groq (P2). Routes `/talk` `/voice` **retirées** |
| 4 | WebSocket mobile → desktop (Helm Desk) | **À faire** (**P3** — app distincte) |
| 5 | POC CRM (mails, factures, graphiques) | **À faire** (**P3** — hors KovZu) |
| 6 | Docker / packaging | **Plus tard** — pas maintenant |

## Exemples de commandes cibles

- « Affiche les emails de Dupont »
- « Calcule les factures de ce client »
- « Fais-moi un graphique CA 6 mois »
- « Ouvre la page résultats »

Si la demande revient souvent → Cursor code le module → ensuite navigation seule.

## Voix

- **Actuel (P2)** : STT/TTS Deepgram + ack Groq **dans `/console`** (`useChatVoice`, `/api/voice/*`)
- **Retiré** : pages dédiées `/talk` et `/voice` (redirect → `/console`)
- Desktop : souvent **sans micro** → affichage seulement ; mobile : micro + TTS pour piloter
- Émotion : Hume (auto) ou ElevenLabs v3 (`[sighs]`, `[laughs]`, …) via tags LLM — **suite P3** si hors console

## Sous-composants (noms)

| Nom | Rôle |
|-----|------|
| Helm / KovZu | Cockpit Opérateur central (Agents, Timelines, Socle, MariaDB) |
| Helm Voice | Couche voix **dans `/console`** (P2) — ex-page Talk retirée |
| Helm Desk | App desktop pilotée (**P3** — distincte de KovZu) |
| Outils Clients | Applications métiers **P3** — strictement distincts de KovZu |

---

## 🔒 Règle Fondamentale : Séparation Cockpit KovZu vs Outils Clients

* **KovZu** est exclusivement la **console de supervision et de pilotage souverain de l'opérateur** (gestion des agents IA, timelines, orchestration, logs, secrets).
* **Les outils clients** (frontends métiers, portails clients, dashboards finaux, mini-apps) sont **strictement distincts** de l'interface KovZu : ils disposent de leur propre cycle de vie, UI dédiée et hébergement séparé, consommant les APIs du socle en arrière-plan sans jamais polluer le cockpit d'administration.
