# Opt-in functional Vault runtime candidate

Build the base package OCI artifact from the exact source revision first. Build
`Containerfile.durable` with **only this brick directory** as context, supplying
pinned `SHAPER_BASE_IMAGE` and `VAULT_RUNTIME_IMAGE` plus the source revision.
Vault/Logger packages arrive only through that base artifact. The confined SQL
driver is declared in `durable-package.json` and its full locked closure; `npm ci`
installs it inside the owning image. This does not modify the legacy recipe.

Supply an explicit universe identifier and these **owning-function-only** binds:

- `/apps/vault/etc`, `/apps/vault/sav`, `/apps/vault/log` and
  `/apps/vault/nosav/mysql`: Vault UID/GID 10001, directories mode `0700`.
- `etc/owner`: same owner/mode; `master-key` and `token`: separately generated
  64-character hexadecimal values, regular single-link files mode `0600`.
- `etc/mysql/localhost/passwd`: generated once if absent, owner `vault`, `0600`;
  retained credentials must already satisfy that contract.
- Writable ephemeral `/tmp` for the owning database, excluded from backups.

No source or secret bind may replace the packaged application or its SQL driver.
The root bootstrap verifies every declared ancestor and existing private path
before mutation, refuses symlink/foreign directories and unknown existing data,
and creates only absent paths beneath validated parents. Initial SQL setup uses
root socket authentication; application Linux/SQL/database identities are all
`vault`. The application checks exact required table/column grants and rejects
broad/global/schema/role grants rather than silently removing them. Its root
filesystem must remain read-only; DB and private credentials persist through
owning bind mounts. Instance data and the matching scoped key require paired
backup/restore. The source-format marker records function/scope only and does
not attest an independent anti-rollback epoch.

The new server binds **127.0.0.1 inside the function**. It defaults to port 8610;
`VAULT_OWNER_PORT` may select an explicit unprivileged port for a separately
qualified coexistence trial. It does not move or proxy the legacy listener.
The installed base-owner runtime exposes five POST methods:
`/api/durable-owner/{prepareImmutable,tombstoneImmutable,findReceipt,verifyReceipt,getPrepared}`.
Bearer authentication is mandatory; keys/payloads/receipts are request bodies,
never URLs. Replies are bounded/no-store and failure messages never include
provider, SQL or secret details. The client preserves the entire signed receipt,
refuses redirects and insecure non-loopback HTTP, and bounds response bytes and
request duration. Existing file routes are not mounted by this new variant.

`GET /api/health` reports only a listening process and protocol, never delivery
acceptance. Database process death exits the supervised function; later query or
connection failures return sanitized HTTP 503 while the listening Node process
may remain alive. Cold readiness follows the
private schema/identity/grant checks; function verification still exercises all
five actual routes and downstream SQL state.

`test/helpers/qualify-functional-podman.py` in pkg-vault is an explicit native
qualification, with its matching `functional-http.mjs` driver mounted read-only.
It uses fresh synthetic keys/data, no network or published ports, one CPU,
512 MiB and a read-only root; all application tests run as `vault`. It compares
all three table digests through container restart and fresh dump/restore,
refuses root/foreign credentials and excess grants, and exercises missing/bad
key, ancestor symlink, foreign directory and unknown-data startup failures.
Outside target bytes/metadata must remain unchanged. Only exact UUID-labelled
owned containers and synthetic credential state are removed; unrelated running
IDs must remain identical.

This is an isolated opt-in candidate. No old Vault, key, API or state is
migrated. A distributed peer-database fence/lease, authenticated external TLS
channel, operator key custody, hardware power-loss durability, independent
restore attestation and real rollout remain separate release gates. Disposable
QA storage qualifies container lifecycle persistence, not host-reboot storage.


## Additive guard-schema compatibility

The owning administrator installs the additive five-table schema without
rewriting the existing epoch/resource/operation records. It adds only declared
transition-column UPDATE grants for fences and guards; immutable bindings and
sequence/identity fields receive no UPDATE. Application readiness rejects table
or schema/global UPDATE, grant option, foreign privileges, unexpected columns,
missing required uniqueness keys and non-InnoDB tables. No unsafe privilege is
silently revoked or washed. Existing private key/token/password/source marker
bytes and no-symlink/owner-only admission remain unchanged.

The functional qualifier's optional `--legacy-image` uses a pinned historical
c67b0df candidate ONLY as a disposable synthetic fixture: seed its three-table
state, stop that owned container, start the upgraded image with the same owned
state, verify all three historical table digests and readers, then repeat a
restart. It compares private custody/source-marker bytes without printing them.
The new source's fresh restart/restore checks compare all five tables. Guard HTTP
methods must continue returning 404. This is bootstrap compatibility, not a
mounted guard service or an independent restore freshness witness.

## Additive current disclosure source

The owning schema now has six tables. Administrative metadata preflight admits
only exact known empty/three/five/six-table shapes before additive migration.
Existing private path, key and source guards remain mandatory; application
readiness requires six-table grants/keys/engines. Disclosure source is cold-imported
but no guard/disclosure route is mounted. Programmatic disclosure requires the
explicit trusted/freshness-configured owner subclass.
See [current disclosure](../../packages/pkg-vault/DURABLE-DISCLOSURE-OWNER.md).
Native Unix-socket proof is not a new owning Podman image or installed migration;
previous five-table image evidence remains historical.
