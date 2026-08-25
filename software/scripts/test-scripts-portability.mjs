#!/usr/bin/env node
/**
 * Non-regression test (Rule 29 & Rule 0B)
 * Verifies:
 * 1. Zero hardcoded machine paths in software/scripts
 * 2. Syntax validation (node --check) across all .mjs files
 * 3. Contract check for puppeteer-resolver and playwright-resolver
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('===============================================================');
console.log(' 🧪 NON-REGRESSION TEST: SCRIPTS PORTABILITY & ZERO HARDCODED PATHS');
console.log('===============================================================\n');

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
};

// 1. Check for banned machine path patterns
console.log('[1/3] Scanning software/scripts for forbidden machine paths...');
const bannedPatterns = [
  { name: 'machine home path', regex: new RegExp('/' + 'home/(?!neko\\b)') },
  { name: '/thePool0/ path', regex: /\/thePool0\// },
  { name: '/Bureau/ path', regex: /\/Bureau\// },
  { name: 'file:/// protocol with absolute machine path', regex: /file:\/\/\/(home|thePool|root|Bureau)/ },
  { name: 'Antigravity agent session uuid', regex: /brain\/[0-9a-f-]{36}/ },
];

const files = fs.readdirSync(__dirname);
for (const file of files) {
  // Skip this test script itself for pattern matching on strings
  if (file === 'test-scripts-portability.mjs') continue;
  const filePath = path.join(__dirname, file);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const bp of bannedPatterns) {
    const match = content.match(bp.regex);
    check(
      `No ${bp.name} in ${file}`,
      !match,
      match ? `Found match: "${match[0]}"` : ''
    );
  }
}

// 2. Syntax check all .mjs files
console.log('\n[2/3] Syntax checking all .mjs files with node --check...');
const mjsFiles = files.filter(f => f.endsWith('.mjs'));
for (const mjs of mjsFiles) {
  const filePath = path.join(__dirname, mjs);
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
    check(`node --check ${mjs}`, true);
  } catch (err) {
    check(`node --check ${mjs}`, false, err.message);
  }
}

// 3. Resolvers interface contract verification
console.log('\n[3/3] Checking resolver interface contracts...');
try {
  const puppeteerResolver = await import('./puppeteer-resolver.mjs');
  check('puppeteer-resolver exports loadPuppeteer', typeof puppeteerResolver.loadPuppeteer === 'function');
  check('puppeteer-resolver exports getChromeExecutablePath', typeof puppeteerResolver.getChromeExecutablePath === 'function');

  const playwrightResolver = await import('./playwright-resolver.mjs');
  check('playwright-resolver exports loadPlaywright', typeof playwrightResolver.loadPlaywright === 'function');
  check('playwright-resolver exports getChromeExecutablePath', typeof playwrightResolver.getChromeExecutablePath === 'function');
} catch (err) {
  check('Resolvers import cleanly', false, err.message);
}

console.log('\n===============================================================');
if (failures === 0) {
  console.log(' 🎉 ALL PORTABILITY & NON-REGRESSION CHECKS PASSED !');
  console.log('===============================================================');
  process.exit(0);
} else {
  console.error(` 💥 FAILED with ${failures} error(s).`);
  console.log('===============================================================');
  process.exit(1);
}
