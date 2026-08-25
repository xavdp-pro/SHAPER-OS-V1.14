perimeter: software/test-corpus
goal: a hard-case corpus exists, each case derived from a document whose exact text is known

# Task — build the hard-case corpus

## Why

The document pipeline will need to handle scans, skewed pages, and degraded
photocopies. Today **no such test cases exist** to test it: only clean PDFs
with a text layer are available. Therefore, nothing can be measured.

The trick: start from documents **whose exact text is already known**, and degrade
them intentionally. The ground truth is then known in advance, which makes measurement possible.

## Tools available on the machine

`pdftoppm`, `pdftotext`, `gs`. **`tesseract` is not installed** — do not try to run
OCR, that is not the task.

## What to produce

In `software/test-corpus/`, starting from source PDFs that you choose (ask the operator
for the corpus path, or use `$CORPUS_DIR` if defined):

| Subfolder | Content | Generation |
| :--- | :--- | :--- |
| `01-rasterise/` | pure image, no text layer remaining | `pdftoppm -jpeg -r 150` |
| `02-pivote/` | same pages rotated by 90°, 180°, 270° | rotation via `gs` or recompression |
| `03-de-travers/` | skewed by 3° to 7° | choice of available tools |
| `04-degrade/` | low contrast, noise, low resolution | `pdftoppm -r 72` then degradation |

And above all: **for each case, a `.verite.txt` file alongside it**, containing the exact
expected text, obtained with `pdftotext` on the **non-degraded source** document.

A `README.md` in `software/test-corpus/` explaining the origin and the methodology.

## What NOT to do

- Do not commit documents containing third-party company names or personal data.
  If the sources contain any, **generate neutral documents** instead and state so
  in the README.
- Do not perform OCR.

## Done when

The four subfolders exist, each case has its `.verite.txt`, and the README explains
how the corpus was generated and from what sources.
