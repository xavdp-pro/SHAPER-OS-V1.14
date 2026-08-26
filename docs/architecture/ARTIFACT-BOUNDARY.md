# Artifact Boundary — Base, Package, Brick, Catalogue

The product of SHAPER OS is a verified universe, not a growing pile of product
code. This boundary keeps the base focused while letting the catalogue grow
without limit.

| Term | Meaning | Deployable |
| :--- | :--- | :---: |
| Package | Reusable source code with unit tests and no independent lifecycle. | No |
| Brick | One OCI image, one container, one declared responsibility. | Yes |
| Base | Behaviour defined and maintained by SHAPER's law. | Yes |
| Catalogue | Product or upstream technology with its own release pace. | Yes |

The criterion is ownership of behaviour, not size or usefulness. The Logger is
base because proof is a SHAPER law. A database is catalogue because it follows
an upstream project and is referenced as an OCI image.

The machine-readable inventory is
[`software/artifact-boundary.json`](../../software/artifact-boundary.json). Its
test proves that every shipped package and brick belongs to the base exactly
once, and that no base package imports catalogue source by a sibling path.

## Dependency rule

There are two different dependencies:

| Dependency | Example | Resolution |
| :--- | :--- | :--- |
| Build package | Vault uses Logger helpers. | Copied from a pinned base OCI artifact while building the brick. |
| Runtime service | Queue sends work to a bridge. | Declared by the universe and reached through its network contract. |

No repository adjacency is a dependency mechanism. A symbolic link, a sibling
checkout, or a wide build context only hides a dependency from the declaration.

## Registry contract

The registry endpoint is deployment configuration:

```text
SHAPER_REGISTRY=<private OCI registry>
SHAPER_IMAGE_TAG=<immutable release tag>
SHAPER_TLS_VERIFY=true|false
```

The base image carries only base packages:

```text
${SHAPER_REGISTRY}/shaper/base:${SHAPER_IMAGE_TAG}
```

A brick declares the packages it needs in `brick.json`, then copies them from a
pinned base image. `brick-vault` is the reference implementation. Its build
context is only `bricks/brick-vault/`; the vault and logger sources arrive from
the base image, never from the checkout beside it.

```text
base source -> base image -> registry
brick manifest + base digest -> brick image -> registry
universe manifest -> lockfile with exact digests -> TEST proof
```

The release tag communicates intent. The digest is the value stored in a TEST
or PROD lockfile. `latest` is not a deployable reference.

## Catalogue rule

`SHAPER-OS-BRICKS` hosts specialised bricks and their packages. A catalogue
component crosses into the base only through an HTTP contract, a declared input,
or a handler injected by the deployment. It never imports source from the base
checkout. The inverse is also forbidden: the base agent does not import mail
intake, GED or product code merely because it happens to be available locally.
