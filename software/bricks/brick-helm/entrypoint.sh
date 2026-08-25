#!/bin/sh
set -e

MARIADB_DATA_DIR="/data/mariadb"
mkdir -p "$MARIADB_DATA_DIR" /data/timelines /data/state /run/mysqld
chown -R mysql:mysql "$MARIADB_DATA_DIR" /run/mysqld 2>/dev/null || true

if [ ! -d "$MARIADB_DATA_DIR/mysql" ]; then
  echo "[shaper-helm-entrypoint] Installation de la base MariaDB..."
  mariadb-install-db --user=mysql --datadir="$MARIADB_DATA_DIR" --skip-test-db >/dev/null 2>&1
fi

echo "[shaper-helm-entrypoint] Démarrage du daemon MariaDB avec init-file..."
mariadbd --user=mysql --datadir="$MARIADB_DATA_DIR" --init-file=/app/init.sql --skip-networking=OFF --bind-address=0.0.0.0 --port=3306 --socket=/run/mysqld/mysqld.sock &

for i in $(seq 1 30); do
  if mariadb-admin --socket=/run/mysqld/mysqld.sock ping >/dev/null 2>&1; then
    echo "[shaper-helm-entrypoint] MariaDB opérationnel sur le port 3306 !"
    break
  fi
  sleep 1
done

echo "[shaper-helm-entrypoint] Lancement du serveur Web Shaper-Helm (Node.js)..."
exec node server/index.js
