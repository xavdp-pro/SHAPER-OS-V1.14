perimeter: software/bricks/brick-pipeline
goal: an OCR-capable pipeline image exists and raises the measured corpus score above 10.86 %, proven by re-running the existing measurement script
agent: agy
effort: high

# Task — build the OCR-capable pipeline brick

## The target, and it is a number

`software/test-corpus/MEASUREMENT.md` records today's honest baseline:

| Category | Cases | Score |
| :--- | ---: | ---: |
| `00-sources` — clean vector PDFs | 4 | **100.00 %** |
| `01-rasterise` — pure 150 DPI images | 4 | 0.48 % |
| `02-pivote` — rotated 90/180/270 | 12 | **0.00 %** |
| `03-de-travers` — skewed 3° to 7° | 8 | **0.00 %** |
| `04-degrade` — noise, fax, photocopy | 9 | **0.00 %** |
| **Total** | **37** | **10.86 %** |

33 cases out of 37 score zero because the extractor has **no OCR**. Your job is
to give it one, inside a container, and to move that number.

**The proof is `node software/test-corpus/measure.mjs`.** Same script, same
corpus, same metric. A score you obtained any other way does not count.

## What to build

A Podman image for `brick-pipeline`, described by `INTENT.md` in this
directory. Read it first — it is the contract, and section 3 already states how
the image must be built.

Non-negotiable points from that INTENT:

* **The heavy parts live here and nowhere else.** OCR engine, language data and
  poppler belong to this image. The GED image is 138 MB and must stay that way.
* **Layers ordered by rate of change**: system packages first, application code
  last. A code fix must rebuild one thin layer, not the OCR layer.
* **Pinned apt versions.** The same tag rebuilt tomorrow must give the same
  image (Rule 0E).
* **Cold start is part of "solid"**: the container answers health checks
  without waiting for anything heavy to initialise.

Install `tesseract-ocr` with French and English language data, plus poppler.
Tesseract is CPU-only — it needs no GPU, so do not add one to the requirements.

## The order that must be respected

INTENT invariant 2 and `doctrine/DOCUMENT-PIPELINE.md` §3 give the canonical
order, and it is not advisory:

    deskew and rotate  →  measure legibility  →  read  →  arbitrate

**Straightening after reading is worthless, and reading a rotated page gives a
false result rather than a poor one.** The corpus was built precisely to punish
getting this wrong: `02-pivote` holds pages at 90°, 180° and 270°. If your
rotation detection is absent or wrong, those twelve cases stay at zero and you
will see it in the score.

For this task you may stop before the arbiter: one witness (OCR) added to the
existing native-text extraction is enough to move the number honestly. Do not
fake the missing witnesses — a result must say which witnesses produced it.

## What honesty means here

* If a category stays at zero, **report it as zero** and say why. A partial
  gain that is real is worth more than a total that is dressed up.
* Never write a value you did not read. An empty field with its reason beats a
  plausible string (Rule 0G).
* Do not touch the corpus, and do not touch the `.verite.txt` ground truth. If
  the measurement seems unfair to your implementation, say so in your summary
  rather than adjusting the yardstick.

## Everything you write is in English

Code, comments, documentation, the Containerfile, commit-worthy notes. French
belongs only to spoken conversation with the maintainer.

## Done when

1. `podman build` produces the image, from a Containerfile in this directory.
2. `node software/test-corpus/measure.mjs` reports a total **above 10.86 %**,
   and you quote the new per-category table in your summary.
3. Every fix ships with its regression test (Rule 29).
4. Your summary states plainly which categories moved, which did not, and what
   the next obstacle is.
