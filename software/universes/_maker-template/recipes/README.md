# Recipes — frozen, typed, field-proven or absent

A recipe is `<hostKind>-<workKind>.sh` (`lxd-stamp.sh`, `proxmox-reap.sh`…).
It receives typed positional arguments — rowId, class, matrix, digest,
account, env — and never interpolates any of them into a composed command.

**No recipe ships before it has run on real terrain.** A snippet published
untested has already cost a sealing run (F25). Until the lxd recipe is
proven on gbs-test, this directory holds this contract and nothing else.
