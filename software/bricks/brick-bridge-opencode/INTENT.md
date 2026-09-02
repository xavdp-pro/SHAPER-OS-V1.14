# brick-bridge-opencode

> GENERIC INTENT — Real `opencode-bridge` + OpenCode CLI **inside** the image.

## Invariants

1. Binary `/usr/local/bin/opencode` is baked into the image (not host bind-mount).
2. Runtime uses vendored `packages/pkg-opencode-server` (`opencode serve` + HTTP/SSE contract).
3. Port 4440 (bridge) / 4441 (internal serve).
4. Default free model: the most responsive free model **measured from the target host** at deployment (Rule 7). None is named here — a named default is wrong the day its vendor ships a successor.
5. Auth: Bearer token at `TOKEN_FILE` (shared with maestro/queue).
6. Model Discovery: At deployment time, available free models (`opencode models`) must be checked and active free models prioritized. Groq models are isolated from general chat.

---

## What experience corrected

* **A bridge whose CLI cannot start must not answer `ok`.** Prerequisites belong
  in the image and are proven by running the CLI, not by resolving a path
  (Rule 34).

* **A clean-sheet build never depends on a host CLI.** The build wrapper must
  delegate acquisition to the version-pinned `Containerfile`; it must not copy
  a workstation binary into the build context or ask the operator to install
  one first.

* **A missing CLI is a state, not a crash.** An unhandled spawn `error` used to
  kill the whole bridge, taking every other conversation with it and leaving the
  queue watching a stream that would never speak again. The run now ends with
  exit 127 on the same channel as any other outcome, and the bridge stays up.

* **Node emits `error` then `close` on a failed spawn.** Counting both made
  every metric drift; the run is concluded once.

* **A perimeter stated in a prompt is instruction, not containment.** The bridge
  applies it for real — `--add-dir` where the CLI supports it, the working
  directory where it does not. The difference is not cosmetic: it should decide
  which agent gets which task.

* **OpenCode's headless API binds execution context through `?directory=`, not
  session metadata.** Without that query parameter, a perfectly writable bind
  mount is classified as `external_directory` and a non-interactive run waits
  forever for permission. Session create, lookup, prompt, and abort must all
  carry the same encoded directory. Because those sessions may span several
  perimeters, event translation listens to `/global/event` and unwraps its
  `payload`; a directory-scoped `/event` would make other runs unobservable.

* **The runtime that ships is the runtime that publishes evidence.** The image
  uses `packages/pkg-opencode-server`, so its authenticated `/api/vitals` must expose
  readiness, model, stub state, active runs, conversations, and event clients;
  tests on a similarly named package do not prove the container.

* **No CLI here has a trustworthy exit code.** Read the agent's own output.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: infra-ops
- **role**: provides
- **depth**: D2
- **throughput**: T2
- **degraded**: allowed-with-note
- **rationale**: Default bootstrap engine bridge on free models. Declares the floor it can supply; the concrete model is chosen at deploy time by measurement, never by a published ranking.
