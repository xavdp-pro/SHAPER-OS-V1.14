#!/usr/bin/env bash
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SLUG="univ-wordpress-child"
FATHER="$(cd "$UNIV/../univ-wordpress-father" && pwd)"
# Repository root, resolved by walking up until the software tree is found, so a
# universe can be filed at any depth (it lives under univs/ since v1.8).
REPO_ROOT="$(cd "$UNIV/.." && pwd)"
while [ ! -d "$REPO_ROOT/software" ] && [ "$REPO_ROOT" != "/" ]; do
  REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
done
[ -d "$REPO_ROOT/software" ] || { echo "software/ not found above $UNIV — are you inside the SHAPER OS repository?" >&2; exit 1; }
REMOTE_ENV="${SHAPER_REMOTE_ENV:-$(cd "$REPO_ROOT/.." && pwd)/.env}"
ENV_FILE="${1:-$UNIV/deploy/env}"

if [[ -f "$REMOTE_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$REMOTE_ENV"
  set +a
fi
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${WP_ZONE:?not set — ask the human operator for the DNS zone (it must already be managed in Cloudflare); this repository ships no domain}"
export WP_ZONE
export WP_MANAGER_SLUG="${WP_MANAGER_SLUG:-wpmanager01}"
export WP_SITE_SLUG="${WP_SITE_SLUG:-wp01}"
export LOGGER_PORT="${LOGGER_PORT:-9520}"
export MARIADB_PORT="${MARIADB_PORT:-9536}"
export WP_PORT="${WP_PORT:-9580}"
export VITALS_WP_PORT="${VITALS_WP_PORT:-9560}"
export VITALS_DB_PORT="${VITALS_DB_PORT:-9561}"
export MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-wp-dev-root}"
export MYSQL_DATABASE="${MYSQL_DATABASE:-wordpress}"
export MYSQL_USER="${MYSQL_USER:-wp}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-wp-dev-pass}"

WP_PUBLIC_HOST="${WP_SITE_SLUG}.${WP_MANAGER_SLUG}.${WP_ZONE}"
WP_PUBLIC_URL="https://${WP_PUBLIC_HOST}"
WP_CONFIG_EXTRA="define('WP_HOME', '${WP_PUBLIC_URL}'); define('WP_SITEURL', '${WP_PUBLIC_URL}');"

mkdir -p "$UNIV/log" \
  "$UNIV/sav/mariadb" \
  "$UNIV/sav/wordpress/uploads" \
  "$UNIV/sav/wordpress/plugins" \
  "$UNIV/sav/ssh"

if [[ -f "$FATHER/sav/ssh/id_ed25519.pub" ]]; then
  cp "$FATHER/sav/ssh/id_ed25519.pub" "$UNIV/sav/ssh/authorized_keys"
fi

echo "[child-up] Deploying $SLUG → ${WP_PUBLIC_URL}"

podman run -d --name "${SLUG}-logger" --network host --replace --cgroups=disabled \
  -e PORT="$LOGGER_PORT" \
  -e LOG_DIR="/data/univ/log" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-logger:latest

podman network create shaper-wp-net 2>/dev/null || true

podman run -d --name "${SLUG}-mariadb" --network shaper-wp-net --replace --cgroups=disabled \
  -e MARIADB_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
  -e MARIADB_DATABASE="$MYSQL_DATABASE" \
  -e MARIADB_USER="$MYSQL_USER" \
  -e MARIADB_PASSWORD="$MYSQL_PASSWORD" \
  -v "$UNIV/sav/mariadb:/var/lib/mysql:Z" \
  docker.io/library/mariadb:11

podman run -d --name "${SLUG}-wordpress" --network shaper-wp-net --replace --cgroups=disabled \
  -p "127.0.0.1:${WP_PORT}:80" \
  -e WORDPRESS_DB_HOST="${SLUG}-mariadb:3306" \
  -e WORDPRESS_DB_USER="$MYSQL_USER" \
  -e WORDPRESS_DB_PASSWORD="$MYSQL_PASSWORD" \
  -e WORDPRESS_DB_NAME="$MYSQL_DATABASE" \
  -e WORDPRESS_CONFIG_EXTRA="$WP_CONFIG_EXTRA" \
  -v "$UNIV/sav/wordpress/uploads:/var/www/html/wp-content/uploads:Z" \
  docker.io/library/wordpress:6.7-php8.2-apache

WP_URL="http://127.0.0.1:${WP_PORT}" \
WP_PUBLIC_URL="$WP_PUBLIC_URL" \
WP_UPLOADS="$UNIV/sav/wordpress/uploads" \
WP_PLUGIN_DIR="$UNIV/sav/wordpress/plugins" \
WORDPRESS_DB_HOST="127.0.0.1" \
WORDPRESS_DB_PORT="$MARIADB_PORT" \
  node "$UNIV/lib/vitals-probe.mjs" --role=wordpress --port="$VITALS_WP_PORT" &
echo $! > "$UNIV/vitals-wordpress.pid"

WORDPRESS_DB_HOST="127.0.0.1" \
WORDPRESS_DB_PORT="$MARIADB_PORT" \
  node "$UNIV/lib/vitals-probe.mjs" --role=mariadb --port="$VITALS_DB_PORT" &
echo $! > "$UNIV/vitals-mariadb.pid"

sleep 2
echo "[child-up] Local  http://127.0.0.1:${WP_PORT}"
echo "[child-up] Public https://${WP_PUBLIC_HOST} (via father Cloudflare tunnel ingress)"
echo "[child-up] Vitals :${VITALS_WP_PORT} / :${VITALS_DB_PORT}  MariaDB :${MARIADB_PORT}"
