# Protocol — Document pipeline → Qdrant

Yardstick for the path **file → pipeline (three witnesses + arbiter) → indexed text → Qdrant → query**.
This is not a universe. Collection names below are protocol-only. Production indexing uses **one collection per universe** (Rule 22). Do not create `univ-pipeline-test` from this runner.

English in artifacts. Fixtures are synthetic corpus files plus one public research PDF. **No client documents.**

---

## 0. What this proves (and what it does not)

| Proves | Does not prove |
| :--- | :--- |
| Native text witness reads a vector PDF | Full GED deposit / queue job / maestro |
| Host RAG extractor **cannot** read a raster scan | Vision witness (explicitly skipped) |
| Pipeline image OCR reads that same scan | Live `/api/rag/query` behind helm auth |
| Arbiter text can be chunked and upserted | MiniLM ONNX (see embedding backend in the report) |
| Query on the protocol collection returns the indexed needles | Cross-universe isolation on a real cluster |
| A second collection does not see those points | |

Vision stays out of this measure. Mixing it would invalidate the OCR yardstick (`MEASUREMENT.md`, 96.52 %).

---

## 1. Fixtures (downloaded / copied here)

Directory: `software/test-corpus/pipeline-to-qdrant/fixtures/`

| Id | File | Kind | Why it is here |
| :--- | :--- | :--- | :--- |
| `01-vector-invoice` | `01-vector-invoice.pdf` | Vector + `.verite.txt` | Native witness must see `F-2024-00892` |
| `02-scan-invoice` | `02-scan-invoice.pdf` | Raster 150 DPI + `.verite.txt` | Native extract must be empty; OCR must recover the invoice number |
| `03-vector-form` | `03-vector-form.pdf` | Vector + `.verite.txt` | Second document class (form, not invoice) |
| `04-public-research` | `04-public-research.pdf` | Public vector PDF | Independent needle `TraceMonkey` (Mozilla pdf.js corpus) |

Public file provenance: `fixtures/04-public-research.SOURCE.txt`.

Needles and queries: `fixtures/manifest.json`.

---

## 2. Gates

Run from the repo:

```bash
node software/test-corpus/pipeline-to-qdrant/run-protocol.mjs
```

Host needs: Node 20+, Podman, image `localhost/shaper-pipeline:latest`, Qdrant on `127.0.0.1:6333` (the runner starts `shaper-protocol-qdrant` if nothing answers). `podman` on this host requires `--cgroups=disabled`. Pipeline extracts are cached in `.extract-cache/` so a retry after P2 does not re-OCR; pass `--fresh` to force a new read.

| Gate | Pass when |
| :--- | :--- |
| **P0** Qdrant | `GET /readyz` is ready |
| **P1** Native vs raster | Vector files contain every needle. Raster file via **host RAG extractor** does **not** contain `F-2024-00892` (no text layer) |
| **P2** Pipeline | Same raster file, inside the pipeline image with `{ skipVision: true }`, contains the invoice needles. Witnesses include `ocr` |
| **P3** Index | Pipeline text upserted into collection `protocol-pipeline-qdrant`. Point count > 0 |
| **P4** Query | Each fixture query’s top-3 hit texts contain the expected needle |
| **P5** Isolation | Collection `protocol-pipeline-qdrant-other` has 0 points; search there does not return protocol needles |

Exit code 0 = all gates passed. Report: `LAST-RUN.md` next to this file.

---

## 3. Intended production path (not executed here)

When Xavier says **go** on `univ-pipeline-test`:

```
upload → sav/ged/ → pipeline job → native | OCR | vision CLI → arbiter
      → GED validated event → rag upsert → collection = universe name
      → ask = POST /api/rag/query with that collection + auth
```

Agents do not upsert across collections. Operator inspect (`curl :6333/collections/…/points/count`) is a count, not a French Q&A.

---

## 4. Embedding backend

`@shaper/rag` prefers Xenova MiniLM 384-d, then falls back to the local hashed n-gram unit vector. Dummy / random / zero vectors are forbidden. The report records which backend actually ran. A hash backend is a **state**, not a crash: queries still have to hit the needles.
