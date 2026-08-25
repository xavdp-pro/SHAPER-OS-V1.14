# Registre des Expérimentations SHAPER-OS (Ledger)

Ce registre journalise chaque étape de conception, POC et validation dans SHAPER-OS.

---

## EXP-001 : Déploiement Socle UNIV8 + Helm v2 + OpenCode + Tunnel Cloudflare
* **Date** : 18 Août 2026
* **Niveaux Concernés** : Niveau 0 (Briques & Packages), Niveau 1 (Univers UNIV8), Niveau 3 (Tunnel `ia.example.com`)
* **Objectif** :
  - Déployer un univers 100% conteneurisé sous Podman sur LXC `univ8` (`145.239.84.24:2208`).
  - Intégrer la brique `brick-helm` (Web Chat React 19 + Express 5 + Deepgram STT + Groq Ack).
  - Connecter le bridge autonome OpenCode (`:4440`) et router le trafic via Cloudflare Tunnel (`ia.example.com`).
* **Résultats & Preuves** :
  - 7 conteneurs Podman actifs (`univ8-vault`, `univ8-logger`, `univ8-bridge-opencode`, `univ8-queue`, `univ8-maestro`, `univ8-helm`, `univ8-tunnel`).
  - 9/9 tests automatisés au vert (`npm test` sur `gbs-univ8`).
  - URL publique opérationnelle : `https://ia.example.com` (Login, Chat, Voix Deepgram/Groq).
* **Invariants Gravés** :
  - Multi-stage build pour les briques web complexes.
  - Résilience du Logger avec création automatique des dossiers parents (`fs.mkdirSync`).
  - Clés d'acquittement vocal Groq et STT Deepgram sécurisées dans Vault.

---

## EXP-002 : Shaper-Helm Tout-en-Un (MariaDB Embarqué, Maestro UI, i18n FR/EN/ES) (UNIV9)
* **Date** : 18 Août 2026
* **Niveaux Concernés** : Niveau 0 (`brick-helm` avec moteur MariaDB embarqué), Niveau 1 (Univers UNIV9), Niveau 3 (Tunnel `ia.example.com`)
* **Objectif & Directives Utilisateur** :
  - Fournir un conteneur Shaper-Helm **autonome et tout-en-un** (avec son propre moteur MariaDB embarqué dans le conteneur Podman, sans dépendance à une base externe séparée).
  - Purger le mode démo (`thesuperuser@helm.local`) au profit d'une vraie authentification MariaDB (`admin@univ9.shaper` / `ShaperAdmin2026!`).
  - Intégrer l'internationalisation trilingue (🇫🇷 FR, 🇬🇧 EN, 🇪🇸 ES).
  - Intégrer l'interface de pilotage Maestro (`/admin/maestro`) et le tableau de bord santé du socle (`/admin/socle`).
* **Résultats & Preuves** :
  - Image `localhost/shaper-helm:latest` construite avec Alpine + MariaDB 11.4 embarqué + Express 5 + Vite React 19.
  - Stack UNIV9 déployée et validée sur l'hôte LXC `gbs-univ9` (`145.239.84.24:2209`).
  - 8/8 tests automatisés 100% au vert (`npm test` sur `gbs-univ9`).
  - URL publique opérationnelle : `https://ia.example.com` (Mode production, MariaDB embarqué, login Admin, Deepgram Voix, Maestro & Socle endpoints).
* **Snapshot d'Univers** :
  - `sav/snapshots/UNIV9_exp-002-pass_20260818_212923.tar.gz`
* **Invariants Gravés** :
  - MariaDB embarqué dans `shaper-helm` configuré avec `--init-file=/app/init.sql` et `--skip-networking=OFF`.
  - Pas de compte de démonstration en production, authentification bcrypt 12-rounds stricte.
