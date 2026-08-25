perimeter: software/scripts
goal: no file in software/scripts contains absolute machine paths, and all scripts remain runnable on a clean clone

# Task — purge machine paths from scripts

## The problem, observed

Nine scripts in `software/scripts/` import Puppeteer from the private directory of an
agent session:

```js
import puppeteer from 'file:///home/zaza/.gemini/antigravity/brain/8dfc7b6b-357d-451b-9c4e-cadeed245854/scratch/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'
```

A session identifier hardcoded into committed code. As a result: **these scripts only
work on this machine, for that specific session**. On a clean clone, they all fail.
This is a violation of Rule 0B — "zero hardcoded environment residue".

## What to do

1. **Inventory**: `grep -rn "/home/" software/scripts/` — handle every occurrence.
2. **Replace Puppeteer imports** with a shared resolver, following this pattern (already present
   in `scripts/test-pipeline-ui.mjs`, CANDIDATES section): try several candidate locations
   in order, and fail with a clear message if none respond.
3. **Replace other absolute paths** with an environment variable defaulting to a path
   relative to the repository, never with another absolute path.
4. **Verify** that each modified script still loads: `node --check <file>`.

## What NOT to do

- Do not delete a script because it is broken: fix it.
- Do not invent a hardcoded replacement path "that works on my machine".
- Do not touch files outside `software/scripts/`.

## Done when

`grep -rn "/home/" software/scripts/` returns nothing, and `node --check` passes on all
`.mjs` files in the directory.
