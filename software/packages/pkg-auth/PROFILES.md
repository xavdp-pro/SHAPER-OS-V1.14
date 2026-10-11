# Rights profiles: short Vault-signed credentials between units

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint),
> with one declared instance table (§ 3) recorded here because this page is the
> interface two lots code against.

Source: SOL decision N (11 October 2026), wave-8 contract
`CLINIC/coordination/wave-turbinobash-20261010/CONTRACT-6.md`. Canon: Rules 0J
and 0K (credentials proper to each channel, no shared all-powerful token), the
Vault contract (inject only authorized consumers' credentials). The choice of a
Vault-signed Ed25519 credential comes from DECISIONS-20261011 §A; the canon does
not prescribe this mechanism for every realization.

This page is the shared interface between the base lot (BASE-N: issuer profiles,
registration of extra identities, the Node and Python client/verifier) and the
units that adopt it (CLINIC-N: brick-ipbx, brick-voice, brick-tools). What is
written here is what the base implements; a unit codes against this page, not
against the base's internals.

---

## 1. What changes, in one paragraph

Until now Vault issued, for one audience, **every scope** the parent granted that
unit for that audience: a unit allowed to read and to write another unit received
a single credential able to do both. A **rights profile** is a named, exact set of
scopes for one audience, **registered by the parent** with the unit's identity. A
unit asks for one profile at a time; Vault signs a credential carrying **only that
profile's scopes** and the profile's name. A read credential therefore cannot
mutate, whatever the caller does with it. The caller caches one credential per
**(audience, profile)**.

Audiences registered without profiles (the base: Logger, Queue, Maestro) keep
their behaviour unchanged.

## 2. Vocabulary and limits

| Term | Meaning | Grammar |
| :--- | :--- | :--- |
| unit | the holder: the functional slug Vault knows it by (`brick-voice`) | `^[a-z](?:[a-z0-9_-]{0,30}[a-z0-9_])?$` (pkg-auth `UNIT_NAME_PATTERN`) |
| audience | the receiver's functional slug (`brick-ipbx`) | same grammar |
| profile | a named right of one holder on one audience (`read`) | same grammar (`PROFILE_NAME_PATTERN`) |
| scope | one exact right a receiver checks on a route (`ipbx:read`) | `[A-Za-z0-9._:-]{1,190}`, never `*` |
| incarnation | the holder's current registered instance (`brick-voice-<16 hex>`) | `[A-Za-z0-9._:-]{1,190}` |
| epoch | bumped by the parent at each new incarnation or re-registration after revocation | integer ≥ 1 |

- A credential lives **at most 300 seconds** (`MAX_CREDENTIAL_SECONDS`; Vault's
  `UNIT_CREDENTIAL_TTL_SECONDS`, 1–300, default 300).
- One profile: 1 to 32 distinct scopes. One audience: 1 to 16 profiles.
- A profile name is unique within its audience, not across audiences: `read` on
  `brick-voice` and `read` on `brick-ipbx` are two profiles.
- Within one identity an audience is either **profiled** (only profiles) or
  **whole** (the legacy list of scopes) — never both.

### The registered grants (Vault's `unit_identities.grants`)

```json
{
  "logger":     ["logger:ingest"],
  "brick-ipbx": { "callctx": ["ipbx:callctx:claim"] },
  "brick-tools": { "planning-faq": ["tools:planning:read", "tools:planning:write", "tools:faq:read"] }
}
```

An array is a whole audience; an object maps profile → exact scopes. The parent's
records (`registration/records/<unit>.json`) and the daily renewal compare this
JSON exactly; a profile added, removed or changed is a re-registration.

### The signed claims

The envelope is unchanged (version 1, Ed25519, `payload.signature` in base64url).
A profiled credential carries one more claim, `profile`; a whole-audience
credential carries none.

```json
{ "kind": "shaper.unit.credential", "version": 1,
  "universe": "<uuid>", "unit": "brick-voice", "incarnation": "brick-voice-0123456789abcdef",
  "audience": "brick-ipbx", "profile": "callctx", "scopes": ["ipbx:callctx:claim"],
  "epoch": 3, "revocationRef": "brick-voice:3", "keyId": "<sha256 of Vault's SPKI>",
  "credentialId": "<uuid>", "issuedAt": 1791186000, "expiresAt": 1791186300 }
```

## 3. The Clinic profiles (decision N; the kit registers exactly these)

The package's code knows none of these names. They are the CLINIC-N kit's
declaration, recorded here so both lots read one table. Each line replaces one
static bearer, which leaves the kit, the secrets catalogue and the rotation
tooling once N is in place.

| Holder (unit) | Audience | Profile | Scopes | Replaces |
| :--- | :--- | :--- | :--- | :--- |
| `brick-tools` | `brick-voice` | `read` | `voice:read` | `VOICE_READ_TOKEN` |
| `brick-tools` | `brick-voice` | `write` | `voice:read` `voice:write` `voice:actor` | `VOICE_WRITE_TOKEN` |
| `brick-tools` | `brick-ipbx` | `read` | `ipbx:read` | `IPBX_READ_TOKEN` |
| `brick-tools` | `brick-ipbx` | `write` | `ipbx:read` `ipbx:write` `ipbx:actor` | `IPBX_WRITE_TOKEN` |
| `brick-voice` | `brick-ipbx` | `callctx` | `ipbx:callctx:claim` | `IPBX_CALLCTX_TOKEN` |
| `brick-voice` | `brick-tools` | `planning-faq` | `tools:planning:read` `tools:planning:write` `tools:faq:read` | `TOOLS_INTERNAL_VOICE_TOKEN` |
| `brick-ipbx` | `brick-tools` | `routing` | `tools:routing:read` | `TOOLS_INTERNAL_IPBX_TOKEN` |

The registration arguments, per holder (§ 4):

```
brick-tools  --profile brick-voice/read=voice:read
             --profile brick-voice/write=voice:read --profile brick-voice/write=voice:write --profile brick-voice/write=voice:actor
             --profile brick-ipbx/read=ipbx:read
             --profile brick-ipbx/write=ipbx:read --profile brick-ipbx/write=ipbx:write --profile brick-ipbx/write=ipbx:actor
brick-voice  --profile brick-ipbx/callctx=ipbx:callctx:claim
             --profile brick-tools/planning-faq=tools:planning:read --profile brick-tools/planning-faq=tools:planning:write
             --profile brick-tools/planning-faq=tools:faq:read
brick-ipbx   --profile brick-tools/routing=tools:routing:read
```

Which scope each receiver requires (routes as in DECISIONS-20261011 §A and
CONTRACT-3; their bodies, errors and business rules are unchanged):

| Receiver | Route | Scope required |
| :--- | :--- | :--- |
| brick-voice 8091 | every *read* route | `voice:read` |
| | every mutation (POST, PUT, PATCH, DELETE) | `voice:write` |
| | any request carrying `X-Clinic-Actor` | `voice:actor`, and `claims.unit === "brick-tools"` |
| | `GET /internal/rehearsals/<id>/stream` (WebSocket) | `voice:write` + `voice:actor`, held as a session (§ 7) |
| brick-ipbx 8094 | `GET` reads (`/internal/cdr`, `extensions`, `ring-group`, `recordings`, `retention`, `operations`, `lines`, `status`) | `ipbx:read` |
| | mutations, `POST /internal/extensions/<ext>/credentials`, `POST /internal/outbound-calls` | `ipbx:write` |
| | any request carrying `X-Clinic-Actor` | `ipbx:actor`, and `claims.unit === "brick-tools"` |
| | `POST /internal/call-contexts/<uuid>/claim` | `ipbx:callctx:claim` |
| | `GET /internal/dialplan/routing` | none: Asterisk's own connection (unchanged); the server itself acquires `brick-tools/routing` to ask tools |
| brick-tools 7661 | `GET /routing` | `tools:routing:read` |
| | `GET /slots`, `GET /appointments/by-phone` | `tools:planning:read` |
| | `POST /appointment`, `PUT /appointment/<id>` | `tools:planning:write` |
| | `GET /faq`, `GET /faq/answer` | `tools:faq:read` |

`X-Clinic-Actor` delegation is accepted only from tools holding the actor right:
a request with the header and a credential lacking `<x>:actor`, or issued to any
other unit, is `403` — never read as anonymous, never with the actor ignored. A
read credential with the header is `403` (the former read-bearer rule).

## 4. How a non-base unit is registered (the parent)

Only the parent registers: the universe's construction path, as root, holding the
master key and administering Vault's MariaDB through Vault's own socket. No unit
registers itself and no unit chooses its scopes or profiles: the issuance request
names a profile, and Vault grants it only if the parent registered it.

The base offers the installing universe one script, run like the base's others
(the kit's `base_script`, a clean environment, the base's settings file):

```
base/deploy/extra-identity.sh pin      --to <file>
base/deploy/extra-identity.sh live     --unit <slug> --bootstrap <file>
base/deploy/extra-identity.sh register --unit <slug> --bootstrap <file> --owner <uid> \
                                       (--profile <audience>/<profile>=<scope> | --grant <audience>=<scope>)…
base/deploy/extra-identity.sh revoke   --unit <slug>
```

- The unit must be named in the base's setting **`RENEWAL_EXTRA_IDENTITIES`**
  (`base/cfg-univ-minimal.env`, space-separated slugs: for the Clinic
  `brick-ipbx brick-voice brick-tools`). An undeclared slug, a base unit
  (`vault`, `logger`, `queue`, `maestro`) or `proof` is refused: the daily renewal
  inventories exactly what is declared, so a registered identity is never
  `unexpected` and a lost record is reported `missing`.
- **`pin`** installs Vault's signing public key (the parent's derivation, the one
  `podman-up.sh` pinned) at `<file>`, root-owned, mode 0644. Every receiver mounts
  it read-only and names it `UNIT_AUTH_PUBLIC_KEY_FILE`.
- **`register`** holds the parent lock, draws a new incarnation
  `<slug>-<16 hex>`, writes a fresh bootstrap (owner-only), has the registration
  tool of the running Vault image build the statement (digest only), applies it
  as root through Vault's socket, reads it back, delivers the bootstrap to
  `<file>` (owner `<uid>`, mode 0600, its directory must be root-owned and not
  group- or other-writable) and writes the root-only record. It prints **only the
  new incarnation** on standard output; the unit's container is then created with
  `SHAPER_UNIT_INCARNATION=<that>`. A new incarnation bumps the epoch: every
  credential of the previous one stops being current at once.
- **`live`** exits 0 and prints the recorded incarnation when Vault holds the
  identity exactly as recorded (incarnation, epoch, grants, bootstrap digest, not
  revoked, bootstrap unexpired) and `<file>` is the recorded bootstrap; it exits 1
  otherwise. A kit keeps a unit's container only when `live` succeeds and the
  container runs under that incarnation; otherwise it recreates it after
  `register`.
- **`revoke`** marks the identity revoked in one transaction with its evidence
  (`UNIT_IDENTITY_REVOKED` in Vault's outbox). Issuance and every current-authority
  check fail at once (`403`). Only a new `register` brings the unit back, under a
  new epoch.
- **Renewal**: the base's daily `renew-bootstraps.sh` renews the declared extra
  identities exactly like the base's (decision L): 30 more days within 7 of
  expiry, blocked ones left unchanged and reported.

## 5. How a unit acquires a credential (the caller)

### Its inputs (decision M: secrets are files, never environment values)

| Variable | Value |
| :--- | :--- |
| `SHAPER_UNIVERSE_ID` | the universe UUID |
| `SHAPER_UNIT_SLUG` | the unit's own slug (`brick-voice`) |
| `SHAPER_UNIT_INCARNATION` | the incarnation `register` printed |
| `UNIT_BOOTSTRAP_TOKEN_FILE` | the bootstrap: a regular file owned by the unit's account, no group/other bit, 64 hex characters; mounted alone, read-only |
| `UNIT_AUTH_PUBLIC_KEY_FILE` | the pinned key: a regular file, not group/other-writable, owned by root or the unit |
| `VAULT_URL` | `http://127.0.0.1:8610` (Vault on the universe's host network) |

The bootstrap is presented **only to Vault** (`POST /api/identity/issue`), never to
another unit, a browser, a URL or a log. Every Vault request is bounded to three
seconds.

### Node

```js
import { runtimeCredentialClient } from '<base>/software/packages/pkg-auth/runtime-identity.js';
const credentials = runtimeCredentialClient(process.env);           // refuses a missing or unsafe input at start (503 codes)
const headers = await credentials.headers('brick-ipbx', { profile: 'callctx' });
// → { Authorization: 'Bearer <credential>' }
await fetch('http://127.0.0.1:8094/internal/call-contexts/…/claim', { method: 'POST', headers: { ...headers, … } });
// A 401 from the receiver (expired in flight, clock step): drop it and retry once.
credentials.invalidate('brick-ipbx', 'callctx');
```

`headers(audience, profile)` with a string is the same as `{ profile }`. Options:
`minValiditySeconds` (0–240): renew first when the cached credential has less left
(a session's caller, § 7).

### Python (stdlib only: the IPBX image has no `cryptography`)

```python
from shaper_unit_auth import CredentialClient, CredentialError
credentials = CredentialClient()                       # os.environ, same variables
headers = credentials.headers("brick-tools", profile="routing")
# urllib.request.Request("http://127.0.0.1:7661/routing?…", headers=headers)
credentials.invalidate("brick-tools", "routing")       # after a 401, then retry once
```

The module is one file, `software/packages/pkg-auth/python/shaper_unit_auth.py`,
Python ≥ 3.9, no dependency (Ed25519 verification after RFC 8032 in pure Python).
A unit vendors it at a pinned base revision and checks its SHA-256 at build.

### Cache and renewal (both languages)

- In memory only, one entry per **(audience, profile)**; never written to disk,
  never logged, never shared between processes.
- Acquired when an inter-unit call needs it — not at start: an idle unit asks
  Vault nothing.
- Renewed before expiry: when less than `min(30 s, lifetime / 2)` remains, or
  less than `minValiditySeconds`. Concurrent callers share one renewal.
- Every credential Vault returns is verified by the caller against the pinned
  key, the universe, the audience, its own unit, incarnation **and the profile
  asked**; any difference is refused (`IDENTITY_RENEWAL_MISMATCH`, 403) and not
  cached — an impostor Vault cannot hand out a credential.
- What the caller does with a receiver's refusal: `401` → `invalidate`, retry
  once; `403` → stop (boundary or revocation: a retry cannot help); `503` →
  report unavailable, never fall back to anything.

### What Vault answers the caller

| Situation | Status, code |
| :--- | :--- |
| issued | `200 {token, expiresAt}` |
| unknown unit, wrong bootstrap, revoked identity, old incarnation, expired bootstrap, a unit, audience or profile name outside its grammar | `403 IDENTITY_ISSUE_DENIED` (the typed reason is in Vault's own evidence, never in the answer) |
| audience not granted | `403 IDENTITY_AUDIENCE_DENIED` |
| profile not registered for that audience, profile asked on a whole audience, or no profile asked on a profiled one | `403 IDENTITY_PROFILE_DENIED` |
| a field other than `unit`, `incarnation`, `audience`, `profile` (a caller naming its scopes), or a body that is not a JSON object | `400 IDENTITY_REQUEST_INVALID` |
| Vault's database unavailable | `503` |

The client turns any other answer, a timeout or a refused connection into
`503 IDENTITY_UNAVAILABLE`.

## 6. How a receiver verifies (the protected unit)

In this order, every request, no cache of the outcome:

1. **Header**: exactly `Authorization: Bearer <token>`; absent or malformed → `401`.
2. **Signature** against the pinned key, then the claims' grammar and bounds
   (≤ 300 s, not issued in the future, not expired) → `401` on any failure.
3. **Universe and audience**: the claims name this universe and this unit's own
   slug, under the pinned key's id → else `403` (`CREDENTIAL_BOUNDARY_DENIED`).
4. **Scope**: the route's scope is among the claims' scopes → else `403`
   (`CREDENTIAL_SCOPE_DENIED`). A read credential on a mutation stops here.
5. **Current authority in Vault** (`POST /api/identity/check`, the credential as
   Bearer, `{audience}`): Vault confirms the credential row, the identity not
   revoked, the incarnation and epoch current, and every scope still registered
   for the credential's profile (or whole audience) → `403 CREDENTIAL_REVOKED`
   otherwise (old incarnation, revocation, profile narrowed, credential revoked).
6. **Actor** (§ 3): `X-Clinic-Actor` present → the actor scope and
   `claims.unit === "brick-tools"`, else `403`.

| Outcome | Status | Meaning |
| :--- | :--- | :--- |
| invalid, tampered, expired, missing | `401` | not authenticated |
| foreign universe or audience, missing scope, revoked, old incarnation, actor without the right | `403` | boundary or revocation |
| Vault unreachable, times out, answers 5xx or anything unexpected; the receiver's own key, universe or Vault address missing | `503` | authority unverifiable |

**No fallback, ever**: no static bearer, no "allow while Vault is down", no
cached positive answer. A receiver refuses to start without its pinned key,
universe and Vault address (`IDENTITY_*` codes, 503 class). The Clinic receivers
keep their error bodies: `401 unauthenticated`, `403 forbidden` (detail
`credential`), `503 unavailable` (detail `authority_unverifiable`).

### Node

```js
import { runtimeAuthorizer } from '<base>/software/packages/pkg-auth/runtime-identity.js';
const authorize = runtimeAuthorizer(process.env);   // UNIT_AUTH_PUBLIC_KEY_FILE, SHAPER_UNIVERSE_ID, SHAPER_UNIT_SLUG, VAULT_URL
try {
  const claims = await authorize(req, 'ipbx:read');  // claims.unit, claims.profile, claims.scopes
} catch (err) { /* err.status ∈ {401, 403, 503}, err.code */ }
```

### Python

```python
from shaper_unit_auth import Authorizer, CredentialError
authorize = Authorizer()                               # same variables
try:
    claims = authorize(handler.headers.get("Authorization"), "ipbx:callctx:claim")
except CredentialError as err:                         # err.status, err.code
    ...
```

## 7. Sessions longer than one request (rehearsal audio streams)

A WebSocket opened under a credential would otherwise outlive the check made at
its handshake. A session is held, not trusted:

- The **caller** opens it with a credential that covers it:
  `headers('brick-voice', { profile: 'write', minValiditySeconds: 200 })` for a
  stream of at most 180 s.
- The **receiver** authorizes the handshake (§ 6), then holds the session with
  `authorize.session(req, scope, { onEnd })` (Node): Vault re-confirms the
  credential's current authority every 30 s, and the session ends — `onEnd`
  called once with its reason — at the **first** of: the credential's expiry
  (`credential_expired`), a revocation or older incarnation
  (`authority_revoked`), Vault unable to confirm (`authority_unverifiable`). The
  receiver then closes the stream (WebSocket close 1008, the reason in the
  close frame) and records the end as it records any other.
- A session that must outlive one credential (more than about 4 minutes) is not
  covered by this mechanism: it ends at the credential's expiry and the caller
  opens a new one.

The Python module has no session helper: the IPBX unit serves no long session
under these credentials.

## 8. Failure and recovery at a glance

| Event | Effect |
| :--- | :--- |
| Vault down | no new credential (callers: 503); receivers: every request 503; sessions end within 30 s; nothing falls back |
| unit recreated (new incarnation) | its old credentials: 403 at the next check; its old container cannot obtain new ones |
| parent revokes a unit | its credentials: 403 at the next check; issuance 403 |
| profile narrowed by re-registration | credentials carrying a scope no longer registered: 403 |
| bootstrap expires (renewal blocked) | issuance 403 for that unit only; others unaffected (decision L) |
| clock step on a caller | receiver 401 → caller invalidates and retries once |

## 9. What this does not cover

- Units of the base (Vault, Logger, Queue, Maestro) keep whole-audience grants.
- No credential is accepted by a browser surface; staff sessions stay tools'.
- The canon does not mandate this mechanism for other realizations (§ header).
