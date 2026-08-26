# Package: pkg-universe

## Intent

A universe manifest is the only place a universe says what it is made of. Until
V1.11 that contract lived in three places that disagreed: a JSON Schema nobody
executed, a `_template` that used one shape, and `univ-base` that used another.
An agent told to follow the reference produced manifests the schema rejected,
and nothing noticed, because nothing read the schema.

This package makes the contract executable. It is the answer to a single
question — *is this a valid universe declaration, and if not, exactly where is
it wrong?* — and it answers with no dependency, so it runs anywhere a universe
is being built, including inside a brick image.

## What it guarantees

1. **Every identifier states its layer.** Brick keys are `brick-*`, packages are
   `@shaper/pkg-*`, images are `img-*`, the universe is `univ-*`.
2. **Origin is declared, never inferred.** Each brick says `source: base` or
   `source: catalogue`. A universe that assembles a catalogue brick admits it in
   its own manifest instead of pointing at a path that may not exist.
3. **The boot order is total.** Every declared brick appears in `bootOrder`
   exactly once — no brick started twice, none forgotten.
4. **Errors name their path.** `bricks.brick-vault.image` beats "invalid
   manifest", because the reader is often an agent with no other clue.

## What it is not

It is not a deployer and it holds no state. It reads a declaration and returns a
verdict. Materialising the universe is `podman-up.sh`; proving it ran is the
logger's evidence. Rule 33: declaring, materialising and proving stay separate.
