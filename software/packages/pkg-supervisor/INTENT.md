> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

# @shaper/pkg-supervisor

## Objective
Parent supervisor engine responsible for non-self-grading observation (Rule 23), continuous health evaluation, external cold remediation, and convergence protection (Rule 27) across subordinate child universes.

## Invariants
1. **Rule 23 (Non-Self-Grading)**: The supervisor polls raw evidence from child `/api/vitals` (`signals` and `checks`). A child universe never evaluates itself; the supervisor alone computes diagnoses (`HEALTHY`, `STALLED`, `FAULT`, `DEGRADED`, `UNREACHABLE`).
2. **Rule 27 (Convergence Guard)**: When remediation fails, the supervisor applies exponential backoff and caps retries (`maxAttempts`, default: 3). If a fault persists, the child universe is transitioned to terminal `DEGRADED` state to prevent restart storms across fleets.
3. **Rule 36 (Asymmetric SSH Authority)**: The Parent generates an Ed25519 authority key pair (`sav/ssh/id_ed25519`). Ephemeral sandboxes (`<child>-dev` and clean-sheet `<child>-test`) have the Parent's public key injected at bootstrap. The private key never leaves the Parent.
4. **Clean-Sheet Validation & Garbage Collection**: `<child>-test` sandboxes are built from scratch on blank containers. Upon canary promotion (Rule 25), all ephemeral `-dev` and `-test` containers, routes, and scratch volumes are completely destroyed.
5. **No Root Verdict in Own Vitals**: The supervisor's own `/api/vitals` publishes pure signals (`childrenMonitored`, `reconciliationsTotal`, `healingsAttempted`, `degradedTotal`) and checks, with zero root verdict keys (`status`, `ok`, `healthy`).
