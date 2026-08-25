# helm-v2 (KovZu)

Console multi-CLI en mode **plugin** — évolution de helm-v1.

**Repo privé :** https://github.com/xavdp-pro/helm-v2

## Stack

| Service | Port | PM2 |
|---------|------|-----|
| Vite preview | 7923 | `helm-v2-vite` |
| API Express | 7926 | `helm-v2-api` |
| cursor-agent-bridge | 4310 | systemd user `helm-v2` |
| claude-bridge | 4320 | `helm-v2-claude-bridge` |
| LiteLLM | 4330 | `helm-v2-litellm` |

App turbinobash : `helm-v2` (MariaDB + user Unix).

## Plugins

Contrat HTTP commun (`inject` / `events` / `stop` / `status`) :

- **cursor** → Cursor CLI (modèles Grok 4.5 low/medium/high ± fast, Composer 2.5)
- **claude** → [claude-code-llm](https://github.com/xavdp-pro/claude-code-llm) (Claude Code + LiteLLM)

Ack vocal **Groq** avant la réponse, quel que soit le CLI.

## Quick start (gbs-h1)

```bash
cd /apps/helm-v2/app
npm install
npm test
npm run build
pm2 startOrReload ecosystem.prod.config.cjs --update-env
sudo bash /opt/bridge/scripts/install-opt-clis.sh      # CLI (si besoin)
bash /opt/bridge/cursor/scripts/install-h1.sh          # cursor :4310
# Claude + LiteLLM (systemd recommandé)
systemctl --user -M helm-v2@ enable --now claude-bridge
# ou PM2 :
pm2 start /opt/bridge/claude/run-litellm.sh --name helm-v2-litellm --interpreter bash
pm2 start /opt/bridge/claude/start-bridge.sh --name helm-v2-claude-bridge --interpreter bash
pm2 save
```

Login démo : `thesuperuser@helm.local`

## Docs

- `mds/AGENT-CONTEXT.md` — source de vérité
- `mds/OPT-BRIDGE.md` — stack bridge complet sous `/opt/bridge` (hors backup app)
- Ponts : `/opt/bridge/cursor`, `/opt/bridge/claude`
