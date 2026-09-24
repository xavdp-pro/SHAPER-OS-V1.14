#!/usr/bin/env bash
# Intent: software/packages/pkg-db/INTENT.md
#
# Materialises one functional unit's private MariaDB (Rules 4 and 26), inside
# the universe container, through the administrative path only:
#
#   <slug> = Linux account = MariaDB account = MariaDB database
#   <apps-root>/<slug>/etc/mysql/localhost/passwd   0600, owned by <slug>
#   <apps-root>/<slug>/sav/mariadb                  the unit's datadir (backed up)
#   <apps-root>/<slug>/nosav/run/mysqld             the unit's socket directory
#
# <apps-root> is Rule 4's Turbinobash root inside the universe container (the
# runtime layout, not a tree of this repository); it is a parameter.
#
# The MariaDB container runs with --network none and --skip-networking: the
# only way in is the socket directory, which the universe mounts into this
# unit's own application container and no other. Root authenticates by
# unix_socket from inside the MariaDB container, never by password, and no
# network root or image default account survives initialisation. The
# application account receives SELECT, INSERT, UPDATE and DELETE on its own
# database; the schema is read from the unit's image and applied as root.
#
# Idempotent: a second run keeps the datadir, the password and the rows, and
# re-applies the (idempotent) schema. Every start is a fresh container over
# the same volume (Rule 11, a brick is rebuilt, not repaired).
#
# Usage (every value is a parameter, Rule 0B):
#   provision-unit-mariadb.sh --universe <slug> --slug <unit> --uid <uid> \
#     --mariadb-image <ref> --unit-image <ref> --schema <path-in-unit-image> \
#     [--apps-root <path>]   (default: the Turbinobash root, Rule 4)
set -euo pipefail

APPS_ROOT=/apps
UNIVERSE= SLUG= UNIT_UID= MARIADB_IMAGE= UNIT_IMAGE= SCHEMA_PATH=
while (( $# )); do
  case "$1" in
    --universe) UNIVERSE="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --uid) UNIT_UID="$2"; shift 2 ;;
    --mariadb-image) MARIADB_IMAGE="$2"; shift 2 ;;
    --unit-image) UNIT_IMAGE="$2"; shift 2 ;;
    --schema) SCHEMA_PATH="$2"; shift 2 ;;
    --apps-root) APPS_ROOT="$2"; shift 2 ;;
    *) echo "[provision-unit-mariadb] unknown argument: $1" >&2; exit 2 ;;
  esac
done
for v in UNIVERSE SLUG UNIT_UID MARIADB_IMAGE UNIT_IMAGE SCHEMA_PATH; do
  [[ -n "${!v}" ]] || { echo "[provision-unit-mariadb] --${v,,} is required" >&2; exit 2; }
done
[[ "$SLUG" =~ ^[a-z][a-z0-9_]{0,31}$ ]] || { echo "[provision-unit-mariadb] invalid functional slug: $SLUG" >&2; exit 2; }
[[ "$UNIT_UID" =~ ^[0-9]+$ ]] && (( UNIT_UID > 1000 )) || { echo "[provision-unit-mariadb] --uid must be a fixed number above 1000" >&2; exit 2; }

say() { echo "[provision-unit-mariadb:$SLUG] $*"; }
DB_CTR="${UNIVERSE}-ctr-${SLUG}-mariadb"
UNIT_DIR="$APPS_ROOT/$SLUG"
PASSWD="$UNIT_DIR/etc/mysql/localhost/passwd"
DATADIR="$UNIT_DIR/sav/mariadb"
RUNDIR="$UNIT_DIR/nosav/run/mysqld"
INIT_SECRET="$UNIT_DIR/nosav/mariadb-init-root"

# ── 1. The functional account: one name, one fixed uid ──────────────────────
if getent passwd "$SLUG" >/dev/null; then
  have="$(id -u "$SLUG")"
  [[ "$have" == "$UNIT_UID" ]] || { echo "[provision-unit-mariadb] account $SLUG exists with uid $have, the unit needs $UNIT_UID — halt, a human decides" >&2; exit 3; }
else
  getent group "$SLUG" >/dev/null || groupadd --system --gid "$UNIT_UID" "$SLUG"
  useradd --system --uid "$UNIT_UID" --gid "$UNIT_UID" --no-create-home --home-dir "$UNIT_DIR" --shell /usr/sbin/nologin "$SLUG"
  say "account $SLUG created with uid $UNIT_UID"
fi

# ── 2. The Turbinobash layout, owned file by file (Rule 11) ─────────────────
MYSQL_UID="$(podman run --rm --network none --entrypoint id "$MARIADB_IMAGE" -u mysql)"
MYSQL_GID="$(podman run --rm --network none --entrypoint id "$MARIADB_IMAGE" -g mysql)"
install -d -m 0755 -o root -g root "$UNIT_DIR" "$UNIT_DIR/etc" "$UNIT_DIR/etc/mysql" "$UNIT_DIR/sav" "$UNIT_DIR/nosav" "$UNIT_DIR/nosav/run"
install -d -m 0700 -o "$SLUG" -g "$SLUG" "$UNIT_DIR/etc/mysql/localhost"
install -d -m 0750 -o "$SLUG" -g "$SLUG" "$UNIT_DIR/log"
install -d -m 0700 -o "$MYSQL_UID" -g "$MYSQL_GID" "$DATADIR"
# The socket directory admits MariaDB (owner) and the unit's own group, and no
# other account of the universe container: the socket is 0777 by design.
install -d -m 0750 -o "$MYSQL_UID" -g "$UNIT_UID" "$RUNDIR"
chown "$MYSQL_UID:$UNIT_UID" "$RUNDIR"; chmod 0750 "$RUNDIR"
# The etc/mysql directory must let the account reach its own file and nobody else.
chown "$SLUG:$SLUG" "$UNIT_DIR/etc/mysql"; chmod 0710 "$UNIT_DIR/etc/mysql"

# ── 3. The application password: generated once, never logged ──────────────
if [[ ! -s "$PASSWD" ]]; then
  ( umask 077; openssl rand -hex 32 > "$PASSWD" )
  say "application password generated"
fi
chown "$SLUG:$SLUG" "$PASSWD"; chmod 0600 "$PASSWD"

# ── 4. The unit's MariaDB: born once, then restarted over the same datadir ──
wait_root() {
  local tries=90
  while (( tries-- )); do
    podman exec "$DB_CTR" mariadb -uroot -e 'SELECT 1' >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "[provision-unit-mariadb] $DB_CTR never accepted root over unix_socket" >&2
  podman logs --tail 30 "$DB_CTR" >&2 || true
  return 1
}
run_db() {
  podman run -d --name "$DB_CTR" --replace --network none --restart=always --stop-timeout 60 \
    -v "$DATADIR:/var/lib/mysql:Z" -v "$RUNDIR:/run/mysqld:z" "$@" \
    "$MARIADB_IMAGE" --skip-networking --socket=/run/mysqld/mysqld.sock \
    --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null
}
stop_db() {
  podman stop -t 60 "$DB_CTR" >/dev/null 2>&1 || true
  podman rm -f "$DB_CTR" >/dev/null 2>&1 || true
}

if [[ ! -d "$DATADIR/mysql" ]]; then
  # First birth. The image demands a root password to initialise; it is read
  # by the MariaDB account from a file only that account can read, used once to
  # lock root to unix_socket, then destroyed. An unreadable file leaves root
  # with NO password — measured on this path — so the file is owned by mysql.
  stop_db
  ( umask 077; openssl rand -hex 32 > "$INIT_SECRET" )
  chown "$MYSQL_UID:$MYSQL_GID" "$INIT_SECRET"; chmod 0400 "$INIT_SECRET"
  run_db -v "$INIT_SECRET:/run/secrets/mariadb-root:ro,Z" \
    -e MARIADB_ROOT_PASSWORD_FILE=/run/secrets/mariadb-root -e MARIADB_ROOT_HOST=localhost
  tries=120
  until podman exec "$DB_CTR" sh -c 'MYSQL_PWD="$(cat /run/secrets/mariadb-root)" mariadb -uroot -e "SELECT 1"' >/dev/null 2>&1; do
    (( tries-- )) || { echo "[provision-unit-mariadb] first initialisation of $DB_CTR did not finish" >&2; podman logs --tail 30 "$DB_CTR" >&2; exit 4; }
    sleep 1
  done
  podman exec -i "$DB_CTR" sh -c 'MYSQL_PWD="$(cat /run/secrets/mariadb-root)" mariadb -uroot' <<'SQL'
ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket;
DROP USER IF EXISTS 'root'@'127.0.0.1', 'root'@'::1', 'root'@'%';
DROP USER IF EXISTS 'healthcheck'@'localhost', 'healthcheck'@'127.0.0.1', 'healthcheck'@'::1';
FLUSH PRIVILEGES;
SQL
  stop_db
  shred -u "$INIT_SECRET" 2>/dev/null || rm -f "$INIT_SECRET"
  rm -f "$DATADIR/.my-healthcheck.cnf"
  say "MariaDB initialised; root locked to unix_socket, default accounts removed"
fi

run_db
wait_root

# ── 5. Database, account and least privilege, converged every run ──────────
# The password travels on stdin inside the SQL, never on a command line.
pw="$(<"$PASSWD")"
[[ "$pw" =~ ^[0-9a-f]{64}$ ]] || { echo "[provision-unit-mariadb] $PASSWD is not a generated password; halt, a human decides" >&2; exit 5; }
podman exec -i "$DB_CTR" mariadb -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$SLUG\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$SLUG'@'localhost' IDENTIFIED BY '$pw';
ALTER USER '$SLUG'@'localhost' IDENTIFIED BY '$pw';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '$SLUG'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`$SLUG\`.* TO '$SLUG'@'localhost';
FLUSH PRIVILEGES;
SQL
unset pw

# ── 6. The schema, from the image the unit actually runs ────────────────────
podman run --rm --network none --entrypoint cat "$UNIT_IMAGE" "$SCHEMA_PATH" \
  | podman exec -i "$DB_CTR" mariadb -uroot "$SLUG"
version="$(podman exec "$DB_CTR" mariadb -uroot -N -B "$SLUG" -e "SELECT version FROM schema_meta WHERE unit='$SLUG'")"
[[ -n "$version" ]] || { echo "[provision-unit-mariadb] $SCHEMA_PATH did not record schema_meta for $SLUG" >&2; exit 6; }

say "ready: $SLUG@localhost on database $SLUG, schema version $version, socket $RUNDIR/mysqld.sock"
