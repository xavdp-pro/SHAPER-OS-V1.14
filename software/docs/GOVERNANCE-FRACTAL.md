# Gouvernance Fractale & Conventions SHAPER-OS

Ce document formalise les règles d'architecture, les 4 niveaux fractals, les conventions de nommage et la pyramide de tests pour assurer la cohérence et la pérennité de l'écosystème **SHAPER-OS**.

---

## 1. Les 4 Niveaux d'Abstraction Fractals

> **Complément** : la loi produit **P1 / P2 / P3** est dans [`PERIMETERS.md`](./PERIMETERS.md). Les niveaux ci-dessous décrivent le **déploiement** (package → univers → hôte → flotte), pas le métier client.

Pour éviter toute confusion lors de l'évolution du système, chaque action, brique ou test doit être rattaché explicitement à son niveau :

| Niveau | Désignation | Périmètre | Périmètre & Responsabilité | Exemples |
| :---: | :--- | :---: | :--- | :--- |
| **0** | **Brique & Package** | P1/P2 | Composant atomique, testé unitairement (`node:test`). | `@shaper/pkg-vault` (P1), `@shaper/pkg-maestro` (P2), `brick-helm` (P2) |
| **1** | **Univers / Cellule** | P1+P2 | Stack Podman autonome (socle + agentique). **Pas** un vertical P3. | `UNIV8`, `UNIV9` |
| **2** | **Nœud Hôte** | infra | LXC / bare-metal portant les univers. | `<host>-<univ_slug>` |
| **3** | **Flotte / Réseau** | infra | Mesh, tunnels, domaines publics. | `ia.example.com` |

### Mapping P1 / P2 / P3 (loi produit)

| Périmètre | Contenu | Exemples |
| :--- | :--- | :--- |
| **P1** | Socle minimal | vault, logger, auth, queue, db |
| **P2** | Agentique + KovZu | maestro, bridges, helm, ged, rag |
| **P3** | Outils métier clients | market-intelligence, enterprise-chat, univ-sinistre |

---

## 2. Convention de Nommage Immuable

Pour assurer la traçabilité dans Git, Podman, les fichiers de logs et les bases de données :

| Élément | Règle de Nommage | Exemple Valide |
|---|---|---|
| **Univers** | `UNIV<N>` (Majuscules) | `UNIV8`, `UNIV9` |
| **Dossier Univers** | `SHAPER-OS/universes/<univ_slug>/` | `universes/_template/` |
| **Brique Modèle** | `brick-<nom>` | `brick-helm`, `brick-mariadb`, `brick-vault` |
| **Package NPM Socle** | `@shaper/<nom>` | `@shaper/pkg-queue`, `@shaper/pkg-maestro`, `@shaper/pkg-db` |
| **Image Podman** | `localhost/shaper-<nom>:latest` | `localhost/shaper-helm:latest` |
| **Conteneur Podman Actif** | `<univ_slug>-<brique>` | `<univ_slug>-helm`, `<univ_slug>-mariadb`, `<univ_slug>-vault` |
| **Ports Standardisés** | `:8610` Vault<br>`:8620` Logger<br>`:8630` Maestro<br>`:8640` Queue<br>`:8650` Helm<br>`:4440` Bridge OpenCode<br>`:3306` MariaDB | Port fixe par univers ou bind localhost |

---

## 3. Pyramide de Tests Obligatoire

Aucun composant ne peut être intégré sans validation à 100% sur sa pyramide :

1. **Niveau 1 — Tests Unitaires Packages** (`node --test test/*.test.js`) :
   - Exécution ultra-rapide (< 1s), zéro dépendance externe, validation des fonctions pures.
2. **Niveau 2 — Tests d'Intégration & Scénarios PRA** :
   - Cold boot complet : Vault ➔ Logger ➔ MariaDB ➔ Queue ➔ Maestro ➔ Bridge ➔ Helm.
3. **Niveau 3 — Tests E2E Live Stack Conteneurisée** :
   - Validation en direct des conteneurs Podman, des routes HTTP/SSE, des tokens et de l'injection d'agent.

---

## 4. Politique de Sauvegarde Multi-Niveaux (conteneur → fichiers → DB → git → S3)

Avec **les cinq**, on est couvert. Un niveau manquant = un trou. Esprit turbinobash-web (`tb app sudo/backup`), adapté **Podman / Shaper OS**.

1. **Infra — conteneur entier** : snapshot LXC/CT (Proxmox / ZFS / vzdump). Filet externe.
2. **Fichiers — volumes persistants en `tar.bz2`** : uniquement les bind-mounts Podman (`<univ>/sav/*`, pas l’overlay, pas `nosav/`, pas le cache d’images). Même geste que le backup app turbinobash.
3. **Database** : dump MariaDB (et snapshot Qdrant si besoin) — pas seulement un tar à chaud du datadir.
4. **Git** : tags immuables du code. Git n’est pas une sauvegarde de données métier.
5. **S3 / R2** : copie hors site chiffrée des `tar.bz2` et des dumps.

**Rollback** : image taggée + extract `tar.bz2` des volumes + restore dump — puis TEST from scratch pour prouver, pas « ça marchait sur la machine chaude ».
