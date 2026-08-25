# @shaper/ged-engine — GED Souveraine & Pipeline Documentaire IA

> Moteur de Gestion Électronique de Documents (GED) souveraine, analyse IA multimodale (Vision Minimax-M3, LLM Nemotron 3 Nano), recherche sémantique plein texte & vectorielle (MiniLM 384d), interface SPA réactive et stockage CAS SHA-256 dédupliqué.

---

## 🌐 Déploiement & Accès
* **URL de Production :** `https://ged.example.com`
* **Exposition :** Cloudflare Tunnel Zero Trust (Ingress vers port `8760`)
* **Conteneur Podman :** `univ-pipeline-xav-ged` (network host, persistance dans `/data/ged`)

---

## 🏗️ Architecture Technique

```
software/packages/ged-engine/
├── server.js               # Serveur HTTP Node.js natif (Routes REST, CAS, Recherche)
├── lib/
│   └── analyze.js          # Pipeline d'analyse : OCR/LAD, Vision IA, Palette, Structure
├── public/
│   └── index.html          # SPA complète (Dossiers, Recherche IA, Inspecteur, Popovers)
└── test/
    ├── ged.test.js         # Tests unitaires du catalogue et des classifications
    └── analyze.test.js     # Tests de l'enveloppe d'analyse et d'extraction
```

---

## 🚀 Fonctionnalités Clés

### 1. Espaces de Travail (Workspace Modes)
* **Mode Dossiers (`Alt+1`)** :
  - Arborescence de répertoires réactive.
  - Mode simple ou double volet (`split mode`) pour le déplacement / copie facile.
  - Filtre direct du dossier en cours dans la barre d'outils.
* **Mode Recherche IA (`Alt+2` ou `Ctrl+K`)** :
  - Recherche globale transversale à tous les dossiers.
  - Facettes : *Tout*, *Mots-clés IA*, *Texte & Synthèses*, *Noms de fichiers*.
  - Nuage de tags interactif généré dynamiquement à partir des mots-clés extraits.
  - Cartes de résultats avec aperçu, extraits surlignés et bouton **Localiser** dans l'arborescence.

### 2. Inspecteur Latéral & Vision IA Multimodale
* **Aperçu Visuel Haute Fidélité** :
  - Détection automatique du ratio d'aspect (`Paysage`, `Portrait`, `Carré`).
  - Affichage responsive sans rognage (`contain`), zoom 100% / Ajuster.
  - Palette de 5 couleurs dominantes avec pastilles cliquables (copie automatique du code `#hex`).
* **Synthèse Métier & Mots-clés** :
  - Description visuelle synthétique rédigée par **Minimax-M3** (Vision IA).
  - Analyse comptable / factures / LAD par **Nemotron 3 Nano**.
  - Zone dédiée aux **5 à 10 mots-clés pertinents** par document. Clic sur un tag = recherche globale immédiate.
* **En-tête épuré** : Badge de taille en Ko/Mo placé à gauche de la fermeture ✕, barre d'onglets compacte (icônes segmentées) et boutons d'actions contextuels.

### 3. Recherche Globale Sémantique (`GET /api/search`)
* Multi-termes et pondération de pertinence :
  - Match mot-clé IA : score +100
  - Match nom de fichier / chemin : score +80 / +40
  - Match synthèse IA : score +60 avec extrait
  - Match texte extrait OCR : score +30 avec extrait

---

## 📡 Endpoints API REST

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/tree` | Retourne l'arborescence complète des dossiers |
| `GET` | `/api/files?folder=...&q=...` | Liste les fichiers d'un dossier avec filtre local |
| `GET` | `/api/search?q=...&facet=...` | Recherche globale sémantique dans toute la GED |
| `GET` | `/api/stat?path=...` | Métadonnées et analyse d'un fichier spécifique |
| `GET` | `/api/raw?path=...` | Téléchargement ou flux binaire direct du document |
| `POST` | `/api/analyze` | Lance l'analyse IA (Vision / LLM / Extraction) |
| `POST` | `/api/fs` | Opérations système de fichiers (`mkdir`, `move`, `copy`, `delete`, `rename`) |
| `POST` | `/api/upload` | Téléversement direct avec calcul de SHA-256 CAS |
| `GET` | `/api/stats` | Statistiques globales (volumétrie, formats, synchronisation) |

---

## 🧪 Tests & Qualité
```bash
# Exécution de la suite complète de tests unitaires
cd software
node --test packages/ged-engine/test/ged.test.js packages/ged-engine/test/analyze.test.js packages/rag/test/rag.test.js
```
