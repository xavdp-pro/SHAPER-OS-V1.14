"""Short Vault-signed unit credentials for Python units (pkg-auth PROFILES.md).

The Python counterpart of pkg-auth's unit-credentials.js and
runtime-identity.js, for a unit whose server is Python (the exchange): a
caller acquires, caches and renews one credential per (audience, profile);
a receiver verifies signature, universe, audience and scope locally, then the
current authority with Vault. 401 invalid or expired, 403 boundary or
revocation, 503 authority unverifiable; no fallback.

Standard library only (Python >= 3.9): the Ed25519 verification follows
RFC 8032 section 5.1.7 in pure Python, so an image needs no cryptography
package. It verifies only; it never signs and holds no private key.

    from shaper_unit_auth import Authorizer, CredentialClient, CredentialError
    credentials = CredentialClient()            # os.environ
    headers = credentials.headers("brick-tools", profile="routing")
    authorize = Authorizer()
    claims = authorize(request_headers.get("Authorization"), "ipbx:read")

Environment (decision M: secrets are files, never values):
    SHAPER_UNIVERSE_ID, SHAPER_UNIT_SLUG, SHAPER_UNIT_INCARNATION (caller),
    UNIT_BOOTSTRAP_TOKEN_FILE (caller), UNIT_AUTH_PUBLIC_KEY_FILE, VAULT_URL.

Intent: software/packages/pkg-auth/PROFILES.md
"""

import base64
import hashlib
import json
import os
import re
import stat
import threading
import time
import urllib.error
import urllib.request

MAX_CREDENTIAL_SECONDS = 300
MAX_SCOPES = 32
VAULT_TIMEOUT_SECONDS = 3

UNIT_NAME_PATTERN = re.compile(r"^[a-z](?:[a-z0-9_-]{0,30}[a-z0-9_])?$")
PROFILE_NAME_PATTERN = UNIT_NAME_PATTERN
_ID = re.compile(r"^[A-Za-z0-9._:-]{1,190}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
_KEY_ID = re.compile(r"^[0-9a-f]{64}$")
_TOKEN = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
_BEARER = re.compile(r"^Bearer [A-Za-z0-9_.-]+$")
_BOOTSTRAP = re.compile(r"^[0-9a-f]{64}$")
_SAFE_INTEGER = 2 ** 53 - 1
# RFC 8410: the SubjectPublicKeyInfo of an Ed25519 key is this prefix and the 32 key bytes.
_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")


class CredentialError(Exception):
    """A refusal with its HTTP status (401, 403, 503 or 400/500 for misuse) and code."""

    def __init__(self, code, status=401):
        super().__init__(code)
        self.code = code
        self.status = status


def is_unit_name(value):
    return isinstance(value, str) and UNIT_NAME_PATTERN.match(value) is not None


def _text(value, pattern):
    return isinstance(value, str) and pattern.match(value) is not None


def _safe_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and -_SAFE_INTEGER <= value <= _SAFE_INTEGER


# ── Ed25519 verification, RFC 8032 (section 6 reference, verification only) ──
_P = 2 ** 255 - 19
_Q = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_SQRT_M1 = pow(2, (_P - 1) // 4, _P)


def _point_add(a, b):
    x = (a[1] - a[0]) * (b[1] - b[0]) % _P
    y = (a[1] + a[0]) * (b[1] + b[0]) % _P
    c = 2 * a[3] * b[3] * _D % _P
    d = 2 * a[2] * b[2] % _P
    e, f, g, h = y - x, d - c, d + c, y + x
    return (e * f, g * h, f * g, e * h)


def _point_mul(scalar, point):
    result = (0, 1, 1, 0)
    while scalar > 0:
        if scalar & 1:
            result = _point_add(result, point)
        point = _point_add(point, point)
        scalar >>= 1
    return result


def _point_equal(a, b):
    return (a[0] * b[2] - b[0] * a[2]) % _P == 0 and (a[1] * b[2] - b[1] * a[2]) % _P == 0


def _recover_x(y, sign):
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P)
    if x2 % _P == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _SQRT_M1 % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


_GY = 4 * pow(5, _P - 2, _P) % _P
_GX = _recover_x(_GY, 0)
_G = (_GX, _GY, 1, _GX * _GY % _P)


def _decompress(data):
    if len(data) != 32:
        return None
    y = int.from_bytes(data, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % _P)


def ed25519_verify(public_key, message, signature):
    """True when `signature` (64 bytes) is `public_key`'s (32 bytes) over `message`."""
    if len(public_key) != 32 or len(signature) != 64:
        return False
    a = _decompress(public_key)
    r = _decompress(signature[:32])
    if a is None or r is None:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= _Q:
        return False
    h = int.from_bytes(hashlib.sha512(signature[:32] + public_key + message).digest(), "little") % _Q
    return _point_equal(_point_mul(s, _G), _point_add(r, _point_mul(h, a)))


# ── Keys and credentials ─────────────────────────────────────────────────────
class PublicKey:
    """Vault's pinned Ed25519 public key: its 32 bytes and its id (SHA-256 of the SPKI, hex)."""

    def __init__(self, raw):
        if not isinstance(raw, (bytes, bytearray)) or len(raw) != 32:
            raise CredentialError("IDENTITY_KEY_INVALID", 500)
        self.raw = bytes(raw)
        self.key_id = hashlib.sha256(_SPKI_PREFIX + self.raw).hexdigest()

    @classmethod
    def from_pem(cls, pem):
        body = re.sub(r"\s+", "", re.sub(r"-----(BEGIN|END) PUBLIC KEY-----", "", pem))
        try:
            der = base64.b64decode(body, validate=True)
        except ValueError:
            raise CredentialError("IDENTITY_KEY_INVALID", 500) from None
        if len(der) != 44 or not der.startswith(_SPKI_PREFIX):
            raise CredentialError("IDENTITY_KEY_INVALID", 500)
        return cls(der[12:])


def load_public_key(path):
    """The pinned key file: regular, not group/other-writable, owned by root or this account."""
    if not path:
        raise CredentialError("IDENTITY_PUBLIC_KEY_REQUIRED", 503)
    try:
        st = os.lstat(path)
        if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o022 or st.st_uid not in (0, os.getuid()):
            raise CredentialError("IDENTITY_PUBLIC_KEY_UNTRUSTED", 503)
        with open(path, "r", encoding="ascii") as handle:
            return PublicKey.from_pem(handle.read())
    except OSError:
        raise CredentialError("IDENTITY_PUBLIC_KEY_UNTRUSTED", 503) from None
    except UnicodeDecodeError:
        raise CredentialError("IDENTITY_PUBLIC_KEY_UNTRUSTED", 503) from None


def _bootstrap_from_file(path):
    """The bootstrap: a regular file of this account, no group/other bit, 64 hex characters."""
    try:
        st = os.lstat(path)
        if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077 or st.st_uid != os.getuid():
            raise CredentialError("IDENTITY_BOOTSTRAP_FILE_UNTRUSTED", 503)
        with open(path, "r", encoding="ascii") as handle:
            token = handle.read().strip()
    except (OSError, UnicodeDecodeError):
        raise CredentialError("IDENTITY_BOOTSTRAP_FILE_UNTRUSTED", 503) from None
    if not _BOOTSTRAP.match(token):
        raise CredentialError("IDENTITY_BOOTSTRAP_INVALID", 503)
    return token


def _b64url_decode(text):
    try:
        data = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except ValueError:
        return None
    # Canonical only: re-encoding gives the same text, as pkg-auth requires.
    return data if base64.urlsafe_b64encode(data).decode("ascii").rstrip("=") == text else None


def _scope_list(scopes):
    return (isinstance(scopes, list) and 1 <= len(scopes) <= MAX_SCOPES
            and all(_text(s, _ID) and "*" not in s for s in scopes) and len(set(scopes)) == len(scopes))


def _validate_claims(c):
    ok = (isinstance(c, dict) and c.get("kind") == "shaper.unit.credential" and c.get("version") == 1
          and not isinstance(c.get("version"), bool)
          and _text(c.get("universe"), _UUID) and _text(c.get("unit"), UNIT_NAME_PATTERN)
          and _text(c.get("incarnation"), _ID) and _text(c.get("audience"), UNIT_NAME_PATTERN)
          and ("profile" not in c or _text(c.get("profile"), PROFILE_NAME_PATTERN))
          and _text(c.get("credentialId"), _ID) and _text(c.get("revocationRef"), _ID)
          and _text(c.get("keyId"), _KEY_ID)
          and _safe_int(c.get("epoch")) and c["epoch"] >= 1
          and _safe_int(c.get("issuedAt")) and _safe_int(c.get("expiresAt"))
          and c["expiresAt"] > c["issuedAt"] and c["expiresAt"] - c["issuedAt"] <= MAX_CREDENTIAL_SECONDS
          and _scope_list(c.get("scopes")))
    if not ok:
        raise CredentialError("CREDENTIAL_INVALID")


def assert_identity_boundary(universe, audience):
    if not _text(universe, _UUID) or not is_unit_name(audience):
        raise CredentialError("IDENTITY_POLICY_MISSING", 503)


def verify_credential(token, public_key, universe, audience, scope=None, now=None):
    """The claims of a credential Vault signed for this universe and audience, or a CredentialError.

    401: malformed, tampered, another key's signature, expired or issued in the future.
    403: another universe or audience, another key id, or `scope` not granted.
    503: this verifier has no universe or audience to check against.
    """
    assert_identity_boundary(universe, audience)
    if not isinstance(token, str) or len(token) > 16384 or not _TOKEN.match(token):
        raise CredentialError("CREDENTIAL_INVALID")
    payload, encoded_signature = token.split(".")
    data, signature = _b64url_decode(payload), _b64url_decode(encoded_signature)
    if data is None or signature is None or len(signature) != 64 \
            or not ed25519_verify(public_key.raw, payload.encode("ascii"), signature):
        raise CredentialError("CREDENTIAL_SIGNATURE_INVALID")
    try:
        claims = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise CredentialError("CREDENTIAL_INVALID") from None
    _validate_claims(claims)
    if claims["keyId"] != public_key.key_id or claims["universe"] != universe or claims["audience"] != audience:
        raise CredentialError("CREDENTIAL_BOUNDARY_DENIED", 403)
    seconds = int(time.time() if now is None else now)
    if claims["issuedAt"] > seconds or claims["expiresAt"] <= seconds:
        raise CredentialError("CREDENTIAL_EXPIRED")
    if scope and scope not in claims["scopes"]:
        raise CredentialError("CREDENTIAL_SCOPE_DENIED", 403)
    return claims


# ── Vault over HTTP ──────────────────────────────────────────────────────────
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A credential is never sent on to wherever a redirect points."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def vault_request(vault_url, path, token, body):
    """POST to Vault with the token as Bearer. Vault's 401/403 are the caller's;
    anything else it answers, a timeout or no answer leave the authority
    unverified: 503 IDENTITY_UNAVAILABLE, never passed through."""
    request = urllib.request.Request(vault_url.rstrip("/") + path, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with _OPENER.open(request, timeout=VAULT_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        if err.code in (401, 403):
            try:
                code = json.loads(err.read().decode("utf-8")).get("code")
            except Exception:  # noqa: BLE001 — an unreadable refusal is still a refusal
                code = None
            raise CredentialError(code if isinstance(code, str) and _ID.match(code) else "CREDENTIAL_REVOKED", err.code) from None
        raise CredentialError("IDENTITY_UNAVAILABLE", 503) from None
    except Exception:  # noqa: BLE001 — timeout, refused connection, malformed answer
        raise CredentialError("IDENTITY_UNAVAILABLE", 503) from None


class CredentialClient:
    """The caller: one credential per (audience, profile), in memory only,
    acquired when needed, renewed before expiry, verified against the pinned
    key before it is used."""

    def __init__(self, env=None, transport=None):
        env = os.environ if env is None else env
        self._universe = env.get("SHAPER_UNIVERSE_ID")
        self._unit = env.get("SHAPER_UNIT_SLUG")
        self._incarnation = env.get("SHAPER_UNIT_INCARNATION")
        self._bootstrap_file = env.get("UNIT_BOOTSTRAP_TOKEN_FILE")
        self._vault_url = env.get("VAULT_URL")
        self._public_key = load_public_key(env.get("UNIT_AUTH_PUBLIC_KEY_FILE"))
        assert_identity_boundary(self._universe, self._unit)
        if not self._vault_url or not self._bootstrap_file or not _text(self._incarnation, _ID):
            raise CredentialError("IDENTITY_CLIENT_CONFIG_REQUIRED", 503)
        _bootstrap_from_file(self._bootstrap_file)
        self._transport = transport or vault_request
        self._cache = {}
        self._locks = {}
        self._guard = threading.Lock()

    def _lock_of(self, key):
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    @staticmethod
    def _check(audience, profile, min_validity_seconds):
        if not is_unit_name(audience) or (profile is not None and not _text(profile, PROFILE_NAME_PATTERN)) \
                or not _safe_int(min_validity_seconds) or not 0 <= min_validity_seconds <= 240:
            raise CredentialError("IDENTITY_REQUEST_INVALID", 400)

    def _fresh(self, entry, min_validity_seconds):
        if entry is None:
            return False
        claims = entry[1]
        margin = max(min(30, (claims["expiresAt"] - claims["issuedAt"]) / 2), min_validity_seconds)
        return claims["expiresAt"] - time.time() > margin

    def headers(self, audience, profile=None, min_validity_seconds=0):
        """{'Authorization': 'Bearer <credential>'} for `audience` and `profile`."""
        self._check(audience, profile, min_validity_seconds)
        key = (audience, profile)
        entry = self._cache.get(key)
        if self._fresh(entry, min_validity_seconds):
            return {"Authorization": "Bearer " + entry[0]}
        with self._lock_of(key):  # concurrent callers share one renewal
            entry = self._cache.get(key)
            if not self._fresh(entry, min_validity_seconds):
                ask = {"unit": self._unit, "incarnation": self._incarnation, "audience": audience}
                if profile is not None:
                    ask["profile"] = profile
                result = self._transport(self._vault_url, "/api/identity/issue", _bootstrap_from_file(self._bootstrap_file), ask)
                token = result.get("token") if isinstance(result, dict) else None
                claims = verify_credential(token, self._public_key, self._universe, audience)
                if claims["unit"] != self._unit or claims["incarnation"] != self._incarnation \
                        or claims.get("profile") != profile:
                    raise CredentialError("IDENTITY_RENEWAL_MISMATCH", 403)
                entry = (token, claims)
                self._cache[key] = entry
        if entry[1]["expiresAt"] - time.time() < min_validity_seconds:
            raise CredentialError("CREDENTIAL_LIFETIME_SHORT", 503)
        return {"Authorization": "Bearer " + entry[0]}

    def invalidate(self, audience, profile=None):
        """Forget one cached credential (after a receiver's 401): the next call renews it."""
        self._cache.pop((audience, profile), None)


class Authorizer:
    """The receiver: signature, universe, audience and scope locally, then the
    current authority with Vault, every request, no cache of the outcome."""

    def __init__(self, env=None, transport=None, clock=None):
        env = os.environ if env is None else env
        self._vault_url = env.get("VAULT_URL")
        if not self._vault_url:
            raise CredentialError("IDENTITY_VAULT_REQUIRED", 503)
        self._public_key = load_public_key(env.get("UNIT_AUTH_PUBLIC_KEY_FILE"))
        self._universe = env.get("SHAPER_UNIVERSE_ID")
        self._audience = env.get("SHAPER_UNIT_SLUG")
        assert_identity_boundary(self._universe, self._audience)
        self._transport = transport or vault_request
        self._clock = clock or time.time

    def __call__(self, authorization, scope):
        return self.authorize(authorization, scope)

    def authorize(self, authorization, scope):
        """The claims, or a CredentialError (401, 403 or 503). `authorization` is the header's value."""
        token = authorization[7:] if isinstance(authorization, str) and _BEARER.match(authorization) else None
        claims = verify_credential(token, self._public_key, self._universe, self._audience, scope, now=self._clock())
        answer = self._transport(self._vault_url, "/api/identity/check", token, {"audience": claims["audience"]})
        if not isinstance(answer, dict) or answer.get("active") is not True:
            raise CredentialError("CREDENTIAL_REVOKED", 403)
        return claims
