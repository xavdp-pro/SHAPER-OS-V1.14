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
   <a id="fresh-home"></a>
2. **A clean sheet is the normal start.** The bridge keeps its token and its
   session registry under `~/.config/opencode-bridge/` (or wherever
   `TOKEN_FILE` and `SESSIONS_FILE` point) and creates that directory itself
   before writing either file. A HOME the bridge has never seen is the case a
   clean-sheet deployment produces; it is not allowed to be the case that
   crashes. A directory it cannot create (a read-only HOME, a parent it may
   not enter) is a typed halt — exit code 2, naming the directory and the
   variable to point elsewhere — never an uncaught EACCES.
   <a id="absent-cli"></a>
3. **A CLI that cannot start is a typed halt.** The headless `opencode serve`
   child comes from `OPENCODE_BIN` (default: under `OPT_BRIDGE_ROOT`). When
   the binary is absent or cannot be executed, the bridge halts with exit
   code 2, naming the path it tried and the variable to set — never an
   uncaught exception, and never a retry loop against the same absent file.

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
* **The first start on a blank HOME died on its own directory.** The token
  write threw `ENOENT` out of its own catch block; two reviewers read it and
  the suite could not see it, because every test named `TOKEN_FILE` inside a
  directory it had created. Invariant 2; `test/fresh-home.test.js`.
* **An absent binary was an uncaught exception.** The spawn of `opencode
  serve` listened to stdout, stderr and close, never to `'error'`, so a
  missing `OPENCODE_BIN` was a stack trace after `/api/health` had already
  answered. Invariant 3; `test/absent-cli.test.js`.
