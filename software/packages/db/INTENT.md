# Package: @shaper/db

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Reusability**: Consumed on-demand by apps that declare relational state — agent decides when to provision

---

## 1. Declarative Objective

Turbinobash MariaDB config resolver — `user = database = <app-slug>`, password from passwd file or env fallback.

---

## 2. Universal Invariants (Parameterized)

1. **Convention**: `user = database = <app-slug>`. Slug inferred from `/apps/<slug>/` path or `APP_NAME`.
2. **Password**: Production reads `/apps/<app-slug>/etc/mysql/localhost/passwd`. Dev/CI via `MYSQL_*` env vars.
3. **On-Demand**: Agent provisions DB only when the task requires relational state — via `scripts/provision-app-db.sh`.
4. **Zero Dependencies**: Config resolution only. SQL driver (`mysql2`) stays in the consuming app.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Provision**: `provision-app-db.sh --universe immo --app-slug crm-immo`
* **Config**: `buildDbConfig({ appSlug: 'crm-immo' })`
