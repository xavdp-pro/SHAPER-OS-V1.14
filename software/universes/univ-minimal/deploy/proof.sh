#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#proof
# Proves univ-minimal from outside its units: the Rule 26 gate for every
# functional unit's private MariaDB, then one real effect per unit, read back
# from that unit's database through the administrative path — never from the
# unit's own answer alone.
#
# Exit 0 only when every check passed. Nothing here writes to a unit's
# database except through the unit's own API, and every job it creates ends in
# a terminal state.
set -uo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then set -a; source "$UNIV/cfg-univ-minimal.env"; set +a
fi
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
: "${SHAPER_MARIADB_IMAGE:?not set}"
RUN_ID="proof-$(date -u +%Y%m%dT%H%M%SZ)-$$"

PASS=0; FAILS=0
ok()   { PASS=$((PASS + 1)); printf '  OK     %-22s %s\n' "$1" "$2"; }
fail() { FAILS=$((FAILS + 1)); printf '  FAIL   %-22s %s\n' "$1" "$2"; }
check() { local name="$1" detail="$2"; shift 2; if "$@"; then ok "$name" "$detail"; else fail "$name" "$detail"; fi; }
section() { printf '\n── %s %s\n' "$1" "$(printf '─%.0s' $(seq 1 $((70 - ${#1}))))"; }

# Root path into a unit's database: unix_socket from inside its own container.
# Queries only (-e): no -i, so the proof never reads the caller's standard input.
rootsql() { podman exec "${UNIVERSE}-ctr-$1-mariadb" mariadb -uroot -N -B "${@:2}"; }

# Application path into a unit's database, with the password read from its file
# on standard input — never on a command line (Rule 12).
#   sql_as <db-unit> <account> <passwd-file> <database-or-empty> <sql>
sql_as() {
  podman exec -i "${UNIVERSE}-ctr-$1-mariadb" sh -c \
    'read -r pw; MYSQL_PWD="$pw" exec mariadb -S /run/mysqld/mysqld.sock -u "$1" -N -B ${2:+--database="$2"} -e "$3"' \
    _ "$2" "$4" "$5" < "$3" 2>&1
}
# The refusal is read from the client's message, never from a pipeline status:
# under pipefail a refused client (exit 1) would hide a matching grep.
denied_as() { local out; out="$(sql_as "$@")"; grep -q 'denied' <<<"$out"; }

mapfile -t UNITS < <(jq -r '.bootOrder[][] as $b | .bricks[$b].database.slug' "$MANIFEST")
declare -A UID_OF PORT_OF
for b in $(jq -r '.bootOrder[][]' "$MANIFEST"); do
  s="$(jq -r --arg b "$b" '.bricks[$b].database.slug' "$MANIFEST")"
  UID_OF[$s]="$(jq -r --arg b "$b" '.bricks[$b].database.uid' "$MANIFEST")"
  PORT_OF[$s]="$(jq -r --arg b "$b" '.bricks[$b].port' "$MANIFEST")"
done

# ── The Rule 26 gate, unit by unit ──────────────────────────────────────────
gate_unit() {
  local s="$1" uid="${UID_OF[$1]}" db="${UNIVERSE}-ctr-$1-mariadb" app="${UNIVERSE}-ctr-$1"
  local rundir="$APPS_ROOT/$s/nosav/run/mysqld" passwd="$APPS_ROOT/$s/etc/mysql/localhost/passwd"
  section "$s — private MariaDB (Rules 4 and 26)"

  check "$s-db-running" "$db is running" \
    test "$(podman inspect -f '{{.State.Running}}' "$db" 2>/dev/null)" = true
  check "$s-db-no-network" "$db has --network none" \
    test "$(podman inspect -f '{{.HostConfig.NetworkMode}}' "$db" 2>/dev/null)" = none
  check "$s-db-skip-net" "@@skip_networking = 1" \
    test "$(rootsql "$s" -e 'SELECT @@skip_networking' 2>/dev/null)" = 1
  check "$s-db-persistent" "datadir is $APPS_ROOT/$s/sav/mariadb" \
    bash -c "podman inspect -f '{{range .Mounts}}{{.Source}}={{.Destination}} {{end}}' '$db' | grep -q '$APPS_ROOT/$s/sav/mariadb=/var/lib/mysql'"

  local accounts expected
  accounts="$(rootsql "$s" -e "SELECT CONCAT(user,'@',host,':',plugin) FROM mysql.user ORDER BY 1" 2>/dev/null | tr '\n' ' ')"
  expected="mariadb.sys@localhost:mysql_native_password root@localhost:unix_socket $s@localhost:mysql_native_password "
  expected="$(tr ' ' '\n' <<<"$expected" | sed '/^$/d' | sort | tr '\n' ' ')"
  accounts="$(tr ' ' '\n' <<<"$accounts" | sed '/^$/d' | sort | tr '\n' ' ')"
  check "$s-db-accounts" "exactly root (unix_socket), mariadb.sys and $s" test "$accounts" = "$expected"

  local grants
  grants="$(rootsql "$s" -e "SHOW GRANTS FOR '$s'@'localhost'" 2>/dev/null | sed 's/ IDENTIFIED BY PASSWORD.*//' | tr '\n' '|')"
  check "$s-db-least-priv" "SELECT, INSERT, UPDATE, DELETE on \`$s\`.* and nothing else" \
    test "$grants" = "GRANT USAGE ON *.* TO \`$s\`@\`localhost\`|GRANT SELECT, INSERT, UPDATE, DELETE ON \`$s\`.* TO \`$s\`@\`localhost\`|"

  check "$s-db-schema" "schema_meta records $s" \
    test -n "$(rootsql "$s" "$s" -e "SELECT version FROM schema_meta WHERE unit='$s'" 2>/dev/null)"

  check "$s-passwd" "$passwd is 0600 and owned by $s" \
    test "$(stat -c '%a %U' "$passwd" 2>/dev/null)" = "600 $s"

  check "$s-app-account" "$app runs as $s (uid $uid)" \
    test "$(podman exec "$app" id -u 2>/dev/null)" = "$uid"
  check "$s-app-connected" "$s@localhost holds a live session on $s" \
    test "$(rootsql "$s" -e "SELECT COUNT(*) FROM information_schema.processlist WHERE user='$s' AND db='$s'" 2>/dev/null || echo 0)" -ge 1

  # Nobody else can reach this socket: no other unit's container mounts it.
  local other leaks=""
  for other in "${UNITS[@]}"; do
    [[ "$other" == "$s" ]] && continue
    podman inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "${UNIVERSE}-ctr-$other" "${UNIVERSE}-ctr-$other-mariadb" 2>/dev/null \
      | tr ' ' '\n' | grep -qx "$rundir" && leaks+="$other "
  done
  check "$s-socket-private" "no other unit's container mounts $rundir" test -z "$leaks"

  # Another unit's credential is refused by this unit's database.
  local refused=0 tried=0 out
  for other in "${UNITS[@]}"; do
    [[ "$other" == "$s" ]] && continue
    tried=$((tried + 1))
    out="$(sql_as "$s" "$other" "$APPS_ROOT/$other/etc/mysql/localhost/passwd" "" "SELECT 1")"
    grep -q 'Access denied' <<<"$out" && refused=$((refused + 1))
  done
  check "$s-foreign-refused" "$refused/$tried other units' credentials refused" test "$refused" -eq "$tried"

  # Its own credential reaches its own database and nothing else.
  check "$s-own-cred-scope" "$s cannot read the mysql system database" \
    denied_as "$s" "$s" "$passwd" "" "SELECT 1 FROM mysql.user LIMIT 1"
  check "$s-no-ddl" "$s cannot create a table" \
    denied_as "$s" "$s" "$passwd" "$s" "CREATE TABLE proof_ddl (i INT)"

  # The application's uid cannot become root through its socket.
  check "$s-app-not-root" "uid $uid is refused as MariaDB root" \
    bash -c "podman run --rm --network none --user $uid:$uid -v '$rundir:/run/mysqld:z' '$SHAPER_MARIADB_IMAGE' mariadb -S /run/mysqld/mysqld.sock -uroot -e 'SELECT 1' 2>&1 | grep -q 'Access denied'"
}

section "universe — no database listens on a network"
check "no-tcp-mariadb" "no mariadbd socket in ss -ltn, no :3306" \
  bash -c "! ss -ltnpH | grep -qE 'mariadbd|:3306 '"
check "restart-on-boot" "podman-restart.service is enabled" \
  bash -c "systemctl is-enabled podman-restart.service 2>/dev/null | grep -qx enabled"

for s in "${UNITS[@]}"; do gate_unit "$s"; done

# ── One real effect per unit, read back through the root path ──────────────
# shellcheck source=/dev/null
[[ -f "$UNIV/deploy/proof-effects.sh" ]] && source "$UNIV/deploy/proof-effects.sh"

printf '\n%s: %d checks passed, %d failed (run %s)\n' "$UNIVERSE" "$PASS" "$FAILS" "$RUN_ID"
(( FAILS == 0 ))
