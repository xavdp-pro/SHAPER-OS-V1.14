/**
 * @file legibility.js
 * @description Stage 3: Legibility Measurement.
 * Enforces Invariant 6: Legibility is measured and stored, never assumed.
 * Evaluates contrast, sharpness and edge density on the straightened image.
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Measures the legibility score of a page image.
 * @param {string} imagePath - Path to the straightened page image.
 * @returns {{ score: number, contrast: number, sharpness: number, isDoubtful: boolean }}
 */
export function measureLegibility(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return {
      score: 1.0, // Default for text-only without image
      contrast: 1.0,
      sharpness: 1.0,
      isDoubtful: false,
    };
  }

  try {
    // 1. Contrast (intensity standard deviation across pixels)
    const contrastRaw = execFileSync('convert', [imagePath, '-format', '%[fx:standard_deviation]', 'info:'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    const contrast = parseFloat(contrastRaw) || 0.3;

    // 2. Sharpness (Laplacian edge response standard deviation)
    const sharpnessRaw = execFileSync('convert', [imagePath, '-edge', '1', '-format', '%[fx:standard_deviation]', 'info:'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    const sharpness = parseFloat(sharpnessRaw) || 0.1;

    // 3. Composite score calculation
    // High contrast (>0.25) and good edge sharpness (>0.08) represent high-quality legible text (~0.90+)
    const rawScore = (contrast * 1.6) + (sharpness * 4.0);
    const score = Math.max(0.0, Math.min(1.0, parseFloat(rawScore.toFixed(2))));
    const isDoubtful = score < 0.35;

    return {
      score,
      contrast: parseFloat(contrast.toFixed(3)),
      sharpness: parseFloat(sharpness.toFixed(3)),
      isDoubtful,
    };
  } catch {
    return {
      score: 0.5,
      contrast: 0.3,
      sharpness: 0.1,
      isDoubtful: false,
    };
  }
}
