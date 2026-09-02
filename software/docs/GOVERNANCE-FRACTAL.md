# Fractal Governance & SHAPER-OS Conventions

This document formalises the architecture rules, the 4 fractal levels, the naming conventions and the test pyramid that keep the **SHAPER-OS** ecosystem coherent and durable.

---

## 1. The 4 Fractal Abstraction Levels

> **Complement**: the **P1 / P2 / P3** product law is in [`PERIMETERS.md`](./PERIMETERS.md). The levels below describe the **deployment** (package → universe → host → fleet), not the client business.

To avoid any confusion as the system evolves, every action, brick or test must be explicitly attached to its level:

| Level | Designation | Perimeter | Scope & Responsibility | Examples |
| :---: | :--- | :---: | :--- | :--- |
| **0** | **Brick & Package** | P1/P2 | Atomic component, unit-tested (`node:test`). | `@shaper/pkg-vault` (P1), `@shaper/pkg-maestro` (P2), `brick-helm` (P2) |
| **1** | **Universe / Cell** | P1+P2 | Autonomous Podman stack (socle + agentic). **Not** a P3 vertical. | `UNIV8`, `UNIV9` |
| **2** | **Host Node** | infra | LXC / bare-metal carrying the universes. | `<host>-<univ_slug>` |
| **3** | **Fleet / Network** | infra | Mesh, tunnels, public domains. | `ia.example.com` |

### P1 / P2 / P3 mapping (product law)

| Perimeter | Content | Examples |
| :--- | :--- | :--- |
| **P1** | Minimal socle | vault, logger, auth, queue, db |
| **P2** | Agentic + KovZu | maestro, bridges, helm, ged, rag |
| **P3** | Client business tools | market-intelligence, enterprise-chat, univ-sinistre |

---

## 2. Immutable Naming Convention

To keep traceability across Git, Podman, log files and databases:

| Element | Naming rule | Valid example |
|---|---|---|
| **Universe** | `UNIV<N>` (uppercase) | `UNIV8`, `UNIV9` |
| **Universe folder** | `SHAPER-OS/universes/<univ_slug>/` | `universes/_template/` |
| **Model brick** | `brick-<name>` | `brick-helm`, `brick-mariadb`, `brick-vault` |
| **Socle NPM package** | `@shaper/<name>` | `@shaper/pkg-queue`, `@shaper/pkg-maestro`, `@shaper/pkg-db` |
| **Podman image** | `localhost/shaper-<name>:latest` | `localhost/shaper-helm:latest` |
| **Active Podman container** | `<univ_slug>-<brick>` | `<univ_slug>-helm`, `<univ_slug>-mariadb`, `<univ_slug>-vault` |
| **Standardised ports** | `:8610` Vault<br>`:8620` Logger<br>`:8630` Maestro<br>`:8640` Queue<br>`:8650` Helm<br>`:4440` Bridge OpenCode<br>`:3306` MariaDB | Fixed port per universe or localhost bind |

---

## 3. Mandatory Test Pyramid

No component can be integrated without 100% validation on its pyramid:

1. **Level 1 — Package unit tests** (`node --test test/*.test.js`):
   - Ultra-fast execution (< 1s), zero external dependency, validation of pure functions.
2. **Level 2 — Integration tests & PRA scenarios**:
   - Full cold boot: Vault ➔ Logger ➔ MariaDB ➔ Queue ➔ Maestro ➔ Bridge ➔ Helm.
3. **Level 3 — E2E tests on the live containerised stack**:
   - Live validation of the Podman containers, the HTTP/SSE routes, the tokens and the agent injection.

---

## 4. Multi-Level Backup Policy (container → files → DB → git → S3)

With **all five**, we are covered. A missing level = a hole. The turbinobash-web spirit (`tb app sudo/backup`), adapted to **Podman / Shaper OS**.

1. **Infra — whole container**: LXC/CT snapshot (Proxmox / ZFS / vzdump). External safety net.
2. **Files — persistent volumes as `tar.bz2`**: only the Podman bind-mounts (`<univ>/sav/*`, not the overlay, not `nosav/`, not the image cache). Same gesture as the turbinobash app backup.
3. **Database**: MariaDB dump (and a Qdrant snapshot if needed) — not just a hot tar of the datadir.
4. **Git**: immutable tags of the code. Git is not a backup of business data.
5. **S3 / R2**: encrypted off-site copy of the `tar.bz2` archives and the dumps.

**Rollback**: tagged image + `tar.bz2` extract of the volumes + dump restore — then a TEST from scratch to prove it, not "it worked on the hot machine".
