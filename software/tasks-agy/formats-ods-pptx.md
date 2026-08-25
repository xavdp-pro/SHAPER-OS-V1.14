perimeter: software/packages/rag
goal: the .ods and .pptx extractor branches are proven by tests, or fixed if broken

# Task — test the ODS and PPTX branches

## Situation

`packages/rag/lib/extractor.js` received an office document branch supporting six formats:
`.odt`, `.ods`, `.odp`, `.docx`, `.xlsx`, `.pptx`.

**Four are proven** with real files: ODT (40 documents), DOCX (1), XLSX (3).
**Two are not**: `.ods` and `.pptx`. The code exists, but no one has run it.

Code that has never been run is code assumed to be broken.

## What to do

1. Read the office document branch in `extractor.js` and the archive reader `lib/zip-read.js`.
2. **Create in-memory test files**, just as `test/office-extract.test.js` already does
   with its `makeZip` function — do not commit any binary files.
   - ODS: `content.xml` with `<table:table-row>` and `<table:table-cell>`
   - PPTX: `ppt/slides/slide1.xml` and `slide2.xml` with `<a:p>`
3. Verify that extraction returns the expected text **in the correct order** for PPTX
   (slide1 before slide2, including when slide10 is present).
4. If a branch does not work: **fix it**, then write the test.

## Key considerations

- ODS is a spreadsheet: rows must produce line breaks, not a continuous block of text.
- PPTX: slide sorting must be numerical, otherwise slide10 precedes slide2.
- An unreadable archive must produce an explicit refusal, never fabricated text (Rule 0G).

## Done when

`node --test packages/rag/test/*.test.js` passes green with at least two new tests
covering ODS and PPTX, and no binary files added to the repository.
