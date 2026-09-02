# Package: opencode-bridge (vendored from https://github.com/xavdp-pro/opencode-bridge)

> Real OpenCode HTTP/SSE bridge — `opencode serve` inside the container.

Do not reinvent spawn-`run` here. Upstream contract: inject / events / stop / reset.
Default active model: the free model verified and measured at deployment (Rule 7); none is named here. Ultra-fast engines stay dedicated to acknowledgment, never to general agent runs.

## What experience corrected

* **A test lives where `npm test` looks.** This package's unit tests sat at
  its root as `*.test.mjs`, reached by the package's own script and by nothing
  the repository runs; they were green for nobody for an unknown number of
  releases. Tests live in `test/*.test.js`, the one shape the root glob
  reaches, and a guard (`pkg-universe/test/test-glob-coverage.test.js`)
  refuses any other placement.
