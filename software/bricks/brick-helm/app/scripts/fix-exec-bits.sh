#!/usr/bin/env bash
# À lancer après `tb app sudo/bulldozer helm-v2` si build/vite casse (esbuild).
#
# Bridges + CLI IA : /opt/bridge/ (hors /apps/) — bulldozer ne les touche pas.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Restauration +x sur les binaires natifs (node_modules app)…"
find node_modules -type f -path "*/bin/esbuild" -exec chmod +x {} \; 2>/dev/null
find node_modules -type f -path "*/@esbuild/*/bin/esbuild" -exec chmod +x {} \; 2>/dev/null
find "$(readlink -f node_modules 2>/dev/null || echo node_modules)" -type f -path "*@esbuild*/bin/esbuild" -exec chmod +x {} \; 2>/dev/null

echo "▶ Hook git pre-push (restauré depuis git si perdu)…"
git checkout -- scripts/git-hooks/pre-push 2>/dev/null || true
chmod +x scripts/git-hooks/pre-push scripts/test-chat.sh scripts/*.sh 2>/dev/null || true

echo "▶ CLI / bridges : /opt/bridge (hors bulldozer)…"
if [[ -x /opt/bridge/cursor/bin/cursor-agent ]]; then
  echo "   cursor-agent OK"
else
  echo "   ⚠ manquant — sudo bash /opt/bridge/scripts/install-opt-clis.sh"
fi

echo "✅ Bits d'exécution restaurés (app seulement)."
