# Test Corpus — Degraded Documents & Ground Truth

## 1. Context and Objective

The SHAPER-OS document pipeline must handle diverse real-world documents: raw scans lacking a text layer, orthogonally rotated pages, skewed/tilted scans, and severely degraded photocopies.

To objectively evaluate processing, deskewing, and extraction quality, this corpus provides a set of **controlled hard test cases** derived from vector source documents whose **exact text is known in advance** (ground truth).

Each test case is paired with a `.verite.txt` file containing the exact expected text string, extracted via `pdftotext` from the clean source vector document prior to degradation.

---

## 2. Data Privacy and Neutrality

In compliance with privacy and data protection requirements:
- **No third-party corporate documents or real personal data were used or committed.**
- All source documents were **synthetically generated** using purely fictitious entities and identities (*Societe Exemple Ingenierie SAS*, *Entreprise Fictive de Logistique SARL*, dummy addresses and registration numbers, fictional employee names).
- Document variety reflects standard business formats:
  1. `facture_prestation`: Commercial invoice with headers, itemized service table, discounts, VAT, totals, and legal terms.
  2. `compte_rendu_reunion`: Technical meeting minutes with agenda, attendee list, discussed items, and action items.
  3. `formulaire_administratif`: Administrative form with boxed sections, identifier fields, checkboxes `[X]` / `[ ]`, and sign-offs.
  4. `rapport_synthese`: Dense technical summary memo with descriptive paragraphs, typologies, and bulleted lists.

---

## 3. Corpus Structure and Generation Methodology

The corpus is organized into 5 directories:

```
software/test-corpus/
├── 00-sources/         # Clean reference vector source documents
├── 01-rasterise/       # Pure 150 DPI scans (no residual text layer)
├── 02-pivote/          # Pages rotated by 90°, 180°, and 270°
├── 03-de-travers/      # Scans tilted with angular misalignment of 3° to 7°
├── 04-degrade/         # Low resolution (72 DPI), noise, low contrast, photocopy & fax
├── generate_corpus.py  # Reproducible corpus generation script
├── test_corpus.py      # Non-regression test suite (Rule 29)
├── MEASUREMENT.md      # Automated extraction benchmark report
├── mesure.mjs          # Benchmark measurement script
└── README.md           # Corpus documentation
```

### 3.1. `00-sources/` — Reference source documents
- **Generation**: Native vector rendering via `cairo.PDFSurface` (standard A4 format: 595.28 × 841.89 pt).
- **Ground truth**: Complete text layer extraction via `pdftotext <source>.pdf <source>.verite.txt`.

### 3.2. `01-rasterise/` — Pure images without text layer
- **Content**: Faithful reproduction as pure raster images.
- **Generation**: 150 DPI rendering via `pdftoppm -png -r 150`, re-encapsulated into pure raster PDF containers.
- **Verification**: `pdftotext` extracts zero text from these files.

### 3.3. `02-pivote/` — Orthogonal rotations
- **Content**: Pages rotated by 90° (clockwise), 180° (upside down), and 270° (counter-clockwise).
- **Generation**: 2D affine geometric matrix transformations on raster data with page dimension swapping (landscape/portrait).

### 3.4. `03-de-travers/` — Angular tilt (Deskew test)
- **Content**: Misaligned documents with realistic feeder skew angles between 3° and 7° (+3.0°, -3.5°, +4.5°, -5.0°, +6.0°, -6.5°, -7.0°).
- **Generation**: Centered rotation with bilinear interpolation over a white background simulating scanner glass.

### 3.5. `04-degrade/` — Altered photocopies and scans
- **Content**: Realistic physical and optical degradations:
  - `basse_res_72dpi`: Low-resolution sampling (72 DPI) with pixelation and sharpness loss.
  - `faible_contraste`: Faded document / pale ink with dynamic range compressed toward highlights.
  - `bruit_scanner`: CCD sensor Gaussian noise + salt-and-pepper noise (dust / toner flecks).
  - `photocopie_degradee`: Combined 72 DPI + lighting gradient (vignetting) + non-linear clipping.
  - `flou_bavure`: Optical lens blur / ink bleeding on porous paper.
  - `fax_binaire`: 1-bit binarization with vertical roller streak artifact.
  - `photocopie_sombre`: Overexposure with toner-heavy gray background and crushed blacks.

---

## 4. Usage and Validation

### 4.1. Regenerate the corpus
To rebuild all test cases and their `.verite.txt` ground truth files:
```bash
python3 generate_corpus.py
```

### 4.2. Run the test suite (Rule 29)
To validate corpus integrity, 1:1 ground truth pairing, and absence of text layers on raster files:
```bash
python3 test_corpus.py
```

### 4.3. Run the extraction benchmark
To evaluate extraction accuracy and update `MEASUREMENT.md`:
```bash
node mesure.mjs
```

