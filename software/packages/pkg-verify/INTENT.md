# INTENT — pkg-verify

## What it is

The law, made executable where it can be. `shaper verify` runs one small check
per enforceable rule and reports, for the whole canon, which rules are
mechanically enforced and which still bind by reading alone.

## Why it exists

The rules bind by text, and text fails silently: four manifests pointed at a
previous base version for a release and nothing noticed; credentials shipped in
a public repository; two agents read "the base universe" and built different
things. Each check here was born from an incident that already happened — this
is the Boot Contract's point 8 applied to the law itself.

## Invariants

1. **A check cites its rule.** A failing check prints the rule it enforces and
   where to read it. The tooling teaches the law; it never replaces it — the
   canon is still read in full (LAW.md).
2. **One check, one file, named by what it enforces.** A check is small enough
   to be read in one look and regenerated from the rule's text.
3. **Checks are generic.** They run on any SHAPER repository — the base, the
   catalogue, a universe repo — with no per-repo configuration. A check that
   only works on one repo is not law, it is a script.
4. **The coverage report is part of the output.** The share of the canon that
   is not yet mechanically enforced is a visible number, and it may only go
   down by writing checks, never by hiding rules.
5. **No dependencies.** Node built-ins only. The verifier must run on a fresh
   clone before anything is installed, because that is exactly when it matters.

## What it checks today

| Check | Rule made active | The incident it was born from |
| :--- | :--- | :--- |
| `map-links` | AGENTS.md — documentation is a map | `docs/pkg-agent-runtime/` linked but never existed |
| `version-coherence` | Rule 0D — dual intent & topology manifests | Four manifests still named V1.11 in a V1.12 release; then one package said 1.13.23 beside sixteen saying 1.13.2 while verify reported the release named itself once. The check reads the repository's version from its folder name (`SHAPER-OS-V1.13`) and judges the tracked tree (`git ls-files`; a disk walk only where git cannot answer, so an operator's untracked universe copy is never judged): the root `package.json` is the reference and must carry the folder's version; every other tracked `package.json` must declare exactly the root's version; every `manifest*.json` must point cross-repo at the folder's version and, when it carries a `version`, say exactly the root's; a file that does not parse is a finding naming it, not a stack trace |
| `committed-identity` | Boot Contract 10b — never commit what is yours alone | Accounts and passwords shipped in a public repo. Then a registry address, an account and its real password shipped as shell fallbacks `${VAR:-value}` for a whole release, under a check that knew only the JavaScript spelling `process.env.X \|\| 'value'` (V1.13.2) — the check now reads both spellings, and matches `PASS`/`PWD` as whole segments so that `REGISTRY_PASS` is a password and `BYPASS_CACHE` is not |
| `profile-bootorder` | AGENTS.md §4b + Boot Contract 6 | Two agents, the same words, two different systems |
| `fix-ships-test` | Rule 29 — every fixed bug ships its test | Bugs closed on "it works now", met again in v1.8 |
| `manifest-lineage` | Rule 37 — perimeter, source, forkedFrom | Perimeters inferred from a fixed table; forks with unstated origins (V1.13) |
| `universe-slug-grammar` | Rule 1 — univ-<projet>-<classe> | univ-shop and univ-client helped nobody (operator feedback, paraphrased) — the family was missing from the name (V1.13) |
| `prod-declares-alerting` | Rule 27 — the channel is declared | Four of five archetype designs routed alerts to a UI nobody watches (V1.13) |

## How to run

```bash
node software/packages/pkg-verify/verify.mjs            # repo of the cwd
node software/packages/pkg-verify/verify.mjs --root /path/to/repo
```

Exit code 0: every check passed. Exit code 1: at least one rule is violated —
stop, fix, do not stub your way to green.
