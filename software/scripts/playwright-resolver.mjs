import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  process.env.PLAYWRIGHT_PATH,
  '@playwright/test',
  'playwright',
  'playwright-core',
  path.resolve(__dirname, '../bricks/brick-helm/app/node_modules/@playwright/test/index.js'),
  path.resolve(__dirname, '../bricks/brick-helm/app/node_modules/playwright-core/index.mjs'),
  path.resolve(__dirname, '../bricks/brick-helm/app/node_modules/playwright/index.js'),
  path.resolve(__dirname, '../node_modules/@playwright/test/index.js'),
  path.resolve(__dirname, '../node_modules/playwright-core/index.mjs'),
  path.resolve(__dirname, '../node_modules/playwright/index.js'),
  path.resolve(__dirname, '../../node_modules/@playwright/test/index.js'),
  path.resolve(__dirname, '../../node_modules/playwright-core/index.mjs'),
  path.resolve(__dirname, '../../node_modules/playwright/index.js'),
].filter(Boolean);

let playwrightModule = null;
let chromium = null;

for (const c of CANDIDATES) {
  try {
    const mod = await import(c);
    const resolved = mod.default || mod;
    if (resolved?.chromium || mod?.chromium) {
      playwrightModule = resolved;
      chromium = resolved?.chromium || mod?.chromium;
      break;
    }
  } catch {
    // Try next candidate
  }
}

export function getChromeExecutablePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const standardPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const p of standardPaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export function loadPlaywright() {
  if (!chromium) {
    console.error('Playwright not found. Install @playwright/test or playwright-core (e.g. npm i @playwright/test), or set PLAYWRIGHT_PATH.');
    process.exit(3);
  }
  return { playwright: playwrightModule, chromium };
}

export const getPlaywright = loadPlaywright;
export { chromium, playwrightModule as playwright };
export default playwrightModule;
