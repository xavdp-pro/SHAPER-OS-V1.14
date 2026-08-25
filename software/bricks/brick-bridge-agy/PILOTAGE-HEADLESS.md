# Piloter Antigravity sans IDE ni demande de permission

> **Question posée** : peut-on discipliner Antigravity pour l'utiliser sous commande de test,
> sans qu'il réclame des autorisations dans l'IDE ?
> **Réponse** : oui. Le CLI `agy` a tout ce qu'il faut, et le bridge de cette brique existe déjà.

---

## 1. Les deux voies

### Voie A — le CLI en direct (boucle courte, un seul agent)

```bash
agy -p "<consigne>" \
    --output-format json \
    --mode accept-edits \
    --sandbox
```

| Drapeau | Ce qu'il règle |
| :--- | :--- |
| `-p` / `--print` | **une seule consigne, non interactive**, puis sortie. C'est le mode « commande de test ». |
| `--output-format json` | sortie exploitable par un script. `stream-json` pour du NDJSON au fil de l'eau. |
| `--json-schema <fichier>` | impose la **forme** de la réponse — indispensable si un script consomme le résultat. |
| `--mode accept-edits` | l'agent applique ses modifications sans confirmation. `plan` pour qu'il propose sans toucher. |
| `--sandbox` | restrictions de terminal. **À conserver** dès qu'on retire les confirmations. |
| `--effort low\|medium\|high` | dose le raisonnement, donc le coût. |
| `--conversation <id>` / `--continue` | reprend une session existante. |
| `--add-dir <chemin>` | limite l'espace de travail aux répertoires déclarés. |
| `--input-format stream-json` | une consigne NDJSON par ligne sur l'entrée standard : **le mode lot**. |

### Voie B — le bridge HTTP (orchestration, plusieurs appelants)

C'est la voie recommandée dès qu'un autre composant pilote l'agent : la queue, Maestro, un test.
L'appelant **ne lance jamais `agy`** — il parle HTTP au bridge, qui possède le process.

```bash
TOKEN=$(cat <chemin-du-token-bridge>)

# 1. Ouvrir le flux AVANT d'injecter, sinon on rate les premiers événements
curl -sN -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:4330/api/events?conversation=test-pipeline"

# 2. Injecter
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"conversation":"test-pipeline","message":"<consigne>","model":"gemini-3.7-flash-low"}' \
  http://127.0.0.1:4330/api/inject
```

Événements reçus : `connected`, `inject`, `response`, `response_complete`, `run_complete`, `log`.
`conversation` est un identifiant stable : même id, même espace de travail.

---

## 2. Le piège des clés — cause de gel connue

| Variable | Préfixe | Effet |
| :--- | :--- | :--- |
| **`ANTIGRAVITY_API_KEY`** | `AQ.` | ✅ la bonne |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `AIza…` | ❌ force `modelProvider: gemini` → **429 et agent qui gèle** |

`buildAgySpawnEnv()` de cette brique supprime déjà `GEMINI_API_KEY` et `GOOGLE_API_KEY` de
l'environnement du process fils, et n'accepte la clé que si elle commence par `AQ.`.
Ne pas contourner ce garde-fou.

---

## 3. État constaté sur cette machine

```
GET /api/health :4330
{"ok":true,"service":"univ-bridge-agy","port":4330,
 "model":"gemini-3.7-flash-low","stubMode":true,"hasApiKey":false}
```

* Le bridge **tourne et répond**.
* `hasApiKey: false` → **aucune clé configurée**, donc `stubMode: true` : il simule au lieu de
  piloter le vrai `agy`. C'est le seul élément manquant.
* Le binaire `agy` est présent sur la machine.

**Pour activer** : renseigner `ANTIGRAVITY_API_KEY=AQ.…` dans l'environnement du bridge, puis
le redémarrer. `hasApiKey` doit passer à `true` et `stubMode` à `false`.

---

## 4. Sur `--dangerously-skip-permissions`

Ce drapeau existe et fait exactement ce que son nom dit : **il approuve d'office toute demande
d'outil**. Il porte cet avertissement pour une raison.

Position retenue :

* En **commande de test**, `--mode accept-edits --sandbox --add-dir <périmètre>` suffit dans la
  très grande majorité des cas, et laisse le bac à sable en place.
* `--dangerously-skip-permissions` ne se justifie que dans un **conteneur jetable, sur un
  périmètre déclaré**, jamais sur la machine de travail ni sur un dépôt vivant.
* Combiné à `--sandbox` et `--add-dir`, il reste borné. Seul, il ne l'est pas.

> Retirer les confirmations est un choix d'exploitation, pas un raccourci de développement :
> ce qui protégeait n'était pas la question posée à l'humain, c'était le périmètre. Si on
> supprime la question, il faut resserrer le périmètre d'autant.
