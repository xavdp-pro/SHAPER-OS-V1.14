# V1.7 Clean-Sheet TEST Verdict

Date: 2026-08-25 (Europe/Paris)  
Parent: `gbs-test`  
Ephemeral LXC: `univ-v17-test`  
Branch: `stabilize/v1.7.1`  
Tested commit: `251e074879741896c1392e33241fe8c1c4b498d4`  
Immutable image tag: `v1.7.1-251e074`

## Verdict

**PASS — lifecycle closed.** Sanitized evidence was exported to the parent and
the TEST LXC was destroyed as required by the universe lifecycle.

## Materialization evidence

- Fresh unprivileged Debian 13 LXC; nesting enabled; 4 CPU, 6 GiB RAM, 32 GiB
  root disk; private bridge address only; no public proxy device.
- Podman 5.4.2 with exactly five running manifest containers: Vault, Logger,
  OpenCode bridge, Queue, and Maestro. Every container used
  `v1.7.1-251e074`; no optional brick and no SHAPER `latest` image ran.
- Repository suite: 201/201 passed. Universe contract suite: 3/3 passed.
  Universe live suite: 2/2 passed.
- Vault empty bootstrap created `vault.enc` with mode `0600`; a second complete
  deploy did not bootstrap again and all five health checks passed.
- All five `/api/vitals` endpoints answered. OpenCode reported `ready=true`,
  `stub=false`, `activeRuns=0`, model `opencode/mimo-v2.5-free`.

## Functional agent proof

- Queue job: `job-1787613437232-2`
- State: `COMPLETED`, progress 100, agent exit 0
- Model: `opencode/mimo-v2.5-free`
- Terminal answer: persisted in `job.result.answer` (300 bytes)
- Artifact: `work/proof-job-final/agent-proof-final.txt` (35 bytes)
- Exact marker: `V17_EXACT_AGENT_PROOF_1787613437144`
- Independent controller check: exact byte equality passed
- Logger event: `V17_AGENT_JOB_COMPLETED`, correlated with the same Queue job ID

One earlier `COMPLETED` run, `job-1787613375640-1`, was rejected by the
controller because the requested final newline was absent. Its shell proof had
used command substitution, which strips trailing newlines and therefore could
not establish the claimed property. The successful job used `printf | cmp`,
and the controller independently read the resulting bytes. A terminal status
was never treated as sufficient proof.

## Model-selection observation

The public speed snapshot ranked Nemotron 3.5 Lightning Free first, but it
timed out twice from this LXC. Ling returned a provider error. MiMo V2.5 Free
returned the bounded marker in about 8.5 seconds and then completed the real
Queue job, so MiMo was selected. Public throughput remains advisory; target
availability is mandatory.

## Corrections promoted into repository obligations

The clean-sheet work corrected and documented: missing Queue persistence
directory; host-Node Vault bootstrap dependency; missing gitignored OpenCode
binary; GED test dependence on ignored data; OpenCode directory/event routing;
missing bridge vitals; discarded terminal answer; missing empty Vault state;
Vault mode `0644`; and a newline-blind artifact proof. Each implementation
fault has a regression test, and operational findings are carried in the
relevant INTENT, proof, or deployment contract.

## Lifecycle closure

The parent evidence directory
`/root/shaper-proofs/univ-v17-test-20260825-251e074` contains this verdict,
sanitized deployment and test logs, the exact proof artifact, and verified
checksums. Its `SHA256SUMS` file had SHA-256
`a43cac0f514f20744508c0a48eddd13583553dd5944591fbabef1948eecb9ded`
before this final verdict replacement. The five named Podman containers were
removed and `univ-v17-test` was destroyed. The Git history and parent evidence
are the durable record; the ephemeral LXC is intentionally unrecoverable.
