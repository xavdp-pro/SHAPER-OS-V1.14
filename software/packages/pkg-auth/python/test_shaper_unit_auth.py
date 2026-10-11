"""Unit tests of shaper_unit_auth (python3 -m unittest, from this directory).

The credentials here are signed by a test-only Ed25519 signer (RFC 8032
section 6), checked first against the RFC's own test vector; pkg-auth's Node
test (test/python-interop.test.js) runs this suite and cross-checks the
verifier against credentials Node's crypto signs.
"""

import base64
import hashlib
import http.server
import json
import os
import stat
import tempfile
import threading
import time
import unittest
import uuid

import shaper_unit_auth as sua

UNIVERSE = "550e8400-e29b-41d4-a716-446655440000"


# ── Test-only signer (RFC 8032 section 6) ────────────────────────────────────
def _expand(secret):
    h = hashlib.sha512(secret).digest()
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return a, h[32:]


def _compress(point):
    zinv = pow(point[2], sua._P - 2, sua._P)
    x, y = point[0] * zinv % sua._P, point[1] * zinv % sua._P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def public_of(secret):
    return _compress(sua._point_mul(_expand(secret)[0], sua._G))


def sign(secret, message):
    a, prefix = _expand(secret)
    public = _compress(sua._point_mul(a, sua._G))
    r = int.from_bytes(hashlib.sha512(prefix + message).digest(), "little") % sua._Q
    rs = _compress(sua._point_mul(r, sua._G))
    h = int.from_bytes(hashlib.sha512(rs + public + message).digest(), "little") % sua._Q
    return rs + ((r + h * a) % sua._Q).to_bytes(32, "little")


def b64url(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def pem_of(public):
    der = sua._SPKI_PREFIX + public
    return "-----BEGIN PUBLIC KEY-----\n" + base64.b64encode(der).decode("ascii") + "\n-----END PUBLIC KEY-----\n"


SECRET = hashlib.sha256(b"shaper-unit-auth-test").digest()
KEY = sua.PublicKey(public_of(SECRET))


def issue(secret=SECRET, ttl=300, now=None, **claims):
    issued = int(time.time() if now is None else now)
    body = {"universe": UNIVERSE, "unit": "brick-ipbx", "incarnation": "brick-ipbx-0123456789abcdef",
            "audience": "brick-tools", "profile": "routing", "scopes": ["tools:routing:read"], "epoch": 2,
            "revocationRef": "brick-ipbx:2", "kind": "shaper.unit.credential", "version": 1,
            "keyId": sua.PublicKey(public_of(secret)).key_id, "credentialId": str(uuid.uuid4()),
            "issuedAt": issued, "expiresAt": issued + ttl}
    body.update(claims)
    body = {k: v for k, v in body.items() if v is not None}
    payload = b64url(json.dumps(body, separators=(",", ":")).encode("utf-8"))
    return payload + "." + b64url(sign(secret, payload.encode("ascii"))), body


class Ed25519(unittest.TestCase):
    def test_rfc8032_vector_1(self):
        secret = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
        public = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        signature = bytes.fromhex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
        self.assertEqual(public_of(secret), public)
        self.assertEqual(sign(secret, b""), signature)
        self.assertTrue(sua.ed25519_verify(public, b"", signature))
        self.assertFalse(sua.ed25519_verify(public, b"x", signature))
        bad = bytearray(signature)
        bad[5] ^= 1
        self.assertFalse(sua.ed25519_verify(public, b"", bytes(bad)))
        # s >= q is refused (malleability).
        high = signature[:32] + (int.from_bytes(signature[32:], "little") + sua._Q).to_bytes(32, "little")
        self.assertFalse(sua.ed25519_verify(public, b"", high))

    def test_pem_round_trip_and_key_id(self):
        key = sua.PublicKey.from_pem(pem_of(KEY.raw))
        self.assertEqual(key.raw, KEY.raw)
        self.assertEqual(key.key_id, hashlib.sha256(sua._SPKI_PREFIX + KEY.raw).hexdigest())
        with self.assertRaises(sua.CredentialError):
            sua.PublicKey.from_pem("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n")


class Verify(unittest.TestCase):
    def check(self, token, **kwargs):
        options = {"universe": UNIVERSE, "audience": "brick-tools"}
        options.update(kwargs)
        return sua.verify_credential(token, KEY, options.pop("universe"), options.pop("audience"), **options)

    def refused(self, status, code, token, **kwargs):
        with self.assertRaises(sua.CredentialError) as caught:
            self.check(token, **kwargs)
        self.assertEqual((caught.exception.status, caught.exception.code), (status, code))

    def test_a_profiled_credential_binds_everything(self):
        token, claims = issue()
        self.assertEqual(self.check(token, scope="tools:routing:read"), claims)
        self.refused(403, "CREDENTIAL_BOUNDARY_DENIED", token, audience="brick-voice")
        self.refused(403, "CREDENTIAL_BOUNDARY_DENIED", token, universe="550e8400-e29b-41d4-a716-446655440001")
        self.refused(403, "CREDENTIAL_SCOPE_DENIED", token, scope="tools:planning:write")
        self.refused(503, "IDENTITY_POLICY_MISSING", token, audience="brick_tools-")

    def test_time_bounds(self):
        now = int(time.time())
        token, _ = issue(now=now, ttl=60)
        self.refused(401, "CREDENTIAL_EXPIRED", token, now=now + 60)
        self.refused(401, "CREDENTIAL_EXPIRED", token, now=now - 1)
        self.refused(401, "CREDENTIAL_INVALID", issue(ttl=301)[0])

    def test_tampering_another_key_and_malformed_tokens(self):
        token, claims = issue()
        payload, signature = token.split(".")
        forged = b64url(json.dumps(dict(claims, scopes=["tools:routing:read", "tools:planning:write"])).encode()) + "." + signature
        self.refused(401, "CREDENTIAL_SIGNATURE_INVALID", forged)
        other = hashlib.sha256(b"another vault").digest()
        self.refused(401, "CREDENTIAL_SIGNATURE_INVALID", issue(secret=other)[0])
        for bad in ["unsigned", token + "=", "x" * 20000, payload + "." + signature + "A", None, 42]:
            with self.assertRaises(sua.CredentialError) as caught:
                self.check(bad)
            self.assertEqual(caught.exception.status, 401, repr(bad)[:40])
        for change in [{"profile": "Read"}, {"profile": ""}, {"scopes": ["*"]}, {"scopes": []}, {"scopes": ["a", "a"]},
                       {"version": True}, {"epoch": 0}, {"unit": "-x"}]:
            self.refused(401, "CREDENTIAL_INVALID", issue(**change)[0])

    def test_a_whole_audience_credential_has_no_profile(self):
        token, claims = issue(profile=None, unit="queue", audience="logger", scopes=["logger:ingest"])
        self.assertNotIn("profile", self.check(token, audience="logger", scope="logger:ingest"))


class Files(object):
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="sua-")
        self.key = os.path.join(self.dir, "vault-signing.pub")
        self.bootstrap = os.path.join(self.dir, "bootstrap")
        with open(self.key, "w") as handle:
            handle.write(pem_of(KEY.raw))
        os.chmod(self.key, 0o444)
        with open(self.bootstrap, "w") as handle:
            handle.write("c" * 64 + "\n")
        os.chmod(self.bootstrap, 0o600)

    def env(self, **extra):
        env = {"SHAPER_UNIVERSE_ID": UNIVERSE, "SHAPER_UNIT_SLUG": "brick-ipbx",
               "SHAPER_UNIT_INCARNATION": "brick-ipbx-0123456789abcdef", "UNIT_BOOTSTRAP_TOKEN_FILE": self.bootstrap,
               "UNIT_AUTH_PUBLIC_KEY_FILE": self.key, "VAULT_URL": "http://127.0.0.1:9"}
        env.update(extra)
        return {k: v for k, v in env.items() if v is not None}

    def remove(self):
        for name in os.listdir(self.dir):
            os.chmod(os.path.join(self.dir, name), 0o600)
            os.remove(os.path.join(self.dir, name))
        os.rmdir(self.dir)


class Client(unittest.TestCase):
    def setUp(self):
        self.files = Files()
        self.asked = []

    def tearDown(self):
        self.files.remove()

    def vault(self, ttl=300, **override):
        def transport(url, path, token, body):
            self.asked.append((path, token, body))
            self.assertEqual(token, "c" * 64)
            claims = {"audience": body["audience"], "profile": body.get("profile"),
                      "scopes": {"routing": ["tools:routing:read"], "callctx": ["ipbx:callctx:claim"]}.get(body.get("profile"), ["x:y"])}
            claims.update(override)
            return {"token": issue(ttl=ttl, **claims)[0]}
        return transport

    def test_one_credential_per_audience_and_profile_cached_and_verified(self):
        client = sua.CredentialClient(self.files.env(), transport=self.vault())
        first = client.headers("brick-tools", profile="routing")
        self.assertTrue(first["Authorization"].startswith("Bearer "))
        self.assertEqual(client.headers("brick-tools", "routing"), first)
        self.assertEqual(len(self.asked), 1, "cached")
        self.assertEqual(self.asked[0][0], "/api/identity/issue")
        self.assertEqual(self.asked[0][2], {"unit": "brick-ipbx", "incarnation": "brick-ipbx-0123456789abcdef",
                                            "audience": "brick-tools", "profile": "routing"})
        self.assertNotIn("c" * 64, json.dumps(self.asked[0][2]), "the bootstrap is the Bearer only")
        client.headers("brick-tools", profile="callctx")
        self.assertEqual(len(self.asked), 2, "another profile is another credential")
        client.invalidate("brick-tools", "routing")
        self.assertNotEqual(client.headers("brick-tools", "routing"), first)
        self.assertEqual(len(self.asked), 3)

    def test_renewed_before_expiry_and_long_enough_for_a_session(self):
        client = sua.CredentialClient(self.files.env(), transport=self.vault(ttl=20))
        client.headers("brick-tools", "routing")
        client.headers("brick-tools", "routing")
        self.assertEqual(len(self.asked), 1, "a 20 s credential is reused for its first 10 s")
        with self.assertRaises(sua.CredentialError) as caught:
            client.headers("brick-tools", "routing", min_validity_seconds=200)
        self.assertEqual((caught.exception.status, caught.exception.code), (503, "CREDENTIAL_LIFETIME_SHORT"))
        self.assertEqual(len(self.asked), 2, "it tried a fresh one first")

    def test_a_credential_for_another_profile_unit_or_audience_is_refused(self):
        for override, code in [({"profile": "callctx"}, "IDENTITY_RENEWAL_MISMATCH"), ({"profile": None}, "IDENTITY_RENEWAL_MISMATCH"),
                               ({"unit": "brick-voice"}, "IDENTITY_RENEWAL_MISMATCH"),
                               ({"incarnation": "brick-ipbx-old"}, "IDENTITY_RENEWAL_MISMATCH"),
                               ({"audience": "brick-voice"}, "CREDENTIAL_BOUNDARY_DENIED")]:
            client = sua.CredentialClient(self.files.env(), transport=self.vault(**override))
            with self.assertRaises(sua.CredentialError) as caught:
                client.headers("brick-tools", "routing")
            self.assertEqual((caught.exception.status, caught.exception.code), (403, code), override)

    def test_unsafe_or_missing_inputs_refuse_at_start(self):
        os.chmod(self.files.bootstrap, 0o640)
        with self.assertRaises(sua.CredentialError) as caught:
            sua.CredentialClient(self.files.env(), transport=self.vault())
        self.assertEqual(caught.exception.code, "IDENTITY_BOOTSTRAP_FILE_UNTRUSTED")
        os.chmod(self.files.bootstrap, 0o600)
        os.chmod(self.files.key, 0o666)
        with self.assertRaises(sua.CredentialError) as caught:
            sua.CredentialClient(self.files.env(), transport=self.vault())
        self.assertEqual(caught.exception.code, "IDENTITY_PUBLIC_KEY_UNTRUSTED")
        os.chmod(self.files.key, 0o444)
        for missing, code in [("SHAPER_UNIVERSE_ID", "IDENTITY_POLICY_MISSING"), ("VAULT_URL", "IDENTITY_CLIENT_CONFIG_REQUIRED"),
                              ("SHAPER_UNIT_INCARNATION", "IDENTITY_CLIENT_CONFIG_REQUIRED"),
                              ("UNIT_AUTH_PUBLIC_KEY_FILE", "IDENTITY_PUBLIC_KEY_REQUIRED")]:
            with self.assertRaises(sua.CredentialError) as caught:
                sua.CredentialClient(self.files.env(**{missing: None}), transport=self.vault())
            self.assertEqual((caught.exception.status, caught.exception.code), (503, code), missing)
        client = sua.CredentialClient(self.files.env(), transport=self.vault())
        for args in [("brick_tools-", None), ("brick-tools", "Routing"), ("brick-tools", "routing", 241)]:
            with self.assertRaises(sua.CredentialError) as caught:
                client.headers(*args)
            self.assertEqual(caught.exception.status, 400)


class _Vault(http.server.BaseHTTPRequestHandler):
    answers = {}

    def do_POST(self):  # noqa: N802
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        status, body, extra = self.answers[self.path]
        self.send_response(status)
        for k, v in extra.items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def log_message(self, *args):
        pass


class Receiver(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Vault)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.files = Files()

    def tearDown(self):
        self.files.remove()

    def authorizer(self, status, body, **extra):
        _Vault.answers = {"/api/identity/check": (status, body, extra)}
        return sua.Authorizer(self.files.env(SHAPER_UNIT_SLUG="brick-tools", VAULT_URL=self.url))

    def outcome(self, authorize, header, scope="tools:routing:read"):
        try:
            return authorize(header, scope)["unit"]
        except sua.CredentialError as err:
            return (err.status, err.code)

    def test_current_authority_decides_with_401_403_503_and_no_fallback(self):
        token, _ = issue()
        header = "Bearer " + token
        self.assertEqual(self.outcome(self.authorizer(200, {"active": True}), header), "brick-ipbx")
        self.assertEqual(self.outcome(self.authorizer(200, {"active": False}), header), (403, "CREDENTIAL_REVOKED"))
        self.assertEqual(self.outcome(self.authorizer(403, {"code": "CREDENTIAL_REVOKED"}), header), (403, "CREDENTIAL_REVOKED"))
        self.assertEqual(self.outcome(self.authorizer(401, {"code": "CREDENTIAL_EXPIRED"}), header), (401, "CREDENTIAL_EXPIRED"))
        for status in (500, 502, 404, 418):
            self.assertEqual(self.outcome(self.authorizer(status, {"code": "WHATEVER"}), header), (503, "IDENTITY_UNAVAILABLE"), status)
        # A redirect is never followed with a credential.
        self.assertEqual(self.outcome(self.authorizer(307, {}, Location=self.url + "/elsewhere"), header), (503, "IDENTITY_UNAVAILABLE"))
        # Vault not listening.
        down = sua.Authorizer(self.files.env(SHAPER_UNIT_SLUG="brick-tools", VAULT_URL="http://127.0.0.1:9"))
        self.assertEqual(self.outcome(down, header), (503, "IDENTITY_UNAVAILABLE"))

    def test_local_refusals_never_reach_vault(self):
        calls = []
        authorize = sua.Authorizer(self.files.env(SHAPER_UNIT_SLUG="brick-tools", VAULT_URL=self.url),
                                   transport=lambda *a: calls.append(a) or {"active": True})
        token, _ = issue()
        self.assertEqual(self.outcome(authorize, None), (401, "CREDENTIAL_INVALID"))
        self.assertEqual(self.outcome(authorize, "Basic " + token), (401, "CREDENTIAL_INVALID"))
        self.assertEqual(self.outcome(authorize, "Bearer " + token, "tools:planning:write"), (403, "CREDENTIAL_SCOPE_DENIED"))
        self.assertEqual(self.outcome(authorize, "Bearer " + issue(audience="brick-voice")[0]), (403, "CREDENTIAL_BOUNDARY_DENIED"))
        self.assertEqual(calls, [])
        self.assertEqual(self.outcome(authorize, "Bearer " + token), "brick-ipbx")
        self.assertEqual(calls[0][1:], ("/api/identity/check", token, {"audience": "brick-tools"}))

    def test_a_receiver_without_its_inputs_does_not_start(self):
        for missing, code in [("VAULT_URL", "IDENTITY_VAULT_REQUIRED"), ("SHAPER_UNIVERSE_ID", "IDENTITY_POLICY_MISSING"),
                              ("UNIT_AUTH_PUBLIC_KEY_FILE", "IDENTITY_PUBLIC_KEY_REQUIRED")]:
            with self.assertRaises(sua.CredentialError) as caught:
                sua.Authorizer(self.files.env(SHAPER_UNIT_SLUG="brick-tools", **{missing: None}))
            self.assertEqual((caught.exception.status, caught.exception.code), (503, code))

    def test_the_vault_client_over_http(self):
        _Vault.answers = {"/api/identity/issue": (403, {"code": "IDENTITY_PROFILE_DENIED"}, {})}
        with self.assertRaises(sua.CredentialError) as caught:
            sua.vault_request(self.url, "/api/identity/issue", "c" * 64, {})
        self.assertEqual((caught.exception.status, caught.exception.code), (403, "IDENTITY_PROFILE_DENIED"))
        _Vault.answers = {"/api/identity/issue": (200, {"token": "t"}, {})}
        self.assertEqual(sua.vault_request(self.url, "/api/identity/issue", "c" * 64, {}), {"token": "t"})


if __name__ == "__main__":
    unittest.main()
