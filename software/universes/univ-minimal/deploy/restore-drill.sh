#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#private-mariadb
# Restore drill for every unit's private MariaDB (Rules 16, 26 and 30).
#
# For each unit: a crash-consistent dump through the administrative path,
# written under a .part name and kept only when it has a size (Rule 12); a
# restore into a throwaway MariaDB with no network and its own datadir; the
# restored tables compared with the live ones. For the Vault, the restored
# database must also serve a controlled secret written just before the dump,
# decrypted with the universe's key — and a Vault started with any other key
# must refuse to serve.
#
# Run it on a quiet universe: the comparison is exact, and a unit that writes
# between the dump and the comparison is reported as a difference, not hidden.
set -uo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then set -a; source "$UNIV/cfg-univ-minimal.env"; set +a
fi
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
: "${SHAPER_MARIADB_IMAGE:?not set}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRILL_PORT="${DRILL_VAULT_PORT:-18610}"

PASS=0; FAILS=0
ok()   { PASS=$((PASS + 1)); printf '  OK     %-24s %s\n' "$1" "$2"; }
fail() { FAILS=$((FAILS + 1)); printf '  FAIL   %-24s %s\n' "$1" "$2"; }
# Queries only (-e): no -i, so the proof never reads the caller's standard input.
rootsql() { podman exec "${UNIVERSE}-ctr-$1-mariadb" mariadb -uroot -N -B "${@:2}"; }

MYSQL_UID="$(podman run --rm --network none --entrypoint id "$SHAPER_MARIADB_IMAGE" -u mysql)"
MYSQL_GID="$(podman run --rm --network none --entrypoint id "$SHAPER_MARIADB_IMAGE" -g mysql)"

# A throwaway MariaDB: no network, its own datadir, root reachable only from
# inside it. Echoes the container name.
throwaway_db() {
  local s="$1" dir="$2" name="${UNIVERSE}-drill-$1-mariadb"
  install -d -m 0700 -o "$MYSQL_UID" -g "$MYSQL_GID" "$dir/data"
  install -d -m 0755 -o "$MYSQL_UID" -g "$MYSQL_GID" "$dir/run"
  ( umask 077; openssl rand -hex 32 > "$dir/root" ); chown "$MYSQL_UID:$MYSQL_GID" "$dir/root"; chmod 0400 "$dir/root"
  podman run -d --name "$name" --replace --network none \
    -v "$dir/data:/var/lib/mysql:Z" -v "$dir/run:/run/mysqld:z" -v "$dir/root:/run/secrets/root:ro,Z" \
    -e MARIADB_ROOT_PASSWORD_FILE=/run/secrets/root -e MARIADB_ROOT_HOST=localhost \
    "$SHAPER_MARIADB_IMAGE" --skip-networking --socket=/run/mysqld/mysqld.sock >/dev/null
  local tries=120
  until podman exec "$name" sh -c 'MYSQL_PWD="$(cat /run/secrets/root)" mariadb -uroot -e "SELECT 1"' >/dev/null 2>&1; do
    (( tries-- )) || { podman logs --tail 20 "$name" >&2; return 1; }
    sleep 1
  done
  echo "$name"
}
drillsql() { podman exec -i "$1" sh -c 'MYSQL_PWD="$(cat /run/secrets/root)" exec mariadb -uroot -N -B "$@"' _ "${@:2}"; }

fingerprint() {  # fingerprint <sql-runner...> <db>: "table:rows:checksum" per table
  local db="${*: -1}" runner=("${@:1:$#-1}") t
  for t in $("${runner[@]}" -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$db' ORDER BY 1"); do
    printf '%s:%s:%s\n' "$t" \
      "$("${runner[@]}" "$db" -e "SELECT COUNT(*) FROM \`$t\`")" \
      "$("${runner[@]}" "$db" -e "CHECKSUM TABLE \`$t\` EXTENDED" | awk '{print $2}')"
  done
}

VAULT_TOKEN="$(cat "$APPS_ROOT/vault/etc/vault/api-token" 2>/dev/null || true)"
VAULT_PORT="$(jq -r '.bricks["brick-vault"].port' "$MANIFEST")"
CONTROL_KEY="restore-drill/$STAMP"
CONTROL_VALUE="$(openssl rand -hex 16)"
if curl -sf -X POST -H "Authorization: Bearer $VAULT_TOKEN" -H 'Content-Type: application/json' \
     -d "{\"data\":\"$CONTROL_VALUE\"}" "http://127.0.0.1:$VAULT_PORT/api/secret/$CONTROL_KEY" >/dev/null; then
  ok vault-control-written "controlled secret $CONTROL_KEY stored through the live Vault"
else
  fail vault-control-written "the live Vault refused the controlled secret"
fi

for s in $(jq -r '.bootOrder[][] as $b | .bricks[$b].database.slug' "$MANIFEST"); do
  printf '\n── %s\n' "$s"
  dumps="$APPS_ROOT/$s/sav/dumps"; install -d -m 0700 -o root -g root "$dumps"
  dump="$dumps/$s-$STAMP.sql"
  if podman exec "${UNIVERSE}-ctr-$s-mariadb" mariadb-dump -uroot --single-transaction --routines --triggers --databases "$s" > "$dump.part" \
     && [[ -s "$dump.part" ]]; then
    mv "$dump.part" "$dump"; chmod 0600 "$dump"
    ok "$s-dump" "$(stat -c %s "$dump") bytes, sha256 $(sha256sum "$dump" | cut -c1-16)…"
  else
    rm -f "$dump.part"; fail "$s-dump" "mariadb-dump failed or produced nothing"; continue
  fi

  live="$(fingerprint rootsql "$s" "$s")"
  work="$APPS_ROOT/$s/nosav/restore-drill-$STAMP"
  if ! drill="$(throwaway_db "$s" "$work")"; then fail "$s-throwaway" "the throwaway MariaDB did not start"; continue; fi
  if drillsql "$drill" < "$dump"; then ok "$s-restored" "dump loaded into $drill (no network)"; else fail "$s-restored" "the dump did not load"; fi
  restored="$(fingerprint drillsql "$drill" "$s")"
  if [[ -n "$live" && "$live" == "$restored" ]]; then
    ok "$s-identical" "$(wc -l <<<"$live") tables, rows and checksums identical"
  else
    fail "$s-identical" "restored tables differ from live"; diff <(echo "$live") <(echo "$restored") | sed 's/^/           /'
  fi

  if [[ "$s" == vault ]]; then
    # The restored Vault must serve the controlled secret with the universe's key,
    # through its own confined account, in a throwaway container.
    pw="$(openssl rand -hex 32)"
    drillsql "$drill" <<SQL
CREATE USER 'vault'@'localhost' IDENTIFIED BY '$pw';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`vault\`.* TO 'vault'@'localhost';
SQL
    ( umask 077; printf '%s\n' "$pw" > "$work/passwd" ); unset pw
    chown vault:vault "$work/passwd"; chmod 0600 "$work/passwd"
    image="$(podman inspect -f '{{.ImageName}}' "${UNIVERSE}-ctr-vault")"
    drill_vault() {  # drill_vault <key-file> → container name
      podman run -d --name "${UNIVERSE}-drill-vault" --replace --network host --user 10610:10610 \
        -e HOST=127.0.0.1 -e VAULT_PORT="$DRILL_PORT" -e VAULT_TOKEN="drill" \
        -e VAULT_MASTER_KEY_FILE=/apps/vault/etc/vault/master.key \
        -v "$work/run:/run/mysqld:z" -v "$work/passwd:/apps/vault/etc/mysql/localhost/passwd:ro,Z" \
        -v "$1:/apps/vault/etc/vault/master.key:ro,Z" "$image" >/dev/null
    }
    drill_vault "$APPS_ROOT/vault/etc/vault/master.key"
    got=""; for _ in $(seq 1 30); do
      got="$(curl -sf -H 'Authorization: Bearer drill' "http://127.0.0.1:$DRILL_PORT/api/secret/$CONTROL_KEY" | jq -r '.data // empty')" && [[ -n "$got" ]] && break
      sleep 1
    done
    if [[ "$got" == "$CONTROL_VALUE" ]]; then ok vault-restore-decrypts "the restored Vault decrypts the controlled secret with the universe's key"
    else fail vault-restore-decrypts "expected the controlled value, got '${got:0:8}…'"; podman logs --tail 10 "${UNIVERSE}-drill-vault"; fi
    podman rm -f "${UNIVERSE}-drill-vault" >/dev/null

    ( umask 077; openssl rand -hex 32 > "$work/wrong.key" ); chown vault:vault "$work/wrong.key"; chmod 0400 "$work/wrong.key"
    drill_vault "$work/wrong.key"
    sleep 5
    state="$(podman inspect -f '{{.State.Status}} {{.State.ExitCode}}' "${UNIVERSE}-drill-vault" 2>/dev/null)"
    if [[ "$state" == "exited 1" ]] && podman logs "${UNIVERSE}-drill-vault" 2>&1 | grep -q VAULT_KEY_MISMATCH; then
      ok vault-wrong-key-refused "a Vault started with another key refuses to serve (VAULT_KEY_MISMATCH)"
    else
      fail vault-wrong-key-refused "state '$state'"; podman logs --tail 10 "${UNIVERSE}-drill-vault"
    fi
    podman rm -f "${UNIVERSE}-drill-vault" >/dev/null
  fi

  podman rm -f "$drill" >/dev/null
  rm -rf "$work"
done

curl -sf -X DELETE -H "Authorization: Bearer $VAULT_TOKEN" "http://127.0.0.1:$VAULT_PORT/api/secret/$CONTROL_KEY" >/dev/null \
  && ok vault-control-removed "controlled secret removed from the live Vault" \
  || fail vault-control-removed "the controlled secret is still in the live Vault"

printf '\n%s restore drill %s: %d passed, %d failed\n' "$UNIVERSE" "$STAMP" "$PASS" "$FAILS"
(( FAILS == 0 ))
