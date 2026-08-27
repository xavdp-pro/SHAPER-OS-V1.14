#!/usr/bin/env python3
# Intent: software/universes/univ-base/INTENT.md#image-lock
"""Fill a universe's image lock from what the registry stored, and verify it.

Two lessons are built into this file, and both were paid for.

**A digest is what the registry holds, not what the builder computed.** Filled by
hand on gbs-test from `podman inspect`, every entry returned `manifest unknown`
from the registry — while the universe deployed and passed its proof, because
the images were already in the local store. The digests here come from
`podman push --digestfile`, and none is written until the registry serves it back.

**It is written in python, not in node.** A clean-sheet LXC carries podman, git
and python3 — never node; that is the condition Rule 11 describes and the whole
point of a clean sheet. The first version of this tool was a `.mjs`, and it
failed with `node: command not found` on the one machine it existed for. The
repository already carried that lesson, in `_template/deploy/podman-up.sh`,
about a host npm. A lesson written down is not a lesson learned until the next
tool obeys it.

Usage:
  python3 scripts/record-image-lock.py <universe-dir> [--registry HOST:PORT] [--insecure]
"""
import json
import os
import sys
import urllib.request

SOFTWARE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELEASE = os.path.join(SOFTWARE, ".release")

ACCEPT = ", ".join([
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.index.v1+json",
])


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def servable(scheme, registry, repository, digest):
    request = urllib.request.Request(
        f"{scheme}://{registry}/v2/{repository}/manifests/{digest}",
        method="HEAD", headers={"Accept": ACCEPT},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def main(argv):
    positional = [a for a in argv if not a.startswith("--")]
    if not positional:
        fail("Usage: python3 scripts/record-image-lock.py <universe-dir> "
             "[--registry=HOST:PORT] [--insecure]")

    universe = positional[0]
    registry = next((a.split("=", 1)[1] for a in argv if a.startswith("--registry=")), None) \
        or os.environ.get("SHAPER_REGISTRY")
    if not registry:
        fail("SHAPER_REGISTRY is not set and no --registry was given. "
             "This repository invents no registry.")

    insecure = "--insecure" in argv or os.environ.get("SHAPER_TLS_VERIFY") == "false"
    scheme = "http" if insecure else "https"

    lock_path = os.path.join(universe, "cfg-image-lock.json")
    manifest_path = os.path.join(universe, "manifest.json")
    for path in (lock_path, manifest_path):
        if not os.path.exists(path):
            fail(f"{path} does not exist — is that a universe directory?")

    manifest = json.load(open(manifest_path))
    lock = json.load(open(lock_path))

    # The lock names exactly the images the manifest declares.
    declared = sorted(brick["image"] for brick in manifest["bricks"].values())
    locked = sorted(lock.get("images", {}))
    if declared != locked:
        fail(f"The lock names {locked} but the manifest declares {declared}.\n"
             "Fix the lock first: an entry with no brick can never be filled.")

    problems = []
    for image in declared:
        brick = image.replace("img-", "brick-", 1)
        digest_file = os.path.join(RELEASE, f"{brick}.digest")

        if not os.path.exists(digest_file):
            problems.append(f"{image}: no digest recorded — run scripts/build-{brick}.sh first")
            continue

        digest = open(digest_file).read().strip()
        repository = f"shaper/{brick}"

        if not servable(scheme, registry, repository, digest):
            problems.append(
                f"{image}: {digest} is not served by {registry} — "
                "the push did not land, or that digest is a local one")
            continue

        lock["images"][image] = f"{registry}/{repository}@{digest}"
        print(f"  {image} -> {digest}")

    if problems:
        print("\nThe lock was NOT written:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        sys.exit(1)

    lock["status"] = "released"
    with open(lock_path, "w") as handle:
        json.dump(lock, handle, indent=2)
        handle.write("\n")
    print(f"\n{len(declared)} image(s) locked and verified against {registry}.")


if __name__ == "__main__":
    main(sys.argv[1:])
