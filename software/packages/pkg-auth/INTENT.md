# Package: @shaper/pkg-auth

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Shared HTTP authorization and short-lived Vault-signed unit credentials — no business logic.

## 2. Invariants

1. Stateless — no session store.
2. Legacy static Bearer verification permits empty config only on its existing
   prototype surface. Unit-credential authorization refuses missing key,
   universe, audience or current-revocation verification; no anonymous fallback.
3. Zero coupling to any universe or brick.
4. English-only API surface.

## 3. Why this is a package and not a brick

Bearer verification is a few lines executed in the request path of the service
being protected. It has no port, no lifecycle and no image; the `brick-auth`
directory that existed until V1.11 described a container nothing ever built.
Every service that needs the policy imports it — that is the whole deployment.

## 4. Cognition

> Scales and semantics: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Token comparison is mechanical. A model has no place in an authorisation decision.

<a id="secret-files"></a>
## Secrets as private files

`secret-file.js` is how a unit reads a secret it consumes (SOL-DECISIONS-2
§M): from the file `<NAME>_FILE` names — a regular file of the reading
account, not a symbolic link, with no group or other permission bit, not
empty — read once into memory and never placed back into any environment.
A value in the environment itself (`<NAME>=…`) is refused
(`SECRET_IN_ENVIRONMENT`) unless the caller allows it for a disposable DEV
store; both set is refused (`SECRET_AMBIGUOUS`). No error carries the value.
Vault (`VAULT_MASTER_KEY_FILE`, `VAULT_TOKEN_FILE`), Queue
(`QUEUE_BRIDGE_TOKEN_FILE`, `BRIDGE_AUTH_TOKEN_FILE`) and Maestro
(`BRIDGE_AUTH_TOKEN_FILE`) read their secrets through it.

## Vault-signed unit identities

`unit-credentials.js` provides a versioned Ed25519-signed envelope. Its signed
claims bind a universe UUID, unit, runtime incarnation, one audience, exact
scopes, issue/expiry times, credential id, epoch and revocation reference.
A unit name and an audience follow one functional-slug grammar, shared with
pkg-db and the unit runtime (`UNIT_NAME_PATTERN`): a lowercase letter, then at
most 31 lowercase letters, digits, underscores or hyphens, not ending with a
hyphen. A hyphenated slug such as `brick-voice` is accepted as it is in
validation, audience, Vault registration and storage — never rewritten into an
alias (Rule 4, one name everywhere).
Validity is at most 300 seconds; future-issued, expired, malformed, tampered,
foreign-universe/audience and insufficient-scope credentials are refused.
A protected service also checks the current incarnation and revocation with
Vault; signature validity alone grants no surviving authority.

Vault itself renews its own logger-audience credential through the same
`runtimeCredentialClient`, with an in-process `issuer` and the issuing public
key in place of the HTTP request and the pinned key file: same bootstrap file,
incarnation, renewal and verification, no request to itself.

`runtime-identity.js` loads a parent-pinned public key and an owner-only runtime
bootstrap file. It renews credentials in memory before expiry, coalesces
concurrent renewals and never persists access tokens. The bootstrap capability
is bounded by the parent's registered expiry, incarnation and grants; it is
not accepted at application data APIs. Parent replacement/revocation invalidates
the incarnation. These runtime files are excluded from backups.

Each request to Vault is bounded to three seconds. Missing Vault verification
refuses current-authority validation; no permanent bypass is introduced. The
parent controls registration and bounded bootstrap redelivery. No service can
choose its scopes by passing them in the issuance request.
