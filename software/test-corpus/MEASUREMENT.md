# Measurement Report — SHAPER-OS Content Extractor

> **Evaluation Date**: 2026-08-23  
> **Extractor Measured**: `brick-pipeline` in `localhost/shaper-pipeline:latest` (OCR + geometry + native text)  
> **Test Corpus**: `software/test-corpus/` (37 cases paired with `.verite.txt`)  
> **Total Cases**: **37** | **Crashes (unhandled exceptions)**: **0**  
> **Overall Mean Accuracy**: **96.52 %** | **Overall Median Accuracy**: **99.66 %**

---

## 1. Category Summary

| Category | Description | Cases | Mean Accuracy | Median Accuracy | Min | Max | Crashes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `00-sources` | Native vector PDFs | 4 | 100.00 % | 100.00 % | 100.00 % | 100.00 % | 0 |
| `01-rasterise` | Pure raster images without text layer | 4 | 97.14 % | 97.81 % | 92.94 % | 100.00 % | 0 |
| `02-pivote` | Orthogonally rotated pages | 12 | 97.14 % | 97.81 % | 92.94 % | 100.00 % | 0 |
| `03-de-travers` | Scans tilted by 3° to 7° | 8 | 98.85 % | 99.83 % | 95.70 % | 99.94 % | 0 |
| `04-degrade` | Low resolution, noise, contrast, fax | 9 | 91.81 % | 98.05 % | 40.84 % | 100.00 % | 0 |
| **TOTAL** | *All 5 corpus categories* | **37** | **96.52 %** | **99.66 %** | **40.84 %** | **100.00 %** | **0** |

---

## 2. Similarity Metric

The similarity metric is the **normalized Levenshtein distance computed on normalized text** (lowercased, consecutive whitespace and newlines collapsed to a single space, trimmed):

$$\text{Similarity}(E, T) = 1 - \frac{\text{Levenshtein}(E_{\text{norm}}, T_{\text{norm}})}{\max(|E_{\text{norm}}|, |T_{\text{norm}}|)}$$

where $E$ is the text extracted by the extractor (treated as empty if the extractor returns an unreadable fallback notice like `[PDF non extractible...]`) and $T$ is the ground-truth text.

---

## 3. Worst Three Cases in Clean Vector Baseline (`00-sources`)

The baseline category (`00-sources`) consists of the 4 cleanly generated native vector documents.

1. **`compte_rendu_reunion.pdf`**: **100.00 %** (Levenshtein distance: 0, extracted: 1740 chars, ground truth: 1740 chars)
2. **`facture_prestation.pdf`**: **100.00 %** (Levenshtein distance: 0, extracted: 1535 chars, ground truth: 1535 chars)
3. **`formulaire_administratif.pdf`**: **100.00 %** (Levenshtein distance: 0, extracted: 1332 chars, ground truth: 1332 chars)

> [!NOTE]
> **Baseline Observation**: All 4 source documents in `00-sources` achieve a similarity score of **100.00 %** (Levenshtein distance of 0).

---

## 4. Analysis of Results and Current Limitations

1. **Vector documents (`00-sources`) — 100.00 %**:
   - Native text extraction through the pipeline on clean vector PDFs.
2. **01-rasterise — 97.14 % mean** (Pure raster images without text layer).
2. **02-pivote — 97.14 % mean** (Orthogonally rotated pages).
2. **03-de-travers — 98.85 % mean** (Scans tilted by 3° to 7°).
2. **04-degrade — 91.81 % mean** (Low resolution, noise, contrast, fax).
7. **Failure handling (0 crashes)**:
   - Unhandled exceptions across 37 cases.

---

## 5. Detailed Case-by-Case Breakdown

| Category | File | Extracted Size | Ground Truth Size | Extractor Status | Similarity | Crashed |
| :--- | :--- | :---: | :---: | :--- | :---: | :---: |
| `00-sources` | `compte_rendu_reunion.pdf` | 1746 | 1749 | ✅ Exact extraction | **100.00 %** | No |
| `00-sources` | `facture_prestation.pdf` | 1542 | 1545 | ✅ Exact extraction | **100.00 %** | No |
| `00-sources` | `formulaire_administratif.pdf` | 1336 | 1339 | ✅ Exact extraction | **100.00 %** | No |
| `00-sources` | `rapport_synthese.pdf` | 1778 | 1781 | ✅ Exact extraction | **100.00 %** | No |
| `01-rasterise` | `compte_rendu_reunion_raster.pdf` | 1759 | 1749 | Partial (ocr) | **99.66 %** | No |
| `01-rasterise` | `facture_prestation_raster.pdf` | 1496 | 1545 | Partial (ocr) | **95.96 %** | No |
| `01-rasterise` | `formulaire_administratif_raster.pdf` | 1347 | 1339 | Partial (ocr) | **92.94 %** | No |
| `01-rasterise` | `rapport_synthese_raster.pdf` | 1789 | 1781 | ✅ Exact extraction | **100.00 %** | No |
| `02-pivote` | `compte_rendu_reunion_rot180.pdf` | 1759 | 1749 | Partial (ocr) | **99.66 %** | No |
| `02-pivote` | `compte_rendu_reunion_rot270.pdf` | 1759 | 1749 | Partial (ocr) | **99.66 %** | No |
| `02-pivote` | `compte_rendu_reunion_rot90.pdf` | 1759 | 1749 | Partial (ocr) | **99.66 %** | No |
| `02-pivote` | `facture_prestation_rot180.pdf` | 1496 | 1545 | Partial (ocr) | **95.96 %** | No |
| `02-pivote` | `facture_prestation_rot270.pdf` | 1496 | 1545 | Partial (ocr) | **95.96 %** | No |
| `02-pivote` | `facture_prestation_rot90.pdf` | 1496 | 1545 | Partial (ocr) | **95.96 %** | No |
| `02-pivote` | `formulaire_administratif_rot180.pdf` | 1347 | 1339 | Partial (ocr) | **92.94 %** | No |
| `02-pivote` | `formulaire_administratif_rot270.pdf` | 1347 | 1339 | Partial (ocr) | **92.94 %** | No |
| `02-pivote` | `formulaire_administratif_rot90.pdf` | 1347 | 1339 | Partial (ocr) | **92.94 %** | No |
| `02-pivote` | `rapport_synthese_rot180.pdf` | 1789 | 1781 | ✅ Exact extraction | **100.00 %** | No |
| `02-pivote` | `rapport_synthese_rot270.pdf` | 1789 | 1781 | ✅ Exact extraction | **100.00 %** | No |
| `02-pivote` | `rapport_synthese_rot90.pdf` | 1789 | 1781 | ✅ Exact extraction | **100.00 %** | No |
| `03-de-travers` | `compte_rendu_reunion_skew_minus_3_5deg.pdf` | 1760 | 1749 | Partial (ocr) | **99.83 %** | No |
| `03-de-travers` | `compte_rendu_reunion_skew_plus_5_0deg.pdf` | 1762 | 1749 | Partial (ocr) | **99.83 %** | No |
| `03-de-travers` | `facture_prestation_skew_minus_6_5deg.pdf` | 1497 | 1545 | Partial (ocr) | **95.70 %** | No |
| `03-de-travers` | `facture_prestation_skew_plus_3_0deg.pdf` | 1496 | 1545 | Partial (ocr) | **95.90 %** | No |
| `03-de-travers` | `formulaire_administratif_skew_minus_7_0deg.pdf` | 1347 | 1339 | Partial (ocr) | **99.77 %** | No |
| `03-de-travers` | `formulaire_administratif_skew_plus_4_5deg.pdf` | 1345 | 1339 | Partial (ocr) | **99.92 %** | No |
| `03-de-travers` | `rapport_synthese_skew_minus_5_0deg.pdf` | 1788 | 1781 | Partial (ocr) | **99.94 %** | No |
| `03-de-travers` | `rapport_synthese_skew_plus_6_0deg.pdf` | 1789 | 1781 | Partial (ocr) | **99.89 %** | No |
| `04-degrade` | `compte_rendu_reunion_bruit_scanner.pdf` | 1763 | 1749 | Partial (ocr) | **98.05 %** | No |
| `04-degrade` | `compte_rendu_reunion_photocopie_degradee.pdf` | 1745 | 1749 | Partial (ocr) | **96.84 %** | No |
| `04-degrade` | `facture_prestation_basse_res_72dpi.pdf` | 1484 | 1545 | Partial (ocr) | **95.05 %** | No |
| `04-degrade` | `facture_prestation_faible_contraste.pdf` | 1496 | 1545 | Partial (ocr) | **95.96 %** | No |
| `04-degrade` | `formulaire_administratif_fax_binaire.pdf` | 1333 | 1339 | Partial (ocr) | **40.84 %** | No |
| `04-degrade` | `formulaire_administratif_flou_bavure.pdf` | 1345 | 1339 | Partial (ocr) | **99.70 %** | No |
| `04-degrade` | `rapport_synthese_basse_res_72dpi.pdf` | 1788 | 1781 | Partial (ocr) | **99.89 %** | No |
| `04-degrade` | `rapport_synthese_faible_contraste.pdf` | 1789 | 1781 | ✅ Exact extraction | **100.00 %** | No |
| `04-degrade` | `rapport_synthese_photocopie_sombre.pdf` | 1788 | 1781 | Partial (ocr) | **99.94 %** | No |

---
*Report automatically generated by `software/test-corpus/measure.mjs`.*
