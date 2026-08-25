import fs from 'node:fs';
import path from 'node:path';
import { loadPuppeteer, getChromeExecutablePath } from './puppeteer-resolver.mjs';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8650';
const ART_DIR = process.env.ART_DIR || process.env.ARTIFACT_DIR || path.resolve('./artifacts');

async function run() {
  console.log('Testing Interaction Mode Selector & Voice Controls in Console...');
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: getChromeExecutablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // 1. Authentication
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));
  const passInput = await page.$('input[type="password"]');
  if (passInput) {
    const emailInput = await page.$('input[type="text"], input[type="email"]');
    if (emailInput) await emailInput.type('xavier@xavdp.pro');
    await passInput.type('bgvfVFCD123!');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 2500));
  }

  await page.goto(`${BASE_URL}/console`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // 2. Mode selector check
  const modeBtn = await page.$('button[aria-haspopup="listbox"]');
  console.log('✓ Mode selector button detected:', Boolean(modeBtn));

  // 3. Mic & Audio button check
  const micBtn = await page.$('button[data-help-target="help-voice-mic"]');
  const audioBtn = await page.$('button[data-help-target="help-voice-audio"]');
  console.log('✓ Mic button present in Chat:', Boolean(micBtn));
  console.log('✓ Audio playback button present in Chat:', Boolean(audioBtn));

  // 4. Screenshot
  fs.mkdirSync(ART_DIR, { recursive: true });
  const artifactPath = path.join(ART_DIR, 'console_with_modes_and_mic.png');
  await page.screenshot({ path: artifactPath, fullPage: false });
  console.log('✓ Screenshot saved to:', artifactPath);

  await browser.close();
}

run().catch(console.error);

