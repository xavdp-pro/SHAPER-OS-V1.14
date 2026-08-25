#!/usr/bin/env bash
SLUG="univ-test-child"
echo "[child-down] Stopping containers for $SLUG..."
podman rm -f "${SLUG}-vault" "${SLUG}-logger" "${SLUG}-bridge-deepseek" "${SLUG}-queue" "${SLUG}-maestro" 2>/dev/null || true
echo "[child-down] Cleaned up."
