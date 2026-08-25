/**
 * @file geometry.js
 * @description Stage 2: Orientation Analysis, Rotation and Deskew.
 * Enforces Invariant 5: Geometry before reading.
 * - Detects orthogonal orientation (0°, 90°, 180°, 270°) via Tesseract OSD.
 * - Corrects rotation.
 * - Deskews tilted scans (e.g. 3° to 7°).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Analyses image reading direction and detects required rotation.
 * @param {string} imagePath - Path to page image.
 * @returns {{ rotateDegrees: number, confidence: number, script: string }}
 */
export function detectOrientation(imagePath) {
  try {
    const stdout = execFileSync('tesseract', [imagePath, '-', '--psm', '0'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });

    const rotateMatch = /Rotate:\s*(\d+)/i.exec(stdout);
    const confMatch = /Orientation confidence:\s*([\d.]+)/i.exec(stdout);
    const scriptMatch = /Script:\s*(\w+)/i.exec(stdout);

    const rotateDegrees = rotateMatch ? parseInt(rotateMatch[1], 10) : 0;
    const confidence = confMatch ? parseFloat(confMatch[1]) : 0;
    const script = scriptMatch ? scriptMatch[1] : 'Unknown';

    return {
      rotateDegrees,
      confidence,
      script,
    };
  } catch {
    return {
      rotateDegrees: 0,
      confidence: 0,
      script: 'Unknown',
    };
  }
}

/**
 * Rotates and deskews a page image.
 * @param {string} imagePath - Input page image.
 * @param {object} [options] - Options including targetDir.
 * @returns {Promise<{ imagePath: string, appliedRotation: number, deskewed: boolean, orientationConfidence: number }>}
 */
export async function correctGeometry(imagePath, options = {}) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found for geometry correction: ${imagePath}`);
  }

  const dir = options.targetDir || path.dirname(imagePath);
  const ext = path.extname(imagePath);
  const base = path.basename(imagePath, ext);

  // 1. Detect orientation
  const { rotateDegrees, confidence } = detectOrientation(imagePath);
  let currentPath = imagePath;
  let appliedRotation = 0;

  // 2. Rotate if needed (only if confidence is sufficient to avoid false positives)
  if (rotateDegrees > 0 && confidence >= 1.5) {
    const rotatedPath = path.join(dir, `${base}_rot${rotateDegrees}${ext}`);
    try {
      execFileSync('convert', [currentPath, '-rotate', String(rotateDegrees), rotatedPath], { stdio: 'pipe' });
      currentPath = rotatedPath;
      appliedRotation = rotateDegrees;
    } catch {
      /* If convert fails, keep current image */
    }
  }

  // 3. Deskew tilted page (e.g. 3° to 7° skews)
  const deskewedPath = path.join(dir, `${base}_deskewed${ext}`);
  let deskewed = false;
  try {
    execFileSync('convert', [currentPath, '-deskew', '40%', deskewedPath], { stdio: 'pipe' });
    if (fs.existsSync(deskewedPath)) {
      currentPath = deskewedPath;
      deskewed = true;
    }
  } catch {
    /* If deskew fails, keep current image */
  }

  return {
    imagePath: currentPath,
    appliedRotation,
    deskewed,
    orientationConfidence: confidence,
  };
}
