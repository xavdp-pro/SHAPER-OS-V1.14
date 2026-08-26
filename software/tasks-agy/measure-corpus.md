perimeter: software/test-corpus
goal: a numerical report provides, for each corpus category, the extraction rate achieved by the current extractor compared to the ground truth
agent: agy
effort: medium

# Task — measure extractor performance on the hard-case corpus

## What we want, and what we do not want

We want **an honest figure**, not an improvement. Do not fix the extractor.
Measure what it is worth today, category by category, and record it.

Certain categories are expected to drop to zero: the extractor has **no OCR**
(tesseract is not installed). A zero on rasterised images is not a bug;
it is the baseline measurement that will justify installing OCR. Do not dress it up.

## The material

`software/test-corpus/` contains 37 cases, each paired with a `.verite.txt` file
providing the exact expected text:

| Directory | Type |
| :--- | :--- |
| `00-sources/` | Clean vector PDFs — high control, should approach 100% |
| `01-rasterise/` | Pure 150 DPI images, no text layer |
| `02-pivote/` | 90°, 180°, 270° rotations |
| `03-de-travers/` | 3° to 7° skews |
| `04-degrade/` | Low resolution, low contrast, noise, photocopy, blur, fax |

The extractor is `software/packages/pkg-rag/lib/extractor.js`. Import it, do not modify it.

## The measurement

For each case: extract, compare against the ground truth, produce a **similarity rate**
between 0 and 1. Choose a defensible metric and **state which one** in the report —
normalized Levenshtein distance on reduced text (lowercase, normalized whitespace) is suitable.
A single metric, applied everywhere.

Also count, separately, cases where extraction **crashes** instead of returning empty
text: they are not the same thing, and only the latter is acceptable.

## Deliverables

A `software/test-corpus/MESURE.md` file containing:

1. A table per category: number of cases, mean rate, median rate, crashes.
2. The detailed case-by-case table.
3. The similarity metric used, stated in one sentence.
4. The three worst cases from the high control group (`00-sources`) — if any, that is
   where the real defect lies, since those should work.

And a script `software/test-corpus/measure.mjs` that regenerates this report, so it
can be rerun after each improvement to watch the numbers move.

## What matters

A reproducible figure is better than a flattering figure. If a category cannot
be measured, explain why rather than inventing a value.
