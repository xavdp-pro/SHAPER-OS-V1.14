# Package: opencode-bridge (vendored from https://github.com/xavdp-pro/opencode-bridge)

> Real OpenCode HTTP/SSE bridge — `opencode serve` inside the container.

Do not reinvent spawn-`run` here. Upstream contract: inject / events / stop / reset.
Default active model: the free model verified and measured at deployment (Rule 7); none is named here. Ultra-fast engines stay dedicated to acknowledgment, never to general agent runs.

## Invariants

<a id="no-default-model"></a>
1. **No default model, and a halt without one.** `OPENCODE_MODEL` is measured
   from the target host at deployment and supplied to the process; this
   package names no model. The real bridge started without one halts before
   it listens and before it writes anything — exit code 2, naming the
   variable and Rule 7 — because a missing configuration is a halt that says
   what to provide, never a warning (Rule 0J). Only the simulated bridge
   (`BRIDGE_OPENCODE_STUB=1`), which never spawns the CLI, runs without a
   model.

## What experience corrected

* **A test lives where `npm test` looks.** This package's unit tests sat at
  its root as `*.test.mjs`, reached by the package's own script and by nothing
  the repository runs; they were green for nobody for an unknown number of
  releases. Tests live in `test/*.test.js`, the one shape the root glob
  reaches, and a guard (`pkg-universe/test/test-glob-coverage.test.js`)
  refuses any other placement.
* **The image ran a server that started on nothing.** The brick image runs
  this package, and its server used to start with an empty model — logging
  `model=` and handing every run to `opencode serve` with nothing to run it
  on — while the twin package `pkg-bridge-opencode` already refused. The
  review of the Rule 7 sweep found it; invariant 1 is the correction, and
  `test/no-default-model.test.js` holds it.
