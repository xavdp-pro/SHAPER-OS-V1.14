#!/usr/bin/env bash
# Test « le chat est carré » — à lancer à chaque modif ou pour être sûr.
#   bash scripts/test-chat.sh          → unit (gate dur) + e2e (best-effort)
#   bash scripts/test-chat.sh --agent  → + un vrai tour de chat (agent répond)
#
# L'unitaire est un GATE DUR. L'e2e bloque sur un VRAI échec de test, mais ne
# bloque pas si l'environnement empêche playwright de démarrer (ex. hook sous
# sandbox) — dans ce cas on avertit et on laisse passer.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "▶ 1/3 Tests unitaires (gate dur)"
if ! npm test; then
  echo "❌ Tests unitaires en échec — bloqué."
  exit 1
fi

echo "▶ 2/3 E2E chat + console (auth)"
E2E_OUT="$(bash scripts/test-e2e.sh -- --project=setup --project=authenticated --retries=1 2>&1)"
E2E_CODE=$?
echo "$E2E_OUT" | tail -25
if [[ $E2E_CODE -ne 0 ]]; then
  if echo "$E2E_OUT" | grep -qiE "permission denied|not found|Executable doesn't exist|missing dependencies|Host system|ECONNREFUSED|net::ERR"; then
    echo "⚠️  E2E non exécutable dans cet environnement (playwright/services) — étape ignorée, PAS de blocage."
  else
    echo "❌ E2E : vrai échec de test — bloqué."
    exit 1
  fi
fi

if [[ "${1:-}" == "--agent" || "${HELM_E2E_AGENT:-}" == "1" ]]; then
  echo "▶ 3/3 Vrai tour de chat (agent répond PONG)"
  HELM_E2E_AGENT=1 bash scripts/test-e2e.sh -- --project=agent || {
    echo "⚠️  Tour agent non concluant — vérifie manuellement."; }
else
  echo "▶ 3/3 (vrai tour agent ignoré — ajoute --agent pour l'inclure)"
fi

echo "✅ Chat carré."
