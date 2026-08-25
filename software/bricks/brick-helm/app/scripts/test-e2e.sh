#!/usr/bin/env bash
# Lance les tests Playwright — auth JWT (bypass login) ou mot de passe.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f e2e/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source e2e/.env
  set +a
fi

# Sur gbs-h1 : réutilise JWT_SECRET serveur si pas déjà dans e2e/.env
if [[ -z "${HELM_E2E_JWT_SECRET:-}" ]]; then
  HELM_E2E_JWT_SECRET=$(node -e "import { config } from './server/config.js'; process.stdout.write(config.jwtSecret || '')")
  export HELM_E2E_JWT_SECRET
fi

export HELM_E2E_USER_ID="${HELM_E2E_USER_ID:-3}"
export HELM_E2E_EMAIL="${HELM_E2E_EMAIL:-xavier@xavdp.pro}"

if [[ -z "${HELM_E2E_JWT_SECRET:-}" ]] && [[ -z "${HELM_E2E_PASSWORD:-}" ]]; then
  echo "Manquant: HELM_E2E_JWT_SECRET (ou JWT_SECRET serveur) ou HELM_E2E_PASSWORD dans e2e/.env" >&2
  exit 1
fi

exec npm run test:e2e "$@"
