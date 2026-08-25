# Stack — helm-v1

> Détail complet : [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md)

```
Navigateur → <PUBLIC_HOST> → Vite :7823
                           → API :7826 (/api proxy)
                           → cursor-agent-bridge :4200
                           → cursor-agent CLI
                           → MariaDB helm-v1
```

| Service | Port | PM2 |
|---------|------|-----|
| Vite | 7823 | helm-vite |
| API | 7826 | helm-api |
| Bridge | 4200 | (séparé) |

cursorauto (séparé) : <OTHER_PUBLIC_HOST> — 7623 / 7626.
