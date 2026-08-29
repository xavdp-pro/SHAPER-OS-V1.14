# Naming Contract

Every identifier states its layer. Do not infer a layer from context.

| Prefix | Layer | Example |
| :--- | :--- | :--- |
| `univ-` | Deployable universe | `univ-base` |
| `brick-` | OCI service definition | `brick-bridge-opencode` |
| `pkg-` | Reusable source package | `pkg-bridge-opencode` |
| `img-` | Registry image | `img-bridge-opencode` |
| `ctr-` | Running container role | `univ-base-ctr-bridge-opencode` |
| `vol-` | Persistent universe-owned volume | `vol-univ-base-vault` |
| `cfg-` | Configuration file or object | `cfg-univ-base.env` |
| `ctx-` | Agent context | `ctx-mail-triage.md` |
| `task-` | Declared unit of work | `task-mail-triage` |
| `proof-` | Evidence artefact | `proof-univ-base-<release>` |

A component may exist at several layers. For example, `pkg-bridge-opencode`
is code; `brick-bridge-opencode` is the OCI service built from it; and
`img-bridge-opencode` is its immutable registry artefact. They are not synonyms.

**A layer must be earned, not claimed.** A `brick-` directory ships a
`Containerfile` — if no `podman build` can turn it into an image, it is a package
and it is named `pkg-`. Until V1.11 two directories carried the `brick-` prefix
with nothing to build; a test now refuses that. `@shaper/pkg-agent-runtime` and
`@shaper/pkg-auth` are the two, and they run inside the images that vendor them.

## Generic boundary

`pkg-agent-runtime` is generic. It dispatches a universe-declared `task-*` to one
selected `brick-bridge-*`; it knows no IMAP, SMTP, client, customer or business
workflow, and neither does `pkg-maestro`, which vendors it. A task carries a
`slug` and a cadence — nothing else is required of it, because requiring a
`label` and a `port` is how a monitored mailbox and its container port survived a
rename and stayed in the base. Mail intake belongs to catalogue `pkg-mail-agent`
and to the universe that declares the related `task-*`.

## Where a universe states origin

A universe manifest declares, for every brick, whether it comes from the base or
from the catalogue:

```json
"brick-vault": { "source": "base", "package": "@shaper/pkg-vault", "image": "img-vault", ... }
```

Nothing is inferred from a path. `@shaper/pkg-universe` validates it, and a base
universe that needs `source: catalogue` fails the base's own test suite — it
belongs in the catalogue, beside the brick it needs.

## The universe field and the repo name (V1.13)

For a **class repo**, the manifest's `universe` field IS the class name and
matches the repository name exactly (`univ-mailo-core` in the repo
`univ-mailo-core`). Universes living **inside the base** (`univ-base`, the
`_template`, test universes) are not class repos — they keep their short
slugs and are exempt from the `univ-<projet>-<classe>` grammar, which binds
repositories, not in-base folders (Rule 1).
