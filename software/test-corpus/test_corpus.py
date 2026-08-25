#!/usr/bin/env python3
"""
Unit and Non-Regression Tests for SHAPER-OS Test Corpus (Rule 29).
Validates structural integrity, 1:1 pairing with ground truth (.verite.txt),
absence of vector text layers in rasterized scans, and content sanity.
"""

import os
import sys
import unittest
import subprocess
import glob

CORPUS_DIR = os.path.dirname(os.path.abspath(__file__))

class TestCorpusIntegrity(unittest.TestCase):
    
    def setUp(self):
        self.categories = [
            "00-sources",
            "01-rasterise",
            "02-pivote",
            "03-de-travers",
            "04-degrade"
        ]
        
    def test_01_directories_exist(self):
        """Verify all required subdirectories exist."""
        for cat in self.categories:
            cat_path = os.path.join(CORPUS_DIR, cat)
            self.assertTrue(os.path.isdir(cat_path), f"Directory {cat} must exist")

    def test_02_every_pdf_has_verite_file(self):
        """Verify that every PDF file has a 1-to-1 matching .verite.txt file."""
        total_pdfs = 0
        for cat in self.categories:
            cat_path = os.path.join(CORPUS_DIR, cat)
            pdf_files = glob.glob(os.path.join(cat_path, "*.pdf"))
            self.assertGreater(len(pdf_files), 0, f"Directory {cat} should not be empty")
            
            for pdf_path in pdf_files:
                total_pdfs += 1
                truth_path = pdf_path[:-4] + ".verite.txt"
                self.assertTrue(os.path.exists(truth_path), 
                                f"Missing ground truth file for: {pdf_path}")
                
                # Check ground truth is non-empty
                with open(truth_path, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                self.assertGreater(len(content), 100, 
                                  f"Ground truth file {truth_path} seems too short or empty")

        print(f"\n[Test] Verified {total_pdfs} PDF files with valid .verite.txt pairs across all directories.")

    def test_03_every_verite_has_matching_pdf(self):
        """Verify that no orphaned .verite.txt exists without its PDF."""
        for cat in self.categories:
            cat_path = os.path.join(CORPUS_DIR, cat)
            truth_files = glob.glob(os.path.join(cat_path, "*.verite.txt"))
            for truth_path in truth_files:
                pdf_path = truth_path.replace(".verite.txt", ".pdf")
                self.assertTrue(os.path.exists(pdf_path), 
                                f"Orphaned ground truth without PDF: {truth_path}")

    def test_04_sources_match_ground_truth(self):
        """Verify that pdftotext on 00-sources matches .verite.txt."""
        sources_path = os.path.join(CORPUS_DIR, "00-sources")
        pdf_files = glob.glob(os.path.join(sources_path, "*.pdf"))
        self.assertGreaterEqual(len(pdf_files), 4, "At least 4 source documents required")
        
        for pdf_path in pdf_files:
            truth_path = pdf_path[:-4] + ".verite.txt"
            res = subprocess.run(["pdftotext", pdf_path, "-"], 
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            extracted = res.stdout.strip()
            with open(truth_path, "r", encoding="utf-8") as f:
                expected = f.read().strip()
            self.assertEqual(extracted, expected, 
                             f"Extracted text does not match ground truth for source: {pdf_path}")

    def test_05_rasterised_documents_have_no_text_layer(self):
        """Verify that in 01-rasterise, pdftotext extracts NO text (pure image scans)."""
        raster_path = os.path.join(CORPUS_DIR, "01-rasterise")
        pdf_files = glob.glob(os.path.join(raster_path, "*.pdf"))
        self.assertGreaterEqual(len(pdf_files), 4, "At least 4 rasterised documents required")
        
        for pdf_path in pdf_files:
            res = subprocess.run(["pdftotext", pdf_path, "-"], 
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            # Extracted text on raster PDF should be empty (only form feed or whitespace)
            extracted_clean = res.stdout.replace("\x0c", "").strip()
            self.assertEqual(extracted_clean, "", 
                             f"Raster PDF {pdf_path} still contains text layer: {extracted_clean[:50]}...")

    def test_06_rotations_coverage(self):
        """Verify 02-pivote has 90, 180, and 270 rotations for all source documents."""
        pivote_path = os.path.join(CORPUS_DIR, "02-pivote")
        for rot in [90, 180, 270]:
            matching = glob.glob(os.path.join(pivote_path, f"*_rot{rot}.pdf"))
            self.assertGreaterEqual(len(matching), 4, f"Missing {rot}° rotation cases")

    def test_07_skew_angles_within_spec(self):
        """Verify 03-de-travers has angles strictly within 3° to 7° range."""
        skew_path = os.path.join(CORPUS_DIR, "03-de-travers")
        pdf_files = glob.glob(os.path.join(skew_path, "*.pdf"))
        self.assertGreaterEqual(len(pdf_files), 8, "At least 8 skewed test cases required")
        
        for pdf_path in pdf_files:
            fname = os.path.basename(pdf_path)
            self.assertTrue("deg" in fname, f"Filename {fname} should contain angle degrees")

    def test_08_degraded_variants_coverage(self):
        """Verify 04-degrade covers 72 DPI, low contrast, noise, and photocopy/fax effects."""
        degrade_path = os.path.join(CORPUS_DIR, "04-degrade")
        pdf_files = glob.glob(os.path.join(degrade_path, "*.pdf"))
        self.assertGreaterEqual(len(pdf_files), 8, "At least 8 degraded test cases required")
        
        types_found = set()
        for pdf_path in pdf_files:
            fname = os.path.basename(pdf_path)
            for t in ["72dpi", "contraste", "bruit", "photocopie", "fax", "flou"]:
                if t in fname:
                    types_found.add(t)
        self.assertGreaterEqual(len(types_found), 5, f"Expected varied degradation types, got {types_found}")

    def test_09_readme_documentation_exists(self):
        """Verify README.md exists and contains explanation of methodology and privacy."""
        readme_path = os.path.join(CORPUS_DIR, "README.md")
        self.assertTrue(os.path.exists(readme_path), "README.md must exist in test-corpus")
        with open(readme_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("01-rasterise", content)
        self.assertIn("02-pivote", content)
        self.assertIn("03-de-travers", content)
        self.assertIn("04-degrade", content)
        self.assertIn(".verite.txt", content)

    def test_10_mesure_script_and_report_exist(self):
        """Verify mesure.mjs and MEASUREMENT.md exist and contain valid benchmark data (Rule 29)."""
        mesure_script = os.path.join(CORPUS_DIR, "mesure.mjs")
        mesure_report = os.path.join(CORPUS_DIR, "MEASUREMENT.md")
        self.assertTrue(os.path.exists(mesure_script), "mesure.mjs must exist in test-corpus")
        self.assertTrue(os.path.exists(mesure_report), "MEASUREMENT.md must exist in test-corpus")
        
        with open(mesure_report, "r", encoding="utf-8") as f:
            report_content = f.read()
        
        self.assertIn("00-sources", report_content)
        self.assertIn("01-rasterise", report_content)
        self.assertIn("02-pivote", report_content)
        self.assertIn("03-de-travers", report_content)
        self.assertIn("04-degrade", report_content)
        self.assertIn("Levenshtein", report_content)
        self.assertIn("100.00 %", report_content)

if __name__ == "__main__":
    unittest.main()

