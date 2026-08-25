> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

# Brick: MariaDB

## 1. Declarative Objective

Provide **one relational database per universe**, isolated at the container and
storage level, for universes whose business data does not fit a file or a vector
store.

## 2. Invariants

1. **One database per universe. Never shared.** Two universes never read each
   other's tables, and a child never reaches a parent's database (Rule 26).
2. **Credentials come from Vault.** No password in a Containerfile, a compose
   file, an environment default, or `init.sql`.
3. **Snapshot before any migration.** A data-bearing change is not
   canary-able: take the snapshot first, then migrate, then verify (Rule 30).
4. **The data lifecycle is declared, not assumed.** Retention, backup level and
   destruction rules are stated in the universe that owns the data (Rules 16,
   31).
5. **Destroying a universe never destroys its data as a side effect.** Volumes
   outlive containers by design (Principle 9).
6. **Never a production mailbox, never production data, in DEV or TEST**
   (Rule 9).

## 3. Specialisation Points

| Parameter | Meaning |
| :--- | :--- |
| `MARIADB_DATABASE` | Database name — follows the universe slug (Rule 1) |
| `MARIADB_USER` / `MARIADB_PASSWORD` | Injected from Vault at start, never baked into the image |
| `init.sql` | Schema seed. Idempotent: it must be safe to run against an existing volume |
| Volume mount | Declared per universe on a dedicated path (`/data/<univ_slug>/`) |

## 4. Proof of Correct Operation

The brick is correct when: the database answers on its private address only, the
credentials came from Vault, a restart preserves the data, and a restore from the
declared backup produces the same content (Rule 16, three recovery clocks in
[`../../../docs/human/LIFECYCLE.md`](../../../docs/human/LIFECYCLE.md)).

---

## Cognition

> Scales and semantics: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Storage and query execution are deterministic. A model must never sit between a query and its result, and never in the path of a credential.
