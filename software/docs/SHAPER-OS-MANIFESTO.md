# SHAPER OS — The Foundational Manifesto: Intent-Driven Engineering & Declarative Crafting

> **Publisher**: XDP | ADVANCED DYNAMIC IA SYSTEM LLC (USA)  
> **Author & Architect**: Xavier DE POORTER  
> **Status**: Foundational Doctrine & Engineering Law  
> **Canonical copy**: [`../MANIFESTO.md`](../MANIFESTO.md) (repo root). Perimeter law: [`PERIMETERS.md`](./PERIMETERS.md).

---

## 1. The Core Philosophy: "Keep It Simple, Declare the Intent"

Traditional software engineering failed because it drowned human minds and documentation in thousands of lines of fragile, imperative boilerplate. 

In the era of autonomous AI agents, **SHAPER OS** establishes a new paradigm:

> **"The Human declares the Intent, Rules, and Target Invariants; the AI Agent synthesizes and executes the exact Code."**

We do not write bloated step-by-step cooking recipes. We state the high-signal essence clearly, and the AI agent crafts the terrain on the fly. Whether executed today by a current model or in six months by a ten-times more capable model, the foundational intent remains timeless and unpolluted.

---

## 2. The Four Pillars of the SHAPER OS Doctrine

These four concepts are distinct facets of the same universal truth:

### Pillar 1: Intent-Driven Engineering (L'Ingénierie par Intention)
* **Definition**: Describing the high-level business goal, security boundaries, and outcome rather than micromanaging low-level syntax.
* **Mechanism**: When an agent knows *What* needs to be achieved and *Why*, it autonomously generates the optimal commands, algorithms, and glue code with zero friction.

### Pillar 2: Declarative Crafting (Le Façonnage Déclaratif)
* **Definition**: Stating the *desired target state* instead of a brittle sequence of procedural steps.
* **Mechanism**: State the 4 mandatory invariants (e.g. OS, capabilities, skeleton injection, access keys). The agent inspects the environment and reconciles reality to match the declared contract.

### Pillar 3: Zero-Noise Contract Protocol (Le Contrat Minimaliste Zéro-Bruit)
* **Definition**: Ruthlessly eliminating decorative fluff, boilerplate noise, and redundant code from repositories and documentation.
* **Mechanism**: High-signal input yields high-accuracy output. Less noise equals zero hallucinations, prompt-caching efficiency, and zero token waste at rest.

### Pillar 4: Living Fractal Intent (La Spécification Vivante Fractale)
* **Definition**: Documentation that lives as active, composable context (`ctx-universe.md`, `RULES.md`, LEGO `@shaper/*` engines) rather than dead manuals.
* **Mechanism**: Small, atomic bricks assembled like fractals to build enterprise ERPs, CRMs, voice AI engines, or legal universes in minutes.

---

## 3. The Concrete Laws of Declarative Crafting

1. **Law of Minimalist Invariants**: If a specification cannot be defined in 4 to 6 clear declarative bullet points, it is over-engineered. Simplify first.
2. **Law of the Justified Golden Snippet (Preserving Hard-Won Solutions)**:
   - While verbose boilerplate is prohibited, **targeted minimal code snippets or exact declarations are strictly authorized and encouraged when justified**.
   - If solving a complex edge-case required days of deep investigation (e.g. 2 critical lines for LXC capability passthroughs, specific WireGuard flags, or subtle cryptographic ciphers), **those exact golden lines MUST be preserved in the doc or in dedicated companion files (`examples/`)** so neither human nor agent ever wastes time rediscovering them.
3. **Law of Dynamic Runtime Adaptability ("Dynamic in the Interpreted Sense")**:
   - Rules are protective guardrails, not rigid handcuffs. Systems, agents, and pipelines must remain fundamentally dynamic and context-adaptive—evaluating inputs, parameters, and environment state dynamically at runtime (similar to the flexible, interpreted runtime philosophy of PHP/Node.js) rather than crashing against static walls.
4. **Law of Human Steering & Symbiotic Agility**:
   - The human operator is the strategic compass and dynamic leader. The AI agent must mirror this dynamic mindset: adapting its velocity, execution paths, and tooling pragmatically to follow the human's live direction.
5. **Law of Pure Parametrization**: Everything is a parameterized function. No hardcoded IPs, hostnames, or rigid vendor lock-in (Rule 0B).
6. **Law of Ephemeral Infrastructure**: Code and containers are disposable; structure, data, and declared intent are permanent (Rule 10).
7. **Law of Direct Cash & Human Liberation**: Every brick must eliminate repetitive labor, liberate human creative time, and produce direct, sovereign business value.
8. **Law of Turbinobash Sovereign Hosting & CLI Plesk-like Conventions**:
   - Every deployable application or brick adheres to the battle-tested **Turbinobash (`tb`)** hosting architecture: a sovereign, CLI-first Plesk/cPanel-like infrastructure engine.
   - **Canonical Hierarchy**: `/apps/<slug>/` (or `<univ>/`) containing `app/` (code, git), `log/` (JSONL), `sav/` (persistent Podman volumes — backed up as `tar.bz2`), `nosav/` (cache — excluded).
   - **On-Demand Isolated Database**: MariaDB databases are provisioned strictly on-demand following `user = database = slug`, reading passwords from `/apps/<slug>/etc/mysql/localhost/passwd` (with fallback to `process.env.MYSQL_PASSWORD` in dev/CI).
   - **Official Turbinobash Repositories for AI Agent Reference**:
     * Core Hosting Engine: [https://github.com/xavdp-pro/turbinobash-web](https://github.com/xavdp-pro/turbinobash-web)
     * LXC & Containers Module: [https://github.com/xavdp-pro/turbinobash-web-lx](https://github.com/xavdp-pro/turbinobash-web-lx)

---

## 4. The Architectural Comparison

```
+-----------------------------------------------------------------------------+
|                         THE SHAPER OS MANIFESTO                             |
+-----------------------------------------------------------------------------+
|  OLD IMPERATIVE WAY (Broken)    |  SHAPER OS DECLARATIVE WAY (Manifesto)    |
+---------------------------------+-------------------------------------------+
| • 500 lines of brittle script   | • 4 bullet points of target invariants   |
| • Hardcoded IPs & environments  | • 100% parametric universal inputs        |
| • Breaks on every OS update     | • Autonomous agent adapts & self-heals    |
| • Massive cognitive overload    | • High-signal intent / Zero noise         |
| • Vendor lock-in & licenses     | • Sovereign PRA (3 clocks: cache / rebuild / data) |
+---------------------------------+-------------------------------------------+
```

---

## 5. Living Blueprint: The 4-Step Container Provisioning Intent

### 5.1 Generic LXC Intent
To instantiate any sovereign LXC node (Debian 13) ready for SHAPER OS, nested Podman OCI engines, and private mesh networking:
1. **LXC Base**: Create a Debian 13 LXC container with nested virtualization, unconfined AppArmor profile, and device permissions for `/dev/net/tun` (WireGuard) and `/dev/fuse` (fuse-overlayfs).
2. **OS Environment**: Copy repository `skel/etc/` files (`bash.bashrc`, `inputrc`) to the container's `/etc/`.
3. **Runtime Engines**: Perform a full system upgrade and install `podman`, `crun`, `fuse-overlayfs`, `nodejs`, and `wireguard-tools`.
4. **SSH Access**: Copy the host machine's SSH public key (`~/.ssh/id_*.pub`) into the container's `/root/.ssh/authorized_keys` with restricted `0600` permissions.

### 5.2 Proxmox LXC Blueprint (pct)
When deploying on a Proxmox VE hypervisor:
1. **Instantiate (`pct create`)**: Debian 13 template, unprivileged, features `nesting=1,keyctl=1`, append `/dev/net/tun` and `/dev/fuse` mount entries to `/etc/pve/lxc/<VMID>.conf`, then start.
2. **Push Skeleton (`pct push`)**: Copy `skel/etc/{bash.bashrc,inputrc}` to `/etc/`.
3. **Install Runtime (`pct exec`)**: Upgrade and install `podman`, `crun`, `fuse-overlayfs`, `nodejs`, `wireguard-tools`.
4. **Authorize SSH (`pct push`)**: Inject host `~/.ssh/id_ed25519.pub` into `/root/.ssh/authorized_keys` (chmod 600).

---

## 6. The Multi-Track Parallel Exploration & Distillation Protocol

To maximize innovation velocity without corrupting the canonical standard, SHAPER OS enforces a multi-track fractal workspace model:

1. **The Canonical Master (`SHAPER-OS/`)**: 
   The single source of truth containing certified rules, packages, declarative blueprints, and production Git releases. Never polluted by uncertified experiments.
2. **Parallel Exploration Sandboxes (`UNIV8/`, `UNIV9/`, `UNIV-X/`)**: 
   Independent, disposable workspaces living side-by-side at the root where engineers and AI agents freely experiment, push boundaries, and test edge-cases in parallel without blocking each other.
3. **The 4-Step Distillation Loop**:
   - **Step 1: Free Exploration**: Prototype and stress-test the new concept in `UNIV-X/`.
   - **Step 2: Polish to Perfection**: Refine until 100% solid, verified, and bug-free.
   - **Step 3: Distill the Universal Blueprint**: Extract the 4 declarative invariants and any justified golden snippets.
   - **Step 4: Promote to Standard**: Merge the generic blueprint into `SHAPER-OS/`, deploy to production, and cleanly destroy or archive the completed `UNIV-X/` sandbox.

---

## 7. The Fundamental Duality: Le « Ventre » de KovZu vs La « Voie » Shaper OS

An autonomous agent operating within the Shaper ecosystem must **NEVER confuse what belongs inside its own organism with what must be built as a sovereign tool for the human user**.

```
+-------------------------------------------------------------------------------+
|                       LA DUALITÉ FONDAMENTALE SHAPER OS                       |
+-------------------------------------------------------------------------------+
|   LE « VENTRE » DE KOVZU (L'Organisme)   |   LA « VOIE » SHAPER OS (L'Outil)  |
+------------------------------------------+------------------------------------+
| • C'est ce que nous développons pour     | • C'est ce que l'agent développe   |
|   étendre et enrichir l'agent lui-même   |   comme vrai outil pour l'humain   |
| • Moteur de prompt, plugins voix/STT/TTS | • ERP, CRM, micro-services, APIs   |
| • Gestion des sessions, timelines, auth  | • Briques logicielles pérennes     |
| • Mini-GED souveraine locale (/data/ged) | • Sandboxes isolées Podman (--rm)  |
| • Interface Cockpit `/console` (P2)     | • Volumes dédiés (/data/<slug>)    |
| • Voix opérateur dans `/console` (P2)   | • `market-intelligence`, CRM (P3)  |
| • Reste DANS le corps de KovZu           | • Déployé SUR le système hôte      |
+------------------------------------------+------------------------------------+
```

### 7.1 Le « Ventre » de KovZu : L'Organisme de l'Assistant
* **Définition** : Tout ce qui enrichit l'intelligence, la mémoire, l'ergonomie, la perception vocale et la réactivité de l'assistant Zephir.
* **Ce qui y vit** (all **P2** — see [`PERIMETERS.md`](./PERIMETERS.md)):
  1. Le moteur de prompt, la conscience de contexte (`sessionPrime.js`, `agentSkills.js`).
  2. Le pipeline de voix opérateur **dans `/console`** (Deepgram STT/TTS, Groq ack) — **not** the retired `/talk` route.
  3. L'authentification, les rôles, la gestion des conversations par dossiers et l'archivage.
  4. La Mini-GED locale (`/data/ged/`) et la traçabilité des pièces jointes.
  5. La queue de délégation et le scheduler Maestro (`:8640`, `:8630`).
* **Règle d'or** : Ce qui entre dans le ventre de KovZu ne se transforme **PAS** en un outil tiers externe. Cela fait partie intégrante du corps de l'assistant pour le rendre plus puissant au service de l'humain.

### 7.2 La « Voie » Shaper OS : La Forge d'Outils Pérennes pour l'Humain
* **Définition** : Lorsqu'un utilisateur demande à l'agent de créer un ERP, un CRM, un tableau de bord sur-mesure, un robot d'automatisation ou un service métier, l'agent **ne code jamais cela dans son propre ventre**.
* **Le Protocole d'Exécution de la Voie Shaper OS** :
  1. **Phase 1 : Prototypage en Sandbox Isolé (Zero Pollution)** :
     L'agent lance un conteneur éphémère de calcul via `bash scripts/shaper-sandbox.sh` pour compiler, tester, exécuter des scripts lourds sans risque d'altérer KovZu.
  2. **Phase 2 : Échafaudage de Brique Pérenne Standardisée** :
     L'agent génère une brique autonome via `node scripts/shaper-tool-scaffold.mjs <slug> --port <port> --title "<Nom>"` :
     - Brique conteneurisée : `bricks/brick-<slug>/` et `packages/<slug>-engine/`
     - Définition Quadlet Podman : `/etc/containers/systemd/<univ>-<slug>.container`
     - Port dédié et volume persistant : `/data/<slug>/`
     - Enregistrement de topologie : `topology.json`
  3. **Phase 3 : Déploiement & Pérennité dans le Temps** :
     L'outil dispose de sa propre interface, son propre port, son propre cycle de vie, et perdure indépendamment de l'agent. Il peut être dupliqué d'un client à l'autre selon les lois de modularité fractale.

### 7.3 Règle de Décision Instantanée pour l'Agent AI
Avant toute action, l'agent doit se poser la question :
> **« Est-ce que cette demande concerne mes propres capacités cognitives/vocales/documentaires (Le Ventre de KovZu), ou est-ce un outil de travail pérenne destiné à l'activité de l'humain (La Voie Shaper OS) ? »**
* Si **Ventre** $\rightarrow$ Modifier/étendre les modules internes KovZu (`bricks/brick-helm`, `packages/*`).
* Si **Voie Shaper OS** $\rightarrow$ Utiliser `shaper-sandbox.sh` pour prototyper et `shaper-tool-scaffold.mjs` pour livrer un véritable outil conteneurisé.
