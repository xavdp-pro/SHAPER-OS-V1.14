#!/usr/bin/env python3
# Intent: software/universes/univ-base/INTENT.md#image-lock
"""Every digest this universe locked must be servable by the registry.

Filled by hand on gbs-test, the lock held digests `podman inspect` reported for
locally built images — which a registry, having re-serialised the manifest it
stored, has never heard of. Nothing noticed, because the deployment ran from the
local store.
"""
import json
import sys
import urllib.request

ACCEPT = ", ".join([
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.index.v1+json",
])


def servable(reference: str) -> bool:
    host_repo, _, digest = reference.partition("@")
    registry, _, repository = host_repo.partition("/")
    if not digest or not repository:
        return False
    request = urllib.request.Request(
        f"http://{registry}/v2/{repository}/manifests/{digest}",
        method="HEAD", headers={"Accept": ACCEPT},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


lock = json.load(open(sys.argv[1]))
failed = 0

for image, reference in lock.get("images", {}).items():
    if not reference:
        print(f"  FAIL   {image:<22} not locked")
        failed = 1
        continue
    ok = servable(reference)
    digest = reference.partition("@")[2]
    print(f"  {'OK  ' if ok else 'FAIL'}   {image:<22} {digest[:26]}…")
    if not ok:
        failed = 1

sys.exit(failed)
