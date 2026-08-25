# Services

Images are built from `software/bricks/`. The universe only **references** them.  
Why: [`CONCEPTS.md`](./CONCEPTS.md).

## Local DEV (start here)

| Service | Port | Role |
| :--- | :---: | :--- |
| Vault | 8610 | Encrypted secrets |
| Logger | 8620 | Audit log |
| OpenCode bridge | 4440 | Free AI CLI |
| Queue | 8640 | Background jobs |
| Maestro | 8630 | Scheduler |

Boot: vault ∥ logger → bridge → queue → maestro  
(`manifest.json` `bootOrder` aligned with `software/topology.json`).

## Public + voice (after local)

| Service | Port | Role |
| :--- | :---: | :--- |
| Helm | 8650 | `/console` + voice |
| cloudflared | — | HTTPS to Helm |

Voice stays in `/console`.

## Optional later

Operator document hub, vector search, extra AI CLI. Not required for first DEV proof.

```bash
cd software && bash scripts/build-all-bricks.sh
```

PROD uses **tagged** images, not an unnamed `latest`, once you follow [`LIFECYCLE.md`](./LIFECYCLE.md).
