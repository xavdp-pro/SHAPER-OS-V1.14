# 🌌 SHAPER OS — Architecture Fractale & Modèle de Sécurité Souverain

> **Statut de Référence :** Document d’Architecture & de Sécurité Normative  
> **Conformité :** Règles 23 (Vitals/Sondes), 27 (Alerting), 36 (Autorité & Isolation)

---

## 1. Vision & Principe Fondamental de la Fractalité

Dans **SHAPER OS**, chaque niveau de l'organisation est un univers autonome et auto-similaire.  
Un univers à un niveau donné ne connaît que ses enfants directs et son parent immédiat. Il n'a aucun pouvoir arbitraire sur le système d'exploitation global.

```mermaid
flowchart TD
    N0["🏢 <b>NIVEAU 0 — SaaS global</b><br/>comptes, forfaits, quotas signés<br/>file d'ordres de déploiement"]
    N1A["🚀 <b>NIVEAU 1A — Host spawner</b><br/>bare-metal A<br/>podman rootless + connecteur DNS"]
    N1B["🚀 <b>NIVEAU 1B — Host spawner</b><br/>VPS B<br/>podman rootless + connecteur DNS"]
    N2A["🎛️ <b>NIVEAU 2A — Manager de flotte</b><br/>2 enfants actifs sur 5"]
    N2B["🎛️ <b>NIVEAU 2B — Manager de flotte</b><br/>4 enfants actifs sur 10"]
    C1["NIVEAU 3 — enfant 01"]
    C2["NIVEAU 3 — enfant 02"]
    C3["NIVEAU 3 — enfant 03"]
    C4["NIVEAU 3 — enfant 04"]

    N0 -- "🔄 flux PULL · zéro port ouvert" --> N1A
    N0 -- "🔄 flux PULL · zéro port ouvert" --> N1B
    N1A --> N2A
    N1B --> N2B
    N2A --> C1
    N2A --> C2
    N2B --> C3
    N2B --> C4

    classDef n fill:#0d1117,stroke:#3fb950,color:#e6edf3
    classDef c fill:#161b22,stroke:#8b949e,color:#e6edf3
    class N0,N1A,N1B,N2A,N2B n
    class C1,C2,C3,C4 c
```

> Chaque nom au niveau 3 est fourni par l'opérateur. Ce dépôt n'en livre aucun.

---

## 2. Le Modèle de Sécurité Souverain : Le Modèle « PULL Worker »

La sécurité de SHAPER OS repose sur un refus catégorique des accès root et des ports ouverts.

```mermaid
flowchart LR
    subgraph mauvais["❌ Méthode courante — vulnérabilité majeure"]
        direction LR
        W1["Manager web cloud"] -- "SSH root · port 22 ouvert" --> H1["Serveur hôte"]
    end

    subgraph shaper["✅ Méthode SHAPER OS — Zero Trust"]
        direction LR
        H2["Serveur hôte<br/><i>100% fermé</i>"] -- "connexion SORTANTE<br/>polling / SSE" --> W2["Manager web cloud"]
    end

    classDef bad fill:#161b22,stroke:#f85149,color:#e6edf3
    classDef good fill:#0d1117,stroke:#3fb950,color:#e6edf3
    class W1,H1 bad
    class W2,H2 good
```

Dans le premier cas, un web compromis donne le contrôle total du serveur. Dans
le second, l'hôte interroge la file de tâches et n'expose aucun port entrant.

### Pourquoi ce modèle est inviolable :
1. **Zéro port d'écoute ouvert sur Internet :** Le serveur VPS / Hôte ne possède aucun port SSH ou API d'administration exposé au public.
2. **Initiative toujours locale :** C'est le moteur de l'Hôte qui va chercher ses ordres auprès du SaaS (requête sortante HTTPS).
3. **Impossibilité d'injection de code système :** Le serveur hôte n'accepte que des ordres de mission stricts et typés (`SPAWN_STORE`, `STOP_STORE`, `BACKUP_STORE`).

---

## 3. L'Univers SHAPER OS de l'Hôte (Host Spawner Engine)

Pour exécuter les ordres de création de conteneurs, le serveur Hôte possède **son propre Univers SHAPER OS** composé des briques natives :

| Brique SHAPER | Rôle dans l'Hôte Spawner |
| :--- | :--- |
| **`@shaper/pkg-queue`** | Ordonnance les créations et destructions de boutiques dans une file priorisée avec gestion de charge. |
| **`@shaper/pkg-logger`** | Enregistre chaque événement d'infrastructure dans un journal immuable JSONL (`log/events.jsonl`). |
| **`@shaper/pkg-maestro`** | Chef d'orchestre local qui dépile la Queue, exécute les scripts Podman et vérifie la conformité. |
| **`@shaper/pkg-vault`** | Chiffre et isole les clés API Cloudflare, les mots de passe MariaDB et les certificats de licence. |
| **`@shaper/pkg-supervisor`** | Surveille l'utilisation RAM, CPU et disque de l'ensemble de la flotte de conteneurs. |

---

## 4. Le Principe du Moindre Privilège & Podman Rootless

1. **Podman Rootless (Zéro Root) :**
   * Tous les conteneurs, quels qu'ils soient, s'exécutent sous un utilisateur non privilégié dédié.
   * Même en cas de faille zero-day critique dans l'application hébergée, l'attaquant reste confiné dans le conteneur sans aucun droit sur le système hôte.
2. **Isolation Réseau Multi-Tenancy :**
   * Chaque univers fils possède son propre sous-réseau conteneurisé.
   * L'univers fils `01` ne peut ni lire, ni écrire dans la base de données de l'univers fils `02`.

---

## 5. Le Cycle de Vie Automatisé (Zero-Touch Provisioning)

Lorsqu'un ordre `SPAWN_CHILD` est validé par la Queue de l'Hôte :

```mermaid
flowchart LR
    A["1 · Allocation<br/><i>ports libres, volumes vol-*</i>"]
    B["2 · Données<br/><i>conteneur de persistance</i>"]
    C["3 · Application<br/><i>conteneur de restitution</i>"]
    D["4 · Amorçage<br/><i>configuration sans humain</i>"]
    E["5 · Ingress<br/><i>DNS et tunnel Zero Trust</i>"]
    F["6 · Prêt<br/><i>univers fils en ligne</i>"]

    A --> B --> C --> D --> E --> F

    classDef s fill:#0d1117,stroke:#3fb950,color:#e6edf3
    class A,B,C,D,E,F s
```

1. **Amorçage automatique :** l'application du fils est installée et configurée sans intervention humaine.
2. **Spécialisation :** la brique métier du catalogue est activée et paramétrée depuis le manifeste du fils.
3. **Câblage edge :** l'API du fournisseur DNS associe le nom public au tunnel Zero Trust sans redémarrage de service.

---

## 6. Gestion des Quotas & Modèle Économique (5, 10, 20 Boutiques)

* Le SaaS Grand-Père injecte dans le Vault du Manager Père un jeton de quota cryptographique (`max_stores: 5`).
* Le Manager Père refuse toute création supplémentaire si `nombre_boutiques >= max_stores`.
* Lors d'une mise à niveau de forfait, le SaaS émet un jeton mis à jour qui débloque instantanément les nouveaux emplacements dans l'interface commerçant.

---

*Document de référence SHAPER OS V1.8 — Architecture Fractale & Sécurité Souveraine.*
