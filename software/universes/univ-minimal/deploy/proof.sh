#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#proof
# Proves univ-minimal from outside its units: the Rule 26 inventory of every
# functional unit — the application and its MariaDB server observed as two
# processes in the unit's one container, the private socket, no TCP listener,
# one name for account and database, refused DDL, the filesystem rights the
# application does not have — then one real effect per unit, read back from
# that unit's database through the root path, never from the unit's own answer.
#
# Each unit's identity is checked too: the parent's pin and bootstrap where
# the unit reads them, its current incarnation live in Vault, and no evidence
# owed to Logger for long; after the effects, a credential Vault issued to that
# incarnation once the unit had evidence to deliver (an idle unit asks for
# none). Logger is called under a credential Vault issues to the proof's own
# identity (unit "proof").
#
# Exit 0 only when every check passed. Nothing here writes to a unit's
# database except through the unit's own API, and every job it creates ends in
# a terminal state. Restart, recreation and the coordinated stop are proven by
# deploy/lifecycle-drill.sh; restore into a fresh volume by deploy/restore-drill.sh.
set -uo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then set -a; source "$UNIV/cfg-univ-minimal.env"; set +a
fi
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
RUN_ID="proof-$(date -u +%Y%m%dT%H%M%SZ)-$$"
# shellcheck source=/dev/null
source "$UNIV/deploy/unit-probes.sh"

PASS=0; FAILS=0
ok()   { PASS=$((PASS + 1)); printf '  OK     %-24s %s\n' "$1" "$2"; }
fail() { FAILS=$((FAILS + 1)); printf '  FAIL   %-24s %s\n' "$1" "$2"; }
check() { local name="$1" detail="$2"; shift 2; if "$@"; then ok "$name" "$detail"; else fail "$name" "$detail"; fi; }
section() { printf '\n── %s %s\n' "$1" "$(printf '─%.0s' $(seq 1 $((70 - ${#1}))))"; }

mapfile -t UNITS < <(jq -r '.bootOrder[][] as $b | .bricks[$b].database.slug' "$MANIFEST")
declare -A UID_OF ENGINE_OF PORT_OF VERSION_OF VOLUMES_OF
for b in $(jq -r '.bootOrder[][]' "$MANIFEST"); do
  s="$(jq -r --arg b "$b" '.bricks[$b].database.slug' "$MANIFEST")"
  UID_OF[$s]="$(jq -r --arg b "$b" '.bricks[$b].database.uid' "$MANIFEST")"
  ENGINE_OF[$s]="$(jq -r --arg b "$b" '.bricks[$b].database.engineUid' "$MANIFEST")"
  PORT_OF[$s]="$(jq -r --arg b "$b" '.bricks[$b].port' "$MANIFEST")"
  VERSION_OF[$s]="$(jq -r --arg b "$b" '.bricks[$b].database.schemaVersion' "$MANIFEST")"
  VOLUMES_OF[$s]="$(jq -r --arg b "$b" '(.bricks[$b].database.volumes // ["etc/mysql", "sav", "log"]) | join(" ")' "$MANIFEST")"
done
# HOLDS_CREDENTIAL and PINNED come from unit-probes.sh, the list podman-up.sh registers.
UNIVERSE_ID="$(universe_uuid)"

# ── The Rule 26 inventory, unit by unit ─────────────────────────────────────
gate_unit() {
  local s="$1" uid="${UID_OF[$1]}" engine="${ENGINE_OF[$1]}" ctr="${UNIVERSE}-ctr-$1"
  local sock="/run/$s/mysqld.sock" passwd="/apps/$s/etc/mysql/localhost/passwd"
  section "$s — the application and its MariaDB in one container (Rules 4 and 26)"

  check "$s-running" "$ctr is running" \
    test "$(podman inspect -f '{{.State.Running}}' "$ctr" 2>/dev/null)" = true
  check "$s-ready" "unit-ready: engine, root path, no networking, application, health" \
    podman exec "$ctr" unit-ready
  check "$s-no-db-container" "no ${ctr}-mariadb beside it" \
    bash -c "! podman container exists '${ctr}-mariadb'"

  local procs
  procs="$(unit_processes "$ctr")"
  check "$s-supervisor-root" "pid 1 is tini; one supervisor, as root, its child" probe_supervisor_root "$procs"
  check "$s-two-processes" "the supervisor's children: mariadbd as mysql ($engine) and the application as $s ($uid)" \
    probe_two_processes "$procs" "$engine" "$uid"
  check "$s-app-not-root" "nothing the supervisor started runs as root" probe_no_root_application "$procs"
  check "$s-engine-args" "mariadbd runs --no-defaults --skip-networking --socket=$sock" probe_engine_args "$procs" "$sock"

  check "$s-skip-networking" "@@skip_networking = 1, @@socket = $sock" \
    test "$(rootsql "$s" -e 'SELECT CONCAT(@@skip_networking, "|", @@socket)' 2>/dev/null)" = "1|$sock"
  check "$s-no-tcp-listener" "mariadbd holds no listening TCP socket (its own fds, read as mysql)" \
    test "$(engine_tcp_listeners "$ctr" "$engine")" = 0
  check "$s-socket-not-mounted" "nothing is mounted on /run or /run/$s: the socket stays in the container" \
    bash -c "! podman inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' '$ctr' | tr ' ' '\n' | grep -qE '^/run(/$s)?/?$'"
  local mounts v want_volumes="" got_volumes=""
  mounts="$(podman inspect -f '{{range .Mounts}}{{.Source}}={{.Destination}} {{end}}' "$ctr" 2>/dev/null | tr ' ' '\n')"
  for v in etc/mysql sav log; do
    [[ " ${VOLUMES_OF[$s]} " == *" $v "* ]] && want_volumes+="$v "
    grep -qx "$APPS_ROOT/$s/$v=/apps/$s/$v" <<<"$mounts" && got_volumes+="$v "
  done
  check "$s-volumes" "volumes: exactly the declared ${VOLUMES_OF[$s]} from $APPS_ROOT/$s${got_volumes:+ (mounted: $got_volumes)}" \
    test "$got_volumes" = "$want_volumes"

  local accounts expected
  accounts="$(rootsql "$s" -e "SELECT CONCAT(user,'@',host,':',plugin) FROM mysql.user ORDER BY 1" 2>/dev/null | sort | paste -sd' ')"
  expected="$(printf '%s\n' "mariadb.sys@localhost:mysql_native_password" "root@localhost:unix_socket" "$s@localhost:mysql_native_password" | sort | paste -sd' ')"
  check "$s-db-accounts" "exactly root (unix_socket), mariadb.sys and $s, all at localhost" test "$accounts" = "$expected"
  check "$s-root-socket-only" "root@localhost is IDENTIFIED VIA unix_socket and nothing else" \
    test "$(rootsql "$s" -e "SHOW CREATE USER 'root'@'localhost'" 2>/dev/null)" = 'CREATE USER `root`@`localhost` IDENTIFIED VIA unix_socket'
  check "$s-sys-locked" "mariadb.sys@localhost is locked" \
    grep -q 'ACCOUNT LOCK' <<<"$(rootsql "$s" -e "SHOW CREATE USER 'mariadb.sys'@'localhost'" 2>/dev/null)"

  local grants
  grants="$(rootsql "$s" -e "SHOW GRANTS FOR '$s'@'localhost'" 2>/dev/null | sed 's/ IDENTIFIED BY PASSWORD.*//' | paste -sd'|')"
  check "$s-db-least-priv" "SELECT, INSERT, UPDATE, DELETE on \`$s\`.* and nothing else" \
    test "$grants" = "GRANT USAGE ON *.* TO \`$s\`@\`localhost\`|GRANT SELECT, INSERT, UPDATE, DELETE ON \`$s\`.* TO \`$s\`@\`localhost\`"
  check "$s-db-schema" "schema_meta records $s at exactly version ${VERSION_OF[$s]}" \
    test "$(rootsql "$s" "$s" -e "SELECT version FROM schema_meta WHERE unit='$s'" 2>/dev/null)" = "${VERSION_OF[$s]}"

  check "$s-passwd" "$passwd is a 0600 regular file owned by $s ($uid), in a directory $s cannot write" \
    test "$(podman exec "$ctr" stat -c '%F %a %u' "$passwd" 2>/dev/null):$(podman exec "$ctr" stat -c '%U:%G %a' "$(dirname "$passwd")" 2>/dev/null)" = "regular file 600 $uid:root:$s 750"
  check "$s-app-connected" "$s@localhost holds a live session on $s" \
    test "$(rootsql "$s" -e "SELECT COUNT(*) FROM information_schema.processlist WHERE user='$s' AND db='$s'" 2>/dev/null || echo 0)" -ge 1

  # The application path: as the unit's uid, inside its own container, with
  # the password read there from its file — never on a command line.
  check "$s-dml-allowed" "$s reads its own database through the socket" \
    grep -qx '[0-9][0-9]*' <<<"$(app_sql "$ctr" "$s" "$uid" "$s" 'SELECT COUNT(*) FROM schema_meta')"
  check "$s-no-ddl" "$s cannot create a table" \
    grep -q denied <<<"$(app_sql "$ctr" "$s" "$uid" "$s" 'CREATE TABLE proof_ddl (i INT)')"
  check "$s-no-system" "$s cannot read the mysql system database" \
    grep -q denied <<<"$(app_sql "$ctr" "$s" "$uid" '' 'SELECT 1 FROM mysql.user LIMIT 1')"
  check "$s-not-root" "uid $uid is refused as MariaDB root" \
    bash -c "podman exec --user '$uid' '$ctr' mariadb --no-defaults -S '$sock' -uroot -e 'SELECT 1' 2>&1 | grep -q 'Access denied'"
  check "$s-engine-not-super" "the engine's own OS account is no MariaDB account" \
    bash -c "podman exec --user '$engine' '$ctr' mariadb --no-defaults -S '$sock' -umysql -e 'SELECT 1' 2>&1 | grep -q 'Access denied'"

  # The unit's identity, as the parent delivered it and as Vault holds it.
  check "$s-identity-mount" "$APPS_ROOT/$s/etc/identity is mounted read-only at /apps/$s/etc/identity" \
    bash -c "podman inspect -f '{{range .Mounts}}{{.Source}}={{.Destination}}:{{.RW}} {{end}}' '$ctr' | tr ' ' '\n' | grep -qx '$APPS_ROOT/$s/etc/identity=/apps/$s/etc/identity:false'"
  check "$s-universe-id" "the unit runs in universe $UNIVERSE_ID (SHAPER_UNIVERSE_ID)" \
    test -n "$UNIVERSE_ID" -a "$(unit_env "$ctr" SHAPER_UNIVERSE_ID)" = "$UNIVERSE_ID"
  if [[ " $PINNED " == *" $s "* ]]; then
    check "$s-pin" "the pinned Vault public key is a root-owned 0644 file, the one the parent derived" \
      test "$(podman exec "$ctr" stat -c '%F %a %u' "/apps/$s/etc/identity/vault-signing.pub" 2>/dev/null):$(podman exec "$ctr" sha256sum "/apps/$s/etc/identity/vault-signing.pub" 2>/dev/null | cut -d' ' -f1)" \
        = "regular file 644 0:$(sha256sum "$VAULT_ETC_DIR/vault-signing.pub" 2>/dev/null | cut -d' ' -f1)"
  fi
  if [[ " $HOLDS_CREDENTIAL " == *" $s "* ]]; then
    local incarnation
    incarnation="$(unit_env "$ctr" SHAPER_UNIT_INCARNATION)"
    check "$s-bootstrap" "its bootstrap is a 0600 file owned by $s ($uid), and no bootstrap value is in its environment" \
      bash -c "[[ \"\$(podman exec '$ctr' stat -c '%F %a %u' /apps/$s/etc/identity/bootstrap 2>/dev/null)\" == 'regular file 600 $uid' ]] && ! podman inspect -f '{{range .Config.Env}}{{println .}}{{end}}' '$ctr' | grep -qE '^[A-Z_]*BOOTSTRAP[A-Z_]*=[0-9a-f]{64}\$'"
    check "$s-grants" "Vault holds exactly $s's declared grants: $(grants_json $(grants_of "$s"))" \
      test "$(rootsql vault vault -e "SELECT grants FROM unit_identities WHERE universe_id = '$UNIVERSE_ID' AND unit_id = '$s'" 2>/dev/null)" = "$(grants_json $(grants_of "$s"))"
    check "$s-incarnation-live" "Vault holds $s's current incarnation ${incarnation:-?}, not revoked, its bootstrap unexpired (vault.unit_identities, root path)" \
      test -n "$incarnation" -a "$(rootsql vault vault -e "SELECT COUNT(*) FROM unit_identities WHERE universe_id = '$UNIVERSE_ID' AND unit_id = '$s' AND incarnation = '$incarnation' AND NOT revoked AND bootstrap_expires_at > UTC_TIMESTAMP(3)" 2>/dev/null || echo 0)" = 1
    check "$s-evidence-flowing" "no evidence owed to Logger for more than 15 minutes in $s.event_outbox" \
      test "$(rootsql "$s" "$s" -e "SELECT COUNT(*) FROM event_outbox WHERE receipt IS NULL AND created_at < TIMESTAMPADD(MINUTE, -15, UTC_TIMESTAMP(3))" 2>/dev/null || echo unknown)" = 0
  fi

  local other refused=0 tried=0
  for other in "${UNITS[@]}"; do
    [[ "$other" == "$s" ]] && continue
    tried=$((tried + 1))
    foreign_sql "$ctr" "$s" "$uid" "$other" "$APPS_ROOT/$other/etc/mysql/localhost/passwd" | grep -q 'Access denied' && refused=$((refused + 1))
  done
  check "$s-foreign-refused" "$refused/$tried other units' credentials refused" test "$refused" -eq "$tried"

  # Filesystem rights, by access(2) as the application's uid: the data, socket,
  # password and administrative paths, and every ancestor of them.
  local writable
  writable="$(app_writable "$ctr" "$uid" \
    "/apps/$s/sav/mariadb" "/apps/$s/sav" "/apps/$s" /apps / "/run/$s" /run \
    "/apps/$s/etc/mysql/localhost" "/apps/$s/etc/mysql" "/apps/$s/etc" "/apps/$s/etc/identity" \
    /etc/my.cnf /etc/my.cnf.d /etc/my.cnf.d/zz-shaper-unit.cnf /usr/local/lib/shaper/unit-mariadb \
    "/apps/$s/app" "$(jq -r --arg s "$s" '.bricks[] | select(.database.slug == $s) | .database.schema' "$MANIFEST")")"
  check "$s-fs-protected" "datadir, socket, password and admin paths and their ancestors are not writable by $s${writable:+ — writable: $writable}" \
    test -z "$writable"
  check "$s-datadir-closed" "$s cannot list the datadir" \
    bash -c "! podman exec --user '$uid' '$ctr' ls /apps/$s/sav/mariadb >/dev/null 2>&1"
  local epid
  epid="$(engine_pid_of "$procs")"
  check "$s-engine-unsignalable" "$s cannot signal mariadbd (pid ${epid:-unknown})" \
    bash -c "[[ -n '$epid' ]] && ! podman exec --user '$uid' '$ctr' kill -0 '$epid' 2>/dev/null"
}

section "universe — one identity, no database on a network"
check "universe-id" "the universe identity is a UUID ($VAULT_ETC_DIR/universe-id)" \
  bash -c "[[ '$UNIVERSE_ID' =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$ ]]"
check "proof-identity" "the proof's reader identity is root-only ($PROOF_DIR/identity)" \
  test "$(stat -c '%a %u' "$PROOF_DIR/identity" 2>/dev/null):$(stat -c '%a %u' "$PROOF_DIR/identity/bootstrap" 2>/dev/null)" = "700 0:600 0"
check "no-tcp-mariadb" "no mariadbd in ss -ltnp, no :3306" \
  bash -c "! ss -ltnpH | grep -qE 'mariadbd|:3306 '"
check "restart-on-boot" "podman-restart.service is enabled" \
  bash -c "systemctl is-enabled podman-restart.service 2>/dev/null | grep -qx enabled"

for s in "${UNITS[@]}"; do gate_unit "$s"; done

# ── One real effect per unit, read back through the root path ──────────────
# shellcheck source=/dev/null
[[ -f "$UNIV/deploy/proof-effects.sh" ]] && source "$UNIV/deploy/proof-effects.sh"

printf '\n%s: %d checks passed, %d failed (run %s)\n' "$UNIVERSE" "$PASS" "$FAILS" "$RUN_ID"
(( FAILS == 0 ))
