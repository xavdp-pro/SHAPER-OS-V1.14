# 🌌 SHAPER OS — Architecture Fractale & Modèle de Sécurité Souverain

> **Statut de Référence :** Document d’Architecture & de Sécurité Normative  
> **Conformité :** Règles 23 (Vitals/Sondes), 27 (Alerting), 36 (Autorité & Isolation)

---

## 1. Vision & Principe Fondamental de la Fractalité

Dans **SHAPER OS**, chaque niveau de l'organisation est un univers autonome et auto-similaire.  
Un univers à un niveau donné ne connaît que ses enfants directs et son parent immédiat. Il n'a aucun pouvoir arbitraire sur le système d'exploitation global.

```
                                  ┌────────────────────────────────────────────────────────┐
                                  │      ARCHITECTURE FLOTTE MULTI-HOST / BARE-METAL       │
                                  └────────────────────────────────────────────────────────┘

     ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
     │ 🏢 NIVEAU 0 : LE SAAS SHAPER GLOBAL (GRAND-PÈRE / GESTIONNAIRE DE FLOTTE)                       │
     │    • Gestion des comptes clients, forfaits & abonnements (5, 10, 20 boutiques).                 │
     │    • Distribution des quotas de licences signées cryptographiquement.                           │
     │    • File d'attente d'ordres globale (Dispatcheur de commandes de déploiement).                 │
     └───────────────────────────────┬─────────────────────────────────┬───────────────────────────────┘
                                     │                                 │
                 🔄 Flux PULL        │                                 │    🔄 Flux PULL
                 (Zéro port ouvert!) │                                 │    (Zéro port ouvert!)
                                     ▼                                 ▼
     ┌───────────────────────────────────────────────┐ ┌───────────────────────────────────────────────┐
     │ 🚀 NIVEAU 1A : HOST SPAWNER (BARE-METAL A)    │ │ 🚀 NIVEAU 1B : HOST SPAWNER (VPS B)           │
     │    • 1 Host Spawner dédié au serveur A.       │ │    • 1 Host Spawner dédié au serveur B.       │
     │    • Podman Rootless + Connecteur Cloudflare. │ │    • Podman Rootless + Connecteur Cloudflare. │
     └───────────────────────┬───────────────────────┘ └───────────────────────┬───────────────────────┘
                             │                                                 │
                             ▼                                                 ▼
     ┌───────────────────────────────────────────────┐ ┌───────────────────────────────────────────────┐
     │ 🎛️ NIVEAU 2A : BOUTIQUE MANAGER (CLIENT ALICE)│ │ 🎛️ NIVEAU 2B : BOUTIQUE MANAGER (CLIENT BOB)  │
     │    • wpmanager01: 2/5 boutiques actives.      │ │    • wpmanager02: 4/10 boutiques actives.     │
     └───────────────────────┬───────────────────────┘ └───────────────────────┬───────────────────────┘
                             │                                                 │
            ┌────────────────┴────────────────┐               ┌────────────────┴────────────────┐
            ▼                                 ▼               ▼                                 ▼
     ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
     │ 🛍️ NIVEAU 3 : WP 01  │ │ 🛍️ NIVEAU 3 : WP 02  │ │ 🛍️ NIVEAU 3 : WP 03  │ │ 🛍️ NIVEAU 3 : WP 04  │
     │    (wp01.example.com) │ │    (wp02.example.com) │ │   (bob-shop.example.com)│ │  (bob-shoes.example.com)│
     └──────────────────────┘ └──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```

---

## 2. Le Modèle de Sécurité Souverain : Le Modèle « PULL Worker »

La sécurité de SHAPER OS repose sur un refus catégorique des accès root et des ports ouverts.

```
     ❌ MAUVAISE MÉTHODE (VULNÉRABILITÉ MAJEURE) :
        Manager Web Cloud ═══════════ SSH Root (Port 22 ouvert) ═══════════> Serveur Hôte
        (Si le web est compromis, l'attaquant a le contrôle total du serveur)

     ✅ MÉTHODE SHAPER OS (SOUVERAINETÉ & ZERO TRUST) :
        Manager Web Cloud <══════════ Connexion SORTANTE (Polling / SSE) ═══ Serveur Hôte (100% FERMÉ)
        (Le serveur hôte interroge la file de tâches sans aucun port entrant ouvert)
```

### Pourquoi ce modèle est inviolable :
1. **Zéro port d'écoute ouvert sur Internet :** Le serveur VPS / Hôte ne possède aucun port SSH ou API d'administration exposé au public.
2. **Initiative toujours locale :** C'est le moteur de l'Hôte qui va chercher ses ordres auprès du SaaS (requête sortante HTTPS).
3. **Impossibilité d'injection de code système :** Le serveur hôte n'accepte que des ordres de mission stricts et typés (`SPAWN_STORE`, `STOP_STORE`, `BACKUP_STORE`).

---

## 3. L'Univers SHAPER OS de l'Hôte (Host Spawner Engine)

Pour exécuter les ordres de création de conteneurs, le serveur Hôte possède **son propre Univers SHAPER OS** composé des briques natives :

| Brique SHAPER | Rôle dans l'Hôte Spawner |
| :--- | :--- |
| **`@shaper/queue`** | Ordonnance les créations et destructions de boutiques dans une file priorisée avec gestion de charge. |
| **`@shaper/logger`** | Enregistre chaque événement d'infrastructure dans un journal immuable JSONL (`log/events.jsonl`). |
| **`@shaper/maestro`** | Chef d'orchestre local qui dépile la Queue, exécute les scripts Podman et vérifie la conformité. |
| **`@shaper/vault`** | Chiffre et isole les clés API Cloudflare, les mots de passe MariaDB et les certificats de licence. |
| **`@shaper/supervisor`** | Surveille l'utilisation RAM, CPU et disque de l'ensemble de la flotte de conteneurs. |

---

## 4. Le Principe du Moindre Privilège & Podman Rootless

1. **Podman Rootless (Zéro Root) :**
   * Tous les conteneurs (WordPress, MariaDB, sondes) s'exécutent sous un utilisateur non privilégié (`zaza` ou `shaper`).
   * Même en cas de faille zero-day critique dans un plugin WordPress, l'attaquant reste confiné dans le conteneur sans aucun droit sur le système hôte.
2. **Isolation Réseau Multi-Tenancy :**
   * Chaque univers fils possède son propre sous-réseau conteneurisé.
   * La boutique `wp01` ne peut ni lire, ni écrire dans la base de données de la boutique `wp02`.

---

## 5. Le Cycle de Vie Automatisé (Zero-Touch Provisioning)

Lorsqu'un ordre `SPAWN_STORE` est validé par la Queue de l'Hôte :

```
  [1. Allocation]  ──>  [2. MariaDB]  ──>  [3. WordPress]  ──>  [4. WP-CLI Auto]  ──>  [5. Cloudflare]  ──>  [6. Ready]
  Ports libres          Conteneur DB       Conteneur Web        Langue, Titre,          DNS CNAME &           En ligne en
  & Dossiers /sav/      dédié (:9536)      dédié (:9580)        WooCommerce Actif       Tunnel Ingress        15 secondes
```

1. **Amorçage Automatique :** WordPress est installé et configuré en français sans intervention humaine.
2. **Activation E-Commerce :** WooCommerce est activé, devise paramétrée en EUR, pages obligatoires créées.
3. **Câblage Edge Cloudflare :** L'API Cloudflare associe immédiatement le domaine `https://wp02.example.com` au tunnel Zero Trust sans redémarrage de service.

---

## 6. Gestion des Quotas & Modèle Économique (5, 10, 20 Boutiques)

* Le SaaS Grand-Père injecte dans le Vault du Manager Père un jeton de quota cryptographique (`max_stores: 5`).
* Le Manager Père refuse toute création supplémentaire si `nombre_boutiques >= max_stores`.
* Lors d'une mise à niveau de forfait, le SaaS émet un jeton mis à jour qui débloque instantanément les nouveaux emplacements dans l'interface commerçant.

---

*Document de référence SHAPER OS V1.8 — Architecture Fractale & Sécurité Souveraine.*
