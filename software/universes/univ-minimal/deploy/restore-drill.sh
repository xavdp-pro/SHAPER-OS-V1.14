#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#restore
# Restore drill for every unit's private MariaDB (Rules 16, 26 and 30): each
# unit's logical dump is restored into a FRESH volume by the unit's own image,
# and the unit's own application reads it back.
#
# For each unit:
#   1. a crash-consistent dump through the root path (mariadb-dump
#      --single-transaction --databases <slug>), written under a .part name and
#      kept only when it has a size, root-only (Rule 12). The live tables are
#      fingerprinted before and after the dump and the dump is retaken until
#      both agree: units renew credentials and relay evidence on their own, so
#      a "quiet" universe still writes, and the comparison below must be exact;
#   2. a throwaway unit container from the SAME image as the live unit, over a
#      fresh etc/mysql, sav and log, started with UNIT_RESTORE_DUMP and
#      UNIT_MODE=database: the supervisor births a new datadir, loads the dump
#      as root, checks the exact schema version, creates the account with a new
#      password, and keeps only the database up;
#   3. the restored tables compared with the live ones (rows and checksums);
#   4. the same throwaway volumes started again in serve mode, on a drill port:
#      the unit's application reads a control record back through its own API
#      — the Vault decrypts a controlled secret with the universe's key, and a
#      Vault started with any other key refuses to serve;
#   5. when every step of the unit passed, the dump is a verified recovery
#      point: root records it in the live unit's recovery_points (the instant
#      taken before the dump, its SHA-256), which lets the unit's declared
#      cleanup remove delivered evidence that point holds (pkg-db
#      INTENT.md#retention). A unit whose schema has no such table records none.
#
# A throwaway unit never reaches the live universe with a write: its
# evidence relay and Queue address an unused port (127.0.0.1:9), and its
# bootstrap is a random value no Vault ever registered. The one exception is
# a read: the restored Logger checks the proof's credential at the live Vault,
# the authority that issued it.
#
# Run it on a quiet universe, after proof.sh: the comparison is exact, and a
# unit that writes between the dump and the comparison is reported, not hidden.
set -uo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then set -a; source "$UNIV/cfg-univ-minimal.env"; set +a
fi
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PORT_SHIFT="${DRILL_PORT_SHIFT:-10000}"
H='Content-Type: application/json'
# shellcheck source=/dev/null
source "$UNIV/deploy/unit-probes.sh"

PASS=0; FAILS=0
ok()   { PASS=$((PASS + 1)); printf '  OK     %-26s %s\n' "$1" "$2"; }
# A failure also marks the unit in hand: its dump is then no recovery point.
fail() { FAILS=$((FAILS + 1)); unit_ok=0; printf '  FAIL   %-26s %s\n' "$1" "$2"; }

drill_ctr() { echo "${UNIVERSE}-drill-$1"; }
drillsql() { local s="$1"; shift; podman exec "$(drill_ctr "$s")" mariadb --no-defaults -S "/run/$s/mysqld.sock" -uroot -N -B "$@"; }
# Fails closed: a table whose rows or checksum cannot be read makes the whole
# fingerprint empty, never a list that compares equal on table names alone.
fingerprint() {  # fingerprint <runner> <slug>: "table:rows:checksum" per base table
  local runner="$1" s="$2" t rows sum out=""
  for t in $("$runner" "$s" -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$s' AND table_type='BASE TABLE' ORDER BY 1"); do
    rows="$("$runner" "$s" "$s" -e "SELECT COUNT(*) FROM \`$t\`")"
    sum="$("$runner" "$s" "$s" -e "CHECKSUM TABLE \`$t\` EXTENDED" | awk '{print $2}')"
    [[ "$rows" =~ ^[0-9]+$ && "$sum" =~ ^[0-9]+$ ]] || return 1
    out+="$t:$rows:$sum"$'\n'
  done
  printf '%s' "$out"
}
port_of() { jq -r --arg s "$1" '.bricks[] | select(.database.slug == $s) | .port' "$MANIFEST"; }
uid_of() { jq -r --arg s "$1" '.bricks[] | select(.database.slug == $s) | .database.uid' "$MANIFEST"; }
wait_drill_ready() {
  local tries=180 state
  while (( tries-- )); do
    podman exec "$(drill_ctr "$1")" unit-ready >/dev/null 2>&1 && return 0
    state="$(podman inspect -f '{{.State.Status}}' "$(drill_ctr "$1")" 2>/dev/null || echo absent)"
    [[ "$state" == running ]] || return 1
    sleep 1
  done
  return 1
}

volumes_of() { jq -r --arg s "$1" '.bricks[] | select(.database.slug == $s) | (.database.volumes // ["etc/mysql", "sav", "log"]) | join(" ")' "$MANIFEST"; }
UNIVERSE_ID="$(universe_uuid)"
NOWHERE="http://127.0.0.1:9"

# What each unit's application needs to answer on its drill port — its own
# identity inputs from the throwaway etc/identity/ — and nothing that writes
# to the live universe. Appended to DRILL_ARGS, one element per argument.
drill_args() {  # <slug> <port> <key-file> <work>
  local s="$1" port="$2" key="$3" work="$4"
  local identity=(-e "SHAPER_UNIVERSE_ID=$UNIVERSE_ID" -v "$work/etc/identity:/apps/$s/etc/identity:ro,Z")
  local holds=(-e "SHAPER_UNIT_INCARNATION=$s-drill-$STAMP" -e "UNIT_BOOTSTRAP_TOKEN_FILE=/apps/$s/etc/identity/bootstrap")
  local pin=(-e "UNIT_AUTH_PUBLIC_KEY_FILE=/apps/$s/etc/identity/vault-signing.pub")
  case "$s" in
    vault)   DRILL_ARGS+=("${identity[@]}" "${holds[@]}" -e "LOGGER_URL=$NOWHERE" -e "VAULT_PORT=$port" -e VAULT_TOKEN
               -e VAULT_MASTER_KEY_FILE=/apps/vault/etc/vault/master.key -v "$key:/apps/vault/etc/vault/master.key:ro,Z") ;;
    logger)  DRILL_ARGS+=("${identity[@]}" "${pin[@]}" -e "VAULT_URL=http://127.0.0.1:$(port_of vault)" -e "LOGGER_PORT=$port") ;;
    queue)   DRILL_ARGS+=("${identity[@]}" "${holds[@]}" "${pin[@]}" -e "VAULT_URL=$NOWHERE" -e "LOGGER_URL=$NOWHERE"
               -e "QUEUE_PORT=$port" -e QUEUE_AUTO_DISPATCH=0) ;;
    maestro) DRILL_ARGS+=("${identity[@]}" "${holds[@]}" "${pin[@]}" -e "VAULT_URL=$NOWHERE" -e "LOGGER_URL=$NOWHERE"
               -e "MAESTRO_PORT=$port" -e MAESTRO_AUTO_START=0 -e "MAESTRO_QUEUE_URL=$NOWHERE") ;;
    *) echo "restore-drill: no drill wiring for $s" >&2; return 1 ;;
  esac
}
start_drill() {  # <slug> <work> <mode> <port> [key-file] [extra -e…]
  local s="$1" work="$2" mode="$3" port="$4" key="$5" v; shift 5
  local network=(--network none)
  DRILL_ARGS=()
  [[ "$mode" == serve ]] && network=(--network host)
  for v in $(volumes_of "$s"); do DRILL_ARGS+=(-v "$work/$v:/apps/$s/$v:Z"); done
  if [[ "$mode" == serve ]]; then drill_args "$s" "$port" "$key" "$work" || return 1; fi
  # The Vault's drill token reaches the container by name (-e VAULT_TOKEN), never on a command line.
  VAULT_TOKEN="$DRILL_TOKEN" podman run -d --name "$(drill_ctr "$s")" --replace --restart=no "${network[@]}" \
    --stop-timeout 90 \
    --cap-drop=all --cap-add=CHOWN,DAC_OVERRIDE,FOWNER,KILL,SETGID,SETUID \
    --security-opt=no-new-privileges \
    -e HOST=127.0.0.1 -e UNIT_MODE="$mode" -e UNIT_HEALTH_URL="http://127.0.0.1:$port/api/health" "$@" \
    "${DRILL_ARGS[@]}" \
    "$IMAGE" >/dev/null
}
# The throwaway unit's identity: the live pin (public), and a random bootstrap
# no Vault holds a digest of — enough for the application to start, never to
# obtain a credential.
drill_identity() {  # <slug> <work>
  local s="$1" work="$2" uid
  uid="$(uid_of "$s")"
  install -d -m 0750 -o root -g "$uid" "$work/etc/identity"
  if [[ -s "$VAULT_ETC_DIR/vault-signing.pub" ]]; then install -m 0644 -o root -g root "$VAULT_ETC_DIR/vault-signing.pub" "$work/etc/identity/vault-signing.pub"; fi
  ( umask 077; openssl rand -hex 32 | tr -d '\n' > "$work/etc/identity/bootstrap" )
  chown "$uid:$uid" "$work/etc/identity/bootstrap"
}

DRILL_TOKEN="$(openssl rand -hex 16)"
KEY_FILE="$VAULT_ETC_DIR/master.key"

# ── Control records, written through the live units' APIs ──────────────────
CONTROL_KEY="restore-drill/$STAMP"
CONTROL_VALUE="$(openssl rand -hex 16)"
# The controlled value is a secret too: it travels on standard input, never in argv.
vault_curl -sf -o /dev/null -X POST -H "$H" --data-binary @- \
  "http://127.0.0.1:$(port_of vault)/api/secret/$CONTROL_KEY" <<<"{\"data\":\"$CONTROL_VALUE\"}" \
  && ok vault-control "controlled secret $CONTROL_KEY stored through the live Vault" \
  || fail vault-control "the live Vault refused the controlled secret"
CONTROL_EVENT="$(logger_curl -s -X POST "http://127.0.0.1:$(port_of logger)/api/ingest" -H "$H" \
  -d "{\"pod\":\"proof\",\"event\":\"RESTORE_DRILL\",\"correlationId\":\"$STAMP\",\"sourceEventId\":\"restore-drill/$STAMP\",\"data\":{\"stamp\":\"$STAMP\"}}" | jq -r '.record.id // empty')"
[[ -n "$CONTROL_EVENT" ]] && ok logger-control "event $CONTROL_EVENT ingested by the live Logger" || fail logger-control "the live Logger refused the control event"
CONTROL_JOB="$(curl -s -X POST "http://127.0.0.1:$(port_of queue)/api/jobs" -H "$H" \
  -d "{\"type\":\"restore.drill\",\"payload\":{\"stamp\":\"$STAMP\"},\"idempotencyKey\":\"restore-drill-$STAMP\"}" | jq -r '.job.id // empty')"
curl -s -o /dev/null -X PATCH "http://127.0.0.1:$(port_of queue)/api/jobs/$CONTROL_JOB" -H "$H" -d '{"status":"COMPLETED","progress":100,"step":1,"result":{"drill":true}}'
[[ -n "$CONTROL_JOB" ]] && ok queue-control "job $CONTROL_JOB COMPLETED in the live Queue" || fail queue-control "the live Queue refused the control job"
# The Queue's evidence of the control job reaches the Logger before the Logger is dumped.
evidence_delivered queue "JSON_VALUE(body, '\$.correlationId') = '$CONTROL_JOB'" \
  && ok queue-control-evidence "the control job's evidence receipted by the live Logger" \
  || fail queue-control-evidence "the control job's evidence did not reach the live Logger"

for s in $(jq -r '.bootOrder[][] as $b | .bricks[$b].database.slug' "$MANIFEST"); do
  printf '\n── %s\n' "$s"
  live="${UNIVERSE}-ctr-$s"
  IMAGE="$(podman inspect -f '{{.Image}}' "$live")"
  dumps="$APPS_ROOT/$s/sav/dumps"; install -d -m 0700 -o root -g root "$dumps"
  dump="$dumps/$s-$STAMP.sql"
  # The dump is kept only when the live tables did not move while it was taken.
  livefp=""; attempt=0; unit_ok=1
  while (( attempt++ < 5 )); do
    before="$(fingerprint rootsql "$s")"
    snapshot_at="$(rootsql "$s" -e 'SELECT UTC_TIMESTAMP(3)')"
    if podman exec "$live" mariadb-dump --no-defaults -S "/run/$s/mysqld.sock" -uroot --single-transaction --routines --triggers --databases "$s" > "$dump.part" \
       && [[ -s "$dump.part" ]]; then
      livefp="$(fingerprint rootsql "$s")"
      [[ -n "$before" && "$before" == "$livefp" ]] && break
    fi
    livefp=""; sleep 3
  done
  if [[ -n "$livefp" ]]; then
    mv "$dump.part" "$dump"; chmod 0600 "$dump"
    ok "$s-dump" "$(stat -c %s "$dump") bytes, sha256 $(sha256sum "$dump" | cut -c1-16)…, live tables unchanged across it (attempt $attempt)"
  else
    rm -f -- "$dump.part"; fail "$s-dump" "no dump with the live tables still: mariadb-dump failed, or $s kept writing across 5 attempts"; continue
  fi

  # The fresh volume: what a recovery onto a new host starts from.
  work="$APPS_ROOT/$s/nosav/restore-drill-$STAMP"
  install -d -m 0755 -o root -g root "$APPS_ROOT/$s/nosav" "$work" "$work/etc" "$work/etc/mysql" "$work/sav"
  install -d -m 0750 -o "$(uid_of "$s")" -g "$(uid_of "$s")" "$work/log"
  drill_identity "$s" "$work"
  install -d -m 0700 -o root -g root "$work/sav/restore"
  install -m 0600 -o root -g root "$dump" "$work/sav/restore/$s.sql"

  start_drill "$s" "$work" database 0 "" -e "UNIT_RESTORE_DUMP=/apps/$s/sav/restore/$s.sql"
  if wait_drill_ready "$s"; then
    ok "$s-restored" "a fresh $(drill_ctr "$s") (same image, no network) loaded the dump as root and is ready"
  else
    fail "$s-restored" "the throwaway unit did not restore: $(podman logs --tail 5 "$(drill_ctr "$s")" 2>&1 | tr '\n' ' ')"
    podman rm -f "$(drill_ctr "$s")" >/dev/null 2>&1; rm -rf "$work"; continue
  fi
  restoredfp="$(fingerprint drillsql "$s")"
  if [[ -n "$livefp" && "$livefp" == "$restoredfp" ]]; then
    ok "$s-identical" "$(wc -l <<<"$livefp") tables, rows and checksums identical"
  else
    fail "$s-identical" "restored tables differ from live"; diff <(echo "$livefp") <(echo "$restoredfp") | sed 's/^/           /'
  fi
  if [[ "$(drillsql "$s" -e "SELECT CONCAT(user,'@',host) FROM mysql.user WHERE user='$s'")" == "$s@localhost" ]] \
     && podman logs "$(drill_ctr "$s")" 2>&1 | grep -q "password: /apps/$s/etc/mysql/localhost/passwd generated once"; then
    ok "$s-own-account" "the restored unit has its own account and a password generated for this volume"
  else
    fail "$s-own-account" "the restored unit's account or password birth was not observed"
  fi
  podman stop "$(drill_ctr "$s")" >/dev/null

  # The same restored volume, now served by the unit's own application.
  dport=$(( $(port_of "$s") + PORT_SHIFT ))
  start_drill "$s" "$work" serve "$dport" "$KEY_FILE"
  if wait_drill_ready "$s"; then ok "$s-serves" "the restored $s answers on 127.0.0.1:$dport as its own account"
  else fail "$s-serves" "the restored $s did not become ready: $(podman logs --tail 5 "$(drill_ctr "$s")" 2>&1 | tr '\n' ' ')"; fi
  D="http://127.0.0.1:$dport"
  case "$s" in
    vault)
      ( umask 077; printf '%s' "$DRILL_TOKEN" > "$work/drill-token" )
      write_header "$work/drill.header" "$work/drill-token"
      got="$(curl_with_header "$work/drill.header" -sf "$D/api/secret/$CONTROL_KEY" | jq -r '.data // empty')"
      [[ "$got" == "$CONTROL_VALUE" ]] && ok vault-restore-decrypts "the restored Vault decrypts the controlled secret with the universe's key" \
        || fail vault-restore-decrypts "expected the controlled value, got '${got:0:8}…'"
      podman rm -f "$(drill_ctr "$s")" >/dev/null
      ( umask 077; openssl rand -hex 32 > "$work/wrong.key" ); chown "$(uid_of vault):$(uid_of vault)" "$work/wrong.key"; chmod 0400 "$work/wrong.key"
      start_drill "$s" "$work" serve "$dport" "$work/wrong.key"
      for _ in $(seq 1 60); do [[ "$(podman inspect -f '{{.State.Status}}' "$(drill_ctr "$s")" 2>/dev/null)" == exited ]] && break; sleep 1; done
      if [[ "$(podman inspect -f '{{.State.Status}}' "$(drill_ctr "$s")" 2>/dev/null)" == exited ]] \
         && podman logs "$(drill_ctr "$s")" 2>&1 | grep -q VAULT_KEY_MISMATCH \
         && podman logs "$(drill_ctr "$s")" 2>&1 | grep -q 'then MariaDB shut down cleanly'; then
        ok vault-wrong-key-refused "a Vault started with another key refuses to serve (VAULT_KEY_MISMATCH), then its MariaDB stops cleanly"
      else
        fail vault-wrong-key-refused "state $(podman inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$(drill_ctr "$s")" 2>/dev/null)"
      fi
      ;;
    logger)
      got="$(logger_curl -s "$D/api/events/last?correlationId=$STAMP&event=RESTORE_DRILL" | jq -r '.events[0].id // empty')"
      [[ -n "$got" && "$got" == "$CONTROL_EVENT" ]] && ok logger-restore-reads "the restored Logger returns the control event $got" \
        || fail logger-restore-reads "expected event $CONTROL_EVENT, got '$got'"
      ;;
    queue)
      got="$(curl -s "$D/api/jobs/$CONTROL_JOB" | jq -r '"\(.job.id)|\(.job.status)"')"
      [[ "$got" == "$CONTROL_JOB|COMPLETED" ]] && ok queue-restore-reads "the restored Queue returns job $CONTROL_JOB COMPLETED" \
        || fail queue-restore-reads "expected $CONTROL_JOB|COMPLETED, got '$got'"
      ;;
    maestro)
      want="$(rootsql maestro maestro -e "SELECT schedule_id FROM schedules ORDER BY 1" | paste -sd,)"
      got="$(curl -s "$D/api/tasks?include=disabled" | jq -r '[.tasks[].slug] | sort | join(",")')"
      [[ "$(curl -s -o /dev/null -w '%{http_code}' "$D/api/occurrences?limit=10")" == 200 && "$got" == "$want" ]] \
        && ok maestro-restore-reads "the restored Maestro lists the live schedules [${want:-none}] and serves its occurrences" \
        || fail maestro-restore-reads "expected schedules [$want], got [$got]"
      ;;
  esac

  podman rm -f "$(drill_ctr "$s")" >/dev/null 2>&1
  rm -rf "$work"

  # Every step of this unit passed: the kept dump is a verified recovery point.
  if [[ "$(rootsql "$s" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$s' AND table_name='recovery_points'" 2>/dev/null)" == 1 ]]; then
    if (( unit_ok )); then
      sum="$(sha256sum "$dump" | cut -d' ' -f1)"
      if rootsql "$s" "$s" -e "INSERT INTO recovery_points (recovery_point_id, snapshot_at, verified_at, dump_sha256) VALUES ('rp-$STAMP', '$snapshot_at', UTC_TIMESTAMP(3), '$sum')" \
         && [[ "$(rootsql "$s" "$s" -e "SELECT COUNT(*) FROM recovery_points WHERE recovery_point_id='rp-$STAMP' AND snapshot_at='$snapshot_at' AND dump_sha256='$sum'")" == 1 ]]; then
        ok "$s-recovery-point" "rp-$STAMP recorded by root in $s.recovery_points (snapshot $snapshot_at, dump sha256 ${sum:0:16}…)"
      else
        fail "$s-recovery-point" "root could not record the verified recovery point"
      fi
    else
      printf '  NOTE   %-26s %s\n' "$s-recovery-point" "not recorded: a step of this unit failed"
    fi
  fi
done

vault_curl -sf -o /dev/null -X DELETE "http://127.0.0.1:$(port_of vault)/api/secret/$CONTROL_KEY" \
  && ok vault-control-removed "controlled secret removed from the live Vault" \
  || fail vault-control-removed "the controlled secret is still in the live Vault"

printf '\n%s restore drill %s: %d passed, %d failed\n' "$UNIVERSE" "$STAMP" "$PASS" "$FAILS"
(( FAILS == 0 ))
