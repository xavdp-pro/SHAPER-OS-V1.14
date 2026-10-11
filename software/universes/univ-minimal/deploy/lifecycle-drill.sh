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
#   3. a re-run of deploy/podman-up.sh, and its --preflight, recreate
#      nothing: the same containers, the same incarnations, no epoch moved
#      (DECISIONS-20261011 §B);
#   4. recreation of the universe (podman-up.sh --recreate all replaces every
#      container): new containers, same markers, counts and password; each
#      unit that holds a credential runs a new random incarnation, the one
#      Vault now holds for it, and Vault has issued it a credential once it
#      owed evidence; a credential issued before the recreation is refused by
#      Logger.
#
# The Vault and Logger markers are written under credentials (the Vault's API
# token, the proof's Vault-signed identity), never on a command line.
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
UNIVERSE_ID="$(universe_uuid)"

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
vault_curl -sf -o /dev/null -X POST -H "$H" -d "{\"data\":\"lifecycle-$STAMP\"}" "$(url vault)/api/secret/lifecycle/$STAMP" \
  && ok vault-marker "secret lifecycle/$STAMP stored" || fail vault-marker "the Vault refused the marker"
vault_marker() { rootsql vault vault -e "SELECT SHA2(CONCAT(secret_key,iv,auth_tag,ciphertext),256) FROM secrets WHERE secret_key='lifecycle/$STAMP'" 2>/dev/null; }
eid="$(logger_curl -s -X POST "$(url logger)/api/ingest" -H "$H" -d "{\"pod\":\"proof\",\"event\":\"LIFECYCLE_MARKER\",\"correlationId\":\"$STAMP\",\"sourceEventId\":\"lifecycle/$STAMP\",\"data\":{\"stamp\":\"$STAMP\"}}" | jq -r '.record.id // empty')"
[[ -n "$eid" ]] && ok logger-marker "event $eid ingested" || fail logger-marker "the Logger refused the marker"
logger_marker() { rootsql logger logger -e "SELECT digest FROM events WHERE id='$eid'" 2>/dev/null; }
job="$(queue_curl -s -X POST "$(url queue)/api/jobs" -H "$H" -d "{\"type\":\"lifecycle.marker\",\"payload\":{\"stamp\":\"$STAMP\"},\"idempotencyKey\":\"lifecycle-$STAMP\"}" | jq -r '.job.id // empty')"
[[ -n "$job" ]] && queue_complete "$job" '{"marker":true}' >/dev/null
[[ -n "$job" ]] && ok queue-marker "job $job COMPLETED" || fail queue-marker "the Queue refused the marker"
check queue-marker-evidence "the marker job's evidence receipted by Logger and held there as queue's" \
  evidence_delivered queue "JSON_VALUE(body, '\$.correlationId') = '$job'"
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
    test "$(vault_curl -sf "$(url vault)/api/secret/lifecycle/$STAMP" | jq -r .data)" = "lifecycle-$STAMP"
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

# Evidence for each credential holder to deliver: a unit asks Vault for a
# credential only when its outbox owes a row (DECISIONS-20261011 §C). Maestro
# owes its MAESTRO_STARTED at every start.
owe_evidence() {  # <phase>
  vault_curl -sf -o /dev/null -X POST -H "$H" -d "{\"data\":\"$1-$STAMP\"}" "$(url vault)/api/secret/lifecycle/$STAMP-$1"
  local j
  j="$(queue_curl -s -X POST "$(url queue)/api/jobs" -H "$H" -d "{\"type\":\"lifecycle.owe\",\"payload\":{\"phase\":\"$1\"},\"idempotencyKey\":\"lifecycle-$STAMP-$1\"}" | jq -r '.job.id // empty')"
  [[ -n "$j" ]] && queue_complete "$j" >/dev/null
  vault_curl -sf -o /dev/null -X DELETE "$(url vault)/api/secret/lifecycle/$STAMP-$1"
}

# The unit's current incarnation is the one Vault holds — the registration of
# this run was applied — and Vault has issued it a logger credential once it
# owed evidence (waits up to 60 s for the unit's relay).
credential_current() {  # <slug>
  local s="$1" inc tries=60
  inc="$(unit_env "${UNIVERSE}-ctr-$s" SHAPER_UNIT_INCARNATION)"
  [[ -n "$inc" && "$(rootsql vault vault -e "SELECT incarnation FROM unit_identities WHERE universe_id='$UNIVERSE_ID' AND unit_id='$s' AND NOT revoked" 2>/dev/null)" == "$inc" ]] || return 1
  while (( tries-- > 0 )); do
    [[ "$(rootsql vault vault -e "SELECT COUNT(*) FROM unit_credentials WHERE universe_id='$UNIVERSE_ID' AND unit_id='$s' AND incarnation='$inc' AND audience='logger'" 2>/dev/null)" -ge 1 ]] && return 0
    sleep 1
  done
  return 1
}

# ── 3. A re-run keeps what runs as declared ────────────────────────────────
printf '\n── re-run\n'
declare -A ID_KEPT INC_KEPT
for s in "${UNITS[@]}"; do
  ID_KEPT[$s]="$(podman inspect -f '{{.Id}}' "${UNIVERSE}-ctr-$s")"
  INC_KEPT[$s]="$(unit_env "${UNIVERSE}-ctr-$s" SHAPER_UNIT_INCARNATION)"
done
EPOCHS_KEPT="$(rootsql vault vault -e "SELECT GROUP_CONCAT(CONCAT(unit_id, ':', incarnation, ':', epoch) ORDER BY unit_id) FROM unit_identities WHERE universe_id='$UNIVERSE_ID'" 2>/dev/null)"
preflight_out="$(bash "$UNIV/deploy/podman-up.sh" --preflight 2>&1)" \
  && ok preflight "deploy/podman-up.sh --preflight ran: nothing written, registered or started" \
  || fail preflight "deploy/podman-up.sh --preflight failed: $(tail -n 3 <<<"$preflight_out" | tr '\n' ' ')"
check preflight-keeps "the preflight would keep every unit and the proof's identity" \
  bash -c '! grep -qE "^  [a-z]+ +(recreate|register) " <<<"$1"' _ "$preflight_out"
if bash "$UNIV/deploy/podman-up.sh" >/dev/null; then ok rerun "deploy/podman-up.sh ran again with nothing to recreate"
else fail rerun "deploy/podman-up.sh failed on a re-run"; fi
for s in "${UNITS[@]}"; do
  check "rerun-$s-kept" "$s: the same container, the same incarnation ${INC_KEPT[$s]:-(none: it holds no credential)}" \
    test "$(podman inspect -f '{{.Id}}' "${UNIVERSE}-ctr-$s" 2>/dev/null)|$(unit_env "${UNIVERSE}-ctr-$s" SHAPER_UNIT_INCARNATION)" = "${ID_KEPT[$s]}|${INC_KEPT[$s]}"
done
check rerun-epochs "no incarnation changed and no epoch moved in Vault (root path)" \
  test "$(rootsql vault vault -e "SELECT GROUP_CONCAT(CONCAT(unit_id, ':', incarnation, ':', epoch) ORDER BY unit_id) FROM unit_identities WHERE universe_id='$UNIVERSE_ID'" 2>/dev/null)" = "$EPOCHS_KEPT"

# ── 4. Recreation: new containers over the same volumes ─────────────────────
printf '\n── recreation\n'
declare -A ID_BEFORE INC_BEFORE
for s in "${UNITS[@]}"; do
  ID_BEFORE[$s]="$(podman inspect -f '{{.Id}}' "${UNIVERSE}-ctr-$s")"
  INC_BEFORE[$s]="$(unit_env "${UNIVERSE}-ctr-$s" SHAPER_UNIT_INCARNATION)"
done
# A credential of the incarnation about to be replaced, kept aside root-only.
OLD_CREDENTIAL="$PROOF_DIR/identity/before-recreation.header"
issue_proof_credential "$OLD_CREDENTIAL" \
  && ok old-credential "a logger credential issued to the proof's current incarnation, kept for after the recreation" \
  || fail old-credential "Vault issued no credential to the proof before the recreation"
if bash "$UNIV/deploy/podman-up.sh" --recreate all >/dev/null; then ok recreate "deploy/podman-up.sh --recreate all replaced every unit container"
else fail recreate "deploy/podman-up.sh --recreate all failed"; fi
owe_evidence recreate
for s in "${UNITS[@]}"; do
  ctr="${UNIVERSE}-ctr-$s"
  check "recreate-$s-new" "$ctr is a new container" test "$(podman inspect -f '{{.Id}}' "$ctr" 2>/dev/null)" != "${ID_BEFORE[$s]}"
  check "recreate-$s-kept" "the new $ctr kept the password and the schema" \
    log_in_order "$ctr" "1970-01-01T00:00:00Z" "password: /apps/$s/etc/mysql/localhost/passwd kept" "schema: retained" "application: node server.js started"
  if [[ " $HOLDS_CREDENTIAL " == *" $s "* ]]; then
    check "recreate-$s-incarnation" "$s runs a new random incarnation <slug>-<16 hex> (not ${INC_BEFORE[$s]:-?})" \
      bash -c '[[ "$1" =~ ^$3-[0-9a-f]{16}$ && "$1" != "$2" ]]' _ "$(unit_env "$ctr" SHAPER_UNIT_INCARNATION)" "${INC_BEFORE[$s]}" "$s"
    check "recreate-$s-credential" "Vault holds that incarnation for $s and issued it a logger credential" credential_current "$s"
  fi
done
after_checks recreate
check "recreate-old-credential-refused" "the credential issued before the recreation is refused by Logger (403: its incarnation is no longer current)" \
  test "$(curl_with_header "$OLD_CREDENTIAL" -s -o /dev/null -w '%{http_code}' "$(url logger)/api/events/last?event=NONE")" = 403
check "recreate-new-credential" "a credential issued to the proof's new incarnation is accepted (200)" \
  test "$(logger_curl -s -o /dev/null -w '%{http_code}' "$(url logger)/api/events/last?event=NONE")" = 200

vault_curl -sf -o /dev/null -X DELETE "$(url vault)/api/secret/lifecycle/$STAMP" \
  && ok vault-marker-removed "marker secret removed" || fail vault-marker-removed "the marker secret is still in the Vault"

printf '\n%s lifecycle drill %s: %d passed, %d failed\n' "$UNIVERSE" "$STAMP" "$PASS" "$FAILS"
(( FAILS == 0 ))
