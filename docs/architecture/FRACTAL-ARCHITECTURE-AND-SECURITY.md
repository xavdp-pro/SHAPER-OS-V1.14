# 🌌 SHAPER OS — Fractal Architecture & Sovereign Security Model

> **Reference status:** Normative Architecture & Security Document  
> **Compliance:** Rules 23 (Vitals/Probes), 27 (Alerting), 36 (Authority & Isolation)

---

## 1. Vision & Fundamental Principle of Fractality

In **SHAPER OS**, every level of the organisation is an autonomous, self-similar universe.  
A universe at a given level knows only its direct children and its immediate parent. It has no arbitrary power over the global operating system.

```mermaid
flowchart TD
    N0["🏢 <b>LEVEL 0 — Global SaaS</b><br/>accounts, plans, signed quotas<br/>deployment order queue"]
    N1A["🚀 <b>LEVEL 1A — Host spawner</b><br/>bare-metal A<br/>rootless podman + DNS connector"]
    N1B["🚀 <b>LEVEL 1B — Host spawner</b><br/>VPS B<br/>rootless podman + DNS connector"]
    N2A["🎛️ <b>LEVEL 2A — Fleet manager</b><br/>2 active children out of 5"]
    N2B["🎛️ <b>LEVEL 2B — Fleet manager</b><br/>4 active children out of 10"]
    C1["LEVEL 3 — child 01"]
    C2["LEVEL 3 — child 02"]
    C3["LEVEL 3 — child 03"]
    C4["LEVEL 3 — child 04"]

    N0 -- "🔄 PULL flow · zero open port" --> N1A
    N0 -- "🔄 PULL flow · zero open port" --> N1B
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

> Every name at level 3 is supplied by the operator. This repository ships none.

---

## 2. The Sovereign Security Model: The "PULL Worker" Model

SHAPER OS security rests on a categorical refusal of root access and open ports.

```mermaid
flowchart LR
    subgraph common["❌ Common method — major vulnerability"]
        direction LR
        W1["Cloud web manager"] -- "root SSH · port 22 open" --> H1["Host server"]
    end

    subgraph shaper["✅ SHAPER OS method — Zero Trust"]
        direction LR
        H2["Host server<br/><i>100% closed</i>"] -- "OUTBOUND connection<br/>polling / SSE" --> W2["Cloud web manager"]
    end

    classDef bad fill:#161b22,stroke:#f85149,color:#e6edf3
    classDef good fill:#0d1117,stroke:#3fb950,color:#e6edf3
    class W1,H1 bad
    class W2,H2 good
```

In the first case, a compromised web tier gives total control of the server. In
the second, the host polls the task queue and exposes no inbound port.

### Why this model is inviolable:
1. **Zero listening port open to the Internet:** The VPS / host server has no SSH port or administration API exposed to the public.
2. **Initiative always local:** It is the host's engine that fetches its orders from the SaaS (outbound HTTPS request).
3. **No system code injection possible:** The host server accepts only strict, typed mission orders (`SPAWN_STORE`, `STOP_STORE`, `BACKUP_STORE`).

---

## 3. The Host's SHAPER OS Universe (Host Spawner Engine)

To execute container creation orders, the host server has **its own SHAPER OS universe** made of the native bricks:

| SHAPER brick | Role in the Host Spawner |
| :--- | :--- |
| **`@shaper/pkg-queue`** | Schedules store creations and destructions in a prioritised queue with load management. |
| **`@shaper/pkg-logger`** | Records every infrastructure event in an immutable JSONL journal (`log/events.jsonl`). |
| **`@shaper/pkg-maestro`** | Local conductor that dequeues the Queue, runs the Podman scripts and checks compliance. |
| **`@shaper/pkg-vault`** | Encrypts and isolates the Cloudflare API keys, the MariaDB passwords and the licence certificates. |
| **`@shaper/pkg-supervisor`** | Watches the RAM, CPU and disk usage of the whole container fleet. |

---

## 4. The Principle of Least Privilege & Rootless Podman

1. **Rootless Podman (Zero Root):**
   * All containers, whatever they are, run under a dedicated unprivileged user.
   * Even with a critical zero-day flaw in the hosted application, the attacker stays confined to the container with no rights on the host system.
2. **Multi-Tenancy Network Isolation:**
   * Every child universe has its own containerised subnet.
   * Child universe `01` can neither read nor write the database of child universe `02`.

---

## 5. The Automated Lifecycle (Zero-Touch Provisioning)

When a `SPAWN_CHILD` order is validated by the host's Queue:

```mermaid
flowchart LR
    A["1 · Allocation<br/><i>free ports, vol-* volumes</i>"]
    B["2 · Data<br/><i>persistence container</i>"]
    C["3 · Application<br/><i>rendering container</i>"]
    D["4 · Bootstrap<br/><i>configuration without a human</i>"]
    E["5 · Ingress<br/><i>DNS and Zero Trust tunnel</i>"]
    F["6 · Ready<br/><i>child universe online</i>"]

    A --> B --> C --> D --> E --> F

    classDef s fill:#0d1117,stroke:#3fb950,color:#e6edf3
    class A,B,C,D,E,F s
```

1. **Automatic bootstrap:** the child's application is installed and configured without human intervention.
2. **Specialisation:** the catalogue's business brick is enabled and parameterised from the child's manifest.
3. **Edge wiring:** the DNS provider's API binds the public name to the Zero Trust tunnel without a service restart.

---

## 6. Quota Management & Economic Model (5, 10, 20 Stores)

* The Grandfather SaaS injects into the Father Manager's Vault a cryptographic quota token (`max_stores: 5`).
* The Father Manager refuses any further creation if `store_count >= max_stores`.
* On a plan upgrade, the SaaS issues an updated token that instantly unlocks the new slots in the merchant interface.

---

*SHAPER OS V1.8 reference document — Fractal Architecture & Sovereign Security.*
