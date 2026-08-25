# Package: @shaper/ged-engine

> **Intent Classification**: GENERIC INTENT (Sovereign document engine)

## Declarative objective

Store, classify, analyze, and retrieve sovereign documents while keeping their bytes, derived metadata, and provenance inside the declared GED perimeter.

## Universal invariants

1. Stored blobs are content-addressed by SHA-256; original names remain catalog metadata.
2. Empty, corrupt, or unsupported documents return an explicit analysis state instead of crashing the service or inventing extracted content.
3. Tests required by `npm test` are self-contained in Git. Large OCR corpora may be ignored, but a mandatory test may never depend on an ignored workstation file.
4. Test writes use an isolated temporary GED root and must not mutate tracked metadata.

## What experience corrected

The vector-PDF test once read `test-corpus/00-sources/facture_prestation.pdf`, while all source PDFs in that directory are intentionally gitignored. It passed on the workstation that had generated the corpus and failed in the first public clean-sheet clone. The test now creates a minimal valid vector PDF in memory; the optional measurement corpus remains separate from the mandatory unit suite.
