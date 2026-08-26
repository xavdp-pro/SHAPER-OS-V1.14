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

## Generic boundary

`pkg-agent-runtime` and `brick-agent-runtime` are generic. They dispatch a
universe-declared `task-*` to one selected `brick-bridge-*`; they know no IMAP,
SMTP, client, customer or business workflow. Mail intake belongs to catalogue
`pkg-mail-agent` and to the universe that declares the related `task-*`.
