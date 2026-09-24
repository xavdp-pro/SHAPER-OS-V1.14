#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#private-mariadb
# Materialises univ-minimal — Vault, Logger, Queue and Maestro, each with its
# own private MariaDB (Rules 4 and 26) — inside the universe container.
#
# It does only what the manifest declares, in the order bootOrder states, from
# the images the lock (or an explicitly published tag) names. Every unit's
# database is provisioned through the administrative path before the unit
# starts; the unit then connects as itself, through its own socket.
#
# Names follow docs/architecture/NAMING.md, prefixed by the instance slug:
#   <universe>-ctr-<slug>          the unit's application container
#   <universe>-ctr-<slug>-mariadb  the unit's private database
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SOFTWARE="$(cd "$UNIV/../.." && pwd)"
MANIFEST="$UNIV/manifest.json"
LOCK="$UNIV/cfg-image-lock.json"

# ── 1. Configuration: a variables file is read, never executed ─────────────
shaper_env_file_is_variables_only() {
  local file="$1" bad status=0
  bad="$(grep -nvE '^[[:space:]]*(#|$)|^[A-Z][A-Z0-9_]*=("([^"`$]|\$[^(])*\$?"|'"'"'[^'"'"']*'"'"'|[^[:blank:];&|()<>`'"'"'"]*)$' "$file")" || status=$?
  if (( status == 1 )); then
    return 0
  elif (( status == 2 )); then
    echo "[podman-up] cannot read $file — a file that cannot be checked is not sourced" >&2
    return 1
  fi
  echo "[podman-up] $file is not a variables file — these lines would be EXECUTED by source, not exported:" >&2
  echo "$bad" | sed 's/^/[podman-up]   line /' >&2
  echo "[podman-up] only blank lines, # comments and KEY=value are allowed, the value quoted or a bare word without whitespace or shell operators; put a note for a human behind #" >&2
  return 1
}
shaper_source_env() {
  shaper_env_file_is_variables_only "$1" || exit 1
  set -a; source "$1"; set +a
}
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
  shaper_source_env "$ENV_FILE"
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then
  shaper_source_env "$UNIV/cfg-univ-minimal.env"
fi

for tool in podman jq openssl curl ss; do
  command -v "$tool" >/dev/null || { echo "[podman-up] $tool is missing in the universe container — install it at first boot" >&2; exit 1; }
done

UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
: "${SHAPER_MARIADB_IMAGE:?not set — the MariaDB image every unit runs, pinned by digest}"
[[ "$SHAPER_MARIADB_IMAGE" == *@sha256:* ]] || { echo "[podman-up] SHAPER_MARIADB_IMAGE must be pinned by digest (…@sha256:…), got $SHAPER_MARIADB_IMAGE" >&2; exit 1; }
[[ "$UNIVERSE" =~ ^univ-[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "[podman-up] SHAPER_UNIVERSE must be an instance slug (univ-…), got $UNIVERSE" >&2; exit 1; }

# ── 2. Images: pinned, or explicitly published, never guessed ───────────────
resolve_image() {
  local key="$1" pinned
  pinned="$(jq -r --arg k "$key" '.images[$k] // empty' "$LOCK")"
  if [[ -n "$pinned" ]]; then echo "$pinned"; return; fi
  if [[ -n "${SHAPER_REGISTRY:-}" && -n "${SHAPER_IMAGE_TAG:-}" ]]; then
    echo "${SHAPER_REGISTRY}/shaper/brick-${key#img-}:${SHAPER_IMAGE_TAG}"; return
  fi
  echo "[podman-up] $key is not pinned in cfg-image-lock.json and no SHAPER_REGISTRY/SHAPER_IMAGE_TAG is set." >&2
  echo "[podman-up] The registry is an infrastructure prerequisite, one per machine — ask the operator which one this machine uses." >&2
  exit 1
}

# ── 3. The declared ports are free, or held by this universe's own units ────
while read -r brick port; do
  slug="$(jq -r --arg b "$brick" '.bricks[$b].database.slug' "$MANIFEST")"
  if ss -ltnH "sport = :$port" | grep -q .; then
    if ! podman ps --format '{{.Names}}' | grep -qx "${UNIVERSE}-ctr-${slug}"; then
      echo "[podman-up] port $port declared by $brick is held by something that is not ${UNIVERSE}-ctr-${slug} — stop and disable it; no second port is invented" >&2
      ss -ltnpH "sport = :$port" >&2 || true
      exit 1
    fi
  fi
done < <(jq -r '.bricks | to_entries[] | "\(.key) \(.value.port)"' "$MANIFEST")

# ── 4. Instance secrets the construction path owns ──────────────────────────
VAULT_ETC="$APPS_ROOT/vault/etc/vault"
install -d -m 0755 -o root -g root "$APPS_ROOT" "$APPS_ROOT/vault" "$APPS_ROOT/vault/etc"
install -d -m 0750 -o root -g root "$VAULT_ETC"
TOKEN_FILE="$VAULT_ETC/api-token"
if [[ ! -s "$TOKEN_FILE" ]]; then
  ( umask 077; openssl rand -hex 32 > "$TOKEN_FILE" )
fi
chmod 0600 "$TOKEN_FILE"
VAULT_TOKEN="$(<"$TOKEN_FILE")"

KEY_FILE="$VAULT_ETC/master.key"
if [[ ! -s "$KEY_FILE" ]]; then
  if [[ -d "$APPS_ROOT/vault/sav/mariadb/vault" ]]; then
    echo "[podman-up] the Vault database exists but its master key $KEY_FILE does not." >&2
    echo "[podman-up] Restore the key from the operator's key material; a new key would orphan every secret. Halt." >&2
    exit 1
  fi
  ( umask 077; openssl rand -hex 32 > "$KEY_FILE" )
  echo "[podman-up] Vault master key generated for a Vault being born ($KEY_FILE)"
fi

# ── 5. Units, layer by layer, in the declared bootOrder ─────────────────────
wait_healthy() {
  local url="$1" name="$2" tries=60
  while (( tries-- )); do
    curl -sf "$url" >/dev/null && { echo "  OK   $name"; return 0; }
    sleep 1
  done
  echo "  FAIL $name — $url never answered" >&2
  podman logs --tail 40 "${UNIVERSE}-ctr-${name}" >&2 || true
  return 1
}

port_of() { jq -r --arg b "brick-$1" '.bricks[$b].port' "$MANIFEST"; }
LOGGER_URL="http://127.0.0.1:$(port_of logger)"
QUEUE_URL="http://127.0.0.1:$(port_of queue)"

# What each unit needs beyond its database — declared once, here.
unit_args() {
  local slug="$1" port="$2"
  case "$slug" in
    vault)
      echo "-e VAULT_PORT=$port -e VAULT_MASTER_KEY_FILE=/apps/vault/etc/vault/master.key -e VAULT_TOKEN"
      echo "-v $KEY_FILE:/apps/vault/etc/vault/master.key:ro,Z"
      ;;
    logger)
      echo "-e LOGGER_PORT=$port"
      ;;
    queue)
      echo "-e QUEUE_PORT=$port -e LOGGER_URL=$LOGGER_URL -e QUEUE_AUTO_DISPATCH=0"
      ;;
    maestro)
      echo "-e MAESTRO_PORT=$port -e MAESTRO_AUTO_START=1 -e LOGGER_URL=$LOGGER_URL -e MAESTRO_QUEUE_URL=$QUEUE_URL"
      echo "-e MAESTRO_TASKS_FILE=/data/univ/task-schedule.json -e LOG_DIR=/apps/maestro/log"
      echo "-v $UNIV/task-schedule.json:/data/univ/task-schedule.json:ro,Z -v $APPS_ROOT/maestro/log:/apps/maestro/log:Z"
      ;;
    *) echo "[podman-up] no runtime wiring declared for unit $slug" >&2; return 1 ;;
  esac
}

export VAULT_TOKEN
layer=0
while read -r bricks; do
  echo "[podman-up] layer $layer — $bricks"
  for brick in $bricks; do
    db="$(jq -c --arg b "$brick" '.bricks[$b].database' "$MANIFEST")"
    slug="$(jq -r '.slug' <<<"$db")"; uid="$(jq -r '.uid' <<<"$db")"; schema="$(jq -r '.schema' <<<"$db")"
    port="$(jq -r --arg b "$brick" '.bricks[$b].port' "$MANIFEST")"
    image="$(resolve_image "$(jq -r --arg b "$brick" '.bricks[$b].image' "$MANIFEST")")"
    [[ "$(jq -r '.engine' <<<"$db")" == mariadb ]] || { echo "[podman-up] $brick declares no private MariaDB — Rule 26 forbids starting it" >&2; exit 1; }

    podman pull -q "$image" >/dev/null 2>&1 || podman image exists "$image" \
      || { echo "[podman-up] image $image is neither pullable nor present" >&2; exit 1; }

    bash "$SOFTWARE/scripts/provision-unit-mariadb.sh" --universe "$UNIVERSE" --slug "$slug" --uid "$uid" \
      --mariadb-image "$SHAPER_MARIADB_IMAGE" --unit-image "$image" --schema "$schema" --apps-root "$APPS_ROOT"

    if [[ "$slug" == vault ]]; then
      # The key belongs to the account that reads it, and to nobody else.
      chown vault:vault "$KEY_FILE"; chmod 0400 "$KEY_FILE"
    fi

    # shellcheck disable=SC2046
    podman run -d --name "${UNIVERSE}-ctr-${slug}" --replace --network host --restart=always \
      --user "$uid:$uid" \
      -e HOST=127.0.0.1 -e SHAPER_UNIT_SLUG="$slug" -e SHAPER_DB_SOCKET=/run/mysqld/mysqld.sock \
      -e SHAPER_UNIVERSE_ID="$UNIVERSE" \
      -v "$APPS_ROOT/$slug/nosav/run/mysqld:/run/mysqld:z" \
      -v "$APPS_ROOT/$slug/etc/mysql/localhost/passwd:/apps/$slug/etc/mysql/localhost/passwd:ro,Z" \
      $(unit_args "$slug" "$port") \
      "$image" >/dev/null
  done
  for brick in $bricks; do
    slug="$(jq -r --arg b "$brick" '.bricks[$b].database.slug' "$MANIFEST")"
    wait_healthy "http://127.0.0.1:$(jq -r --arg b "$brick" '.bricks[$b].port' "$MANIFEST")/api/health" "$slug"
  done
  layer=$((layer + 1))
done < <(jq -r '.bootOrder[] | join(" ")' "$MANIFEST")

echo "[podman-up] $UNIVERSE is up. Prove it: bash $UNIV/deploy/proof.sh"
