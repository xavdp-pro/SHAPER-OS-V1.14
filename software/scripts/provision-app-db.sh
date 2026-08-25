#!/usr/bin/env bash
# Provision on-demand MariaDB database for a SHAPER OS app brick.
# Convention: user = database = <app-slug>, passwd in Turbinobash layout.
#
# Usage:
#   provision-app-db.sh --universe immo --app-slug crm-immo
#   provision-app-db.sh --app-slug wikiuniv-v1 --sql-file ./sql/schema.sql
#
set -euo pipefail

UNIVERSE=""
APP_SLUG=""
SQL_FILE=""
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_ROOT_USER="${MYSQL_ROOT_USER:-root}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"

usage() {
  sed -n '3,8p' "$0"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --universe) UNIVERSE="$2"; shift 2 ;;
    --app-slug) APP_SLUG="$2"; shift 2 ;;
    --sql-file) SQL_FILE="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

[[ -n "$APP_SLUG" ]] || { echo "Error: --app-slug is required"; exit 1; }

if [[ -z "$MYSQL_ROOT_PASSWORD" ]]; then
  echo "Error: MYSQL_ROOT_PASSWORD is required for provisioning"
  exit 1
fi

PASSWD_DIR="/apps/${APP_SLUG}/etc/mysql/localhost"
PASSWD_FILE="${PASSWD_DIR}/passwd"
APP_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"

mysql_exec() {
  mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_ROOT_USER" -p"$MYSQL_ROOT_PASSWORD" -e "$1"
}

echo "[provision-app-db] Universe: ${UNIVERSE:-<none>} | App: ${APP_SLUG}"

mysql_exec "CREATE DATABASE IF NOT EXISTS \`${APP_SLUG}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql_exec "CREATE USER IF NOT EXISTS '${APP_SLUG}'@'localhost' IDENTIFIED BY '${APP_PASSWORD}'"
mysql_exec "GRANT ALL PRIVILEGES ON \`${APP_SLUG}\`.* TO '${APP_SLUG}'@'localhost'"
mysql_exec "FLUSH PRIVILEGES"

mkdir -p "$PASSWD_DIR"
printf '%s' "$APP_PASSWORD" > "$PASSWD_FILE"
chmod 600 "$PASSWD_FILE"

if [[ -n "$SQL_FILE" && -f "$SQL_FILE" ]]; then
  mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$APP_SLUG" -p"$APP_PASSWORD" "$APP_SLUG" < "$SQL_FILE"
  echo "[provision-app-db] Applied schema: ${SQL_FILE}"
fi

echo "[provision-app-db] OK — database=${APP_SLUG} user=${APP_SLUG} passwd=${PASSWD_FILE}"
