#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#lifecycle
# Restart and recreation keep every unit's state and its password, and the
# unit's two processes start and stop in the declared order (Rule 26: readiness
# gated on MariaDB, coordinated stop). Observed from outside the units:
#
#   1. a marker per unit, written through the unit's API and read back from its
#      database by the root path; each table's row count; the password file's
#      digest (computed inside the container, compared, never printed);
#   2. `podman restart` of every unit: markers, counts and password unchanged;
#      the unit's log shows the application stopped before MariaDB, MariaDB
#      ready before the application started, no crash recovery, the password
#      kept and the schema retained, not re-applied;
#   3. recreation of the universe (deploy/podman-up.sh replaces every
#      container): new containers, same markers, counts and password.
#
# Run it on a quiet universe (Maestro idle). Exit 0 only when every check passed.
set -uo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then set -a; source "$UNIV/cfg-univ-minimal.env"; set +a
fi
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
H='Content-Type: application/json'
# shellcheck source=/dev/null
source "$UNIV/deploy/unit-probes.sh"

PASS=0; FAILS=0
ok()   { PASS=$((PASS + 1)); printf '  OK     %-28s %s\n' "$1" "$2"; }
fail() { FAILS=$((FAILS + 1)); printf '  FAIL   %-28s %s\n' "$1" "$2"; }
check() { local name="$1" detail="$2"; shift 2; if "$@"; then ok "$name" "$detail"; else fail "$name" "$detail"; fi; }

mapfile -t UNITS < <(jq -r '.bootOrder[][] as $b | .bricks[$b].database.slug' "$MANIFEST")
port() { jq -r --arg s "$1" '.bricks[] | select(.database.slug == $s) | .port' "$MANIFEST"; }
url() { echo "http://127.0.0.1:$(port "$1")"; }
VAULT_TOKEN="$(cat "$APPS_ROOT/vault/etc/vault/api-token" 2>/dev/null || true)"

passwd_digest() { podman exec "${UNIVERSE}-ctr-$1" sha256sum "/apps/$1/etc/mysql/localhost/passwd" 2>/dev/null | cut -d' ' -f1; }
row_counts() {  # "<table>:<rows> ..." for every base table of the unit database
  local s="$1" t out=""
  for t in $(rootsql "$s" -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$s' AND table_type='BASE TABLE' ORDER BY 1" 2>/dev/null); do
    out+="$t:$(rootsql "$s" "$s" -e "SELECT COUNT(*) FROM \`$t\`" 2>/dev/null) "
  done
  echo "$out"
}
counts_kept() {  # <before> <after>: no table lost a row
  local before="$1" after="$2" pair t n m
  for pair in $before; do
    t="${pair%%:*}"; n="${pair##*:}"
    m="$(tr ' ' '\n' <<<"$after" | awk -F: -v t="$t" '$1 == t {print $2}')"
    [[ -n "$m" && "$m" -ge "$n" ]] || return 1
  done
}
wait_ready() {
  local tries=180
  while (( tries-- )); do podman exec "${UNIVERSE}-ctr-$1" unit-ready >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}
# The lines of the unit's log since <since>, in order, must contain each pattern in turn.
log_in_order() {  # <ctr> <since> <pattern>...
  local ctr="$1" since="$2" text line=0 pattern found; shift 2
  text="$(podman logs --since "$since" "$ctr" 2>&1)"
  for pattern in "$@"; do
    found="$(tail -n "+$((line + 1))" <<<"$text" | grep -n -m1 -F -- "$pattern" | cut -d: -f1)"
    [[ -n "$found" ]] || { echo "missing after line $line: $pattern" >&2; return 1; }
    line=$((line + found))
  done
}

# ── 1. Markers, counts and password digests ────────────────────────────────
printf '\n── markers\n'
declare -A DIGEST COUNTS
curl -sf -o /dev/null -X POST -H "Authorization: Bearer $VAULT_TOKEN" -H "$H" -d "{\"data\":\"lifecycle-$STAMP\"}" "$(url vault)/api/secret/lifecycle/$STAMP" \
  && ok vault-marker "secret lifecycle/$STAMP stored" || fail vault-marker "the Vault refused the marker"
vault_marker() { rootsql vault vault -e "SELECT SHA2(CONCAT(secret_key,iv,auth_tag,ciphertext),256) FROM secrets WHERE secret_key='lifecycle/$STAMP'" 2>/dev/null; }
eid="$(curl -s -X POST "$(url logger)/api/ingest" -H "$H" -d "{\"pod\":\"lifecycle\",\"event\":\"LIFECYCLE_MARKER\",\"correlationId\":\"$STAMP\",\"sourceEventId\":\"lifecycle/$STAMP\",\"data\":{\"stamp\":\"$STAMP\"}}" | jq -r '.record.id // empty')"
[[ -n "$eid" ]] && ok logger-marker "event $eid ingested" || fail logger-marker "the Logger refused the marker"
logger_marker() { rootsql logger logger -e "SELECT digest FROM events WHERE id='$eid'" 2>/dev/null; }
job="$(curl -s -X POST "$(url queue)/api/jobs" -H "$H" -d "{\"type\":\"lifecycle.marker\",\"payload\":{\"stamp\":\"$STAMP\"},\"idempotencyKey\":\"lifecycle-$STAMP\"}" | jq -r '.job.id // empty')"
curl -s -o /dev/null -X PATCH "$(url queue)/api/jobs/$job" -H "$H" -d '{"status":"COMPLETED","progress":100,"step":1,"result":{"marker":true}}'
[[ -n "$job" ]] && ok queue-marker "job $job COMPLETED" || fail queue-marker "the Queue refused the marker"
queue_marker() { rootsql queue queue -e "SELECT CONCAT(status,'|',idempotency_key) FROM jobs WHERE id='$job'" 2>/dev/null; }

MARK_VAULT="$(vault_marker)"; MARK_LOGGER="$(logger_marker)"; MARK_QUEUE="$(queue_marker)"
for s in "${UNITS[@]}"; do DIGEST[$s]="$(passwd_digest "$s")"; COUNTS[$s]="$(row_counts "$s")"; done
markers_kept() {
  [[ -n "$MARK_VAULT" && "$(vault_marker)" == "$MARK_VAULT" ]] \
    && [[ -n "$MARK_LOGGER" && "$(logger_marker)" == "$MARK_LOGGER" ]] \
    && [[ "$(queue_marker)" == "COMPLETED|lifecycle-$STAMP" && "$MARK_QUEUE" == "COMPLETED|lifecycle-$STAMP" ]]
}

after_checks() {  # <phase>
  local phase="$1" s
  check "$phase-markers" "the Vault, Logger and Queue markers are unchanged in their databases" markers_kept
  check "$phase-vault-reads" "the Vault still decrypts its marker through its API" \
    test "$(curl -sf -H "Authorization: Bearer $VAULT_TOKEN" "$(url vault)/api/secret/lifecycle/$STAMP" | jq -r .data)" = "lifecycle-$STAMP"
  for s in "${UNITS[@]}"; do
    check "$phase-$s-password" "$s's password file is the same file content" test -n "${DIGEST[$s]}" -a "$(passwd_digest "$s")" = "${DIGEST[$s]}"
    check "$phase-$s-rows" "no table of $s lost a row" counts_kept "${COUNTS[$s]}" "$(row_counts "$s")"
  done
}

# ── 2. Restart: the two processes stop and start in order ───────────────────
printf '\n── restart\n'
for s in "${UNITS[@]}"; do
  ctr="${UNIVERSE}-ctr-$s"
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  sleep 1
  podman restart "$ctr" >/dev/null
  check "restart-$s-ready" "$ctr ready again after podman restart" wait_ready "$s"
  check "restart-$s-stop-order" "stop: the application stopped, then MariaDB shut down cleanly" \
    log_in_order "$ctr" "$since" "stopping: SIGTERM received" "application: stopped" "engine: stopped" "then MariaDB shut down cleanly"
  check "restart-$s-start-order" "start: MariaDB ready, schema retained, password kept, then the application" \
    log_in_order "$ctr" "$since" "starting in mode serve" "password: /apps/$s/etc/mysql/localhost/passwd kept" "engine: ready" "admin: root@localhost by unix_socket only" "schema: retained" "account: $s@localhost opens" "application: node server.js started as $s"
  check "restart-$s-no-crash-recovery" "MariaDB did not need crash recovery" \
    bash -c "! podman logs --since '$since' '$ctr' 2>&1 | grep -qi 'crash recovery'"
done
after_checks restart

# ── 3. Recreation: new containers over the same volumes ─────────────────────
printf '\n── recreation\n'
declare -A ID_BEFORE
for s in "${UNITS[@]}"; do ID_BEFORE[$s]="$(podman inspect -f '{{.Id}}' "${UNIVERSE}-ctr-$s")"; done
if bash "$UNIV/deploy/podman-up.sh" >/dev/null; then ok recreate "deploy/podman-up.sh replaced every unit container"
else fail recreate "deploy/podman-up.sh failed"; fi
for s in "${UNITS[@]}"; do
  ctr="${UNIVERSE}-ctr-$s"
  check "recreate-$s-new" "$ctr is a new container" test "$(podman inspect -f '{{.Id}}' "$ctr" 2>/dev/null)" != "${ID_BEFORE[$s]}"
  check "recreate-$s-kept" "the new $ctr kept the password and the schema" \
    log_in_order "$ctr" "1970-01-01T00:00:00Z" "password: /apps/$s/etc/mysql/localhost/passwd kept" "schema: retained" "application: node server.js started"
done
after_checks recreate

curl -sf -o /dev/null -X DELETE -H "Authorization: Bearer $VAULT_TOKEN" "$(url vault)/api/secret/lifecycle/$STAMP" \
  && ok vault-marker-removed "marker secret removed" || fail vault-marker-removed "the marker secret is still in the Vault"

printf '\n%s lifecycle drill %s: %d passed, %d failed\n' "$UNIVERSE" "$STAMP" "$PASS" "$FAILS"
(( FAILS == 0 ))
