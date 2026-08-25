import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  process.env.PUPPETEER_PATH,
  'puppeteer',
  'puppeteer-core',
  path.resolve(__dirname, '../node_modules/puppeteer'),
  path.resolve(__dirname, '../node_modules/puppeteer-core'),
  path.resolve(__dirname, '../../node_modules/puppeteer'),
  path.resolve(__dirname, '../../node_modules/puppeteer-core'),
  path.resolve(__dirname, '../bricks/brick-helm/app/node_modules/puppeteer'),
  path.resolve(__dirname, '../bricks/brick-helm/app/node_modules/puppeteer-core'),
  path.resolve(__dirname, '../bricks/brick-helm/app/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'),
  path.resolve(__dirname, '../bricks/brick-helm/app/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'),
].filter(Boolean);

let puppeteerModule = null;

for (const c of CANDIDATES) {
  try {
    const mod = await import(c);
    const resolved = mod.default || mod;
    if (resolved && (typeof resolved.launch === 'function' || typeof mod.launch === 'function')) {
      puppeteerModule = resolved.launch ? resolved : mod;
      break;
    }
  } catch {
    // Try next candidate
  }
}

export function getChromeExecutablePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
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

export function loadPuppeteer() {
  if (!puppeteerModule) {
    console.error('Puppeteer not found. Install puppeteer or puppeteer-core (e.g. npm i puppeteer-core), or set PUPPETEER_PATH.');
    process.exit(3);
  }
  return puppeteerModule;
}

export const getPuppeteer = loadPuppeteer;
export const puppeteer = puppeteerModule;
export default puppeteerModule;
