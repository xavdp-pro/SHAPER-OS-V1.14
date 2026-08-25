import fs from 'node:fs';
import path from 'node:path';
import { loadPuppeteer, getChromeExecutablePath } from './puppeteer-resolver.mjs';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8650';
const ART_DIR = process.env.ART_DIR || process.env.ARTIFACT_DIR || path.resolve('./artifacts');

async function run() {
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: getChromeExecutablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

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

  // Open Administrateur session
  await page.goto(`${BASE_URL}/console/opencode/zaza/Administrateur`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const textarea = await page.$('textarea');
  if (textarea) {
    await textarea.type('Test pipeline Administrateur : confirmation status.');
    await page.keyboard.press('Enter');
  }

  await new Promise(r => setTimeout(r, 10000));

  fs.mkdirSync(ART_DIR, { recursive: true });
  const artifactPath = path.join(ART_DIR, 'chat_admin_tested.png');
  await page.screenshot({ path: artifactPath, fullPage: false });
  console.log('✓ Administrateur session screenshot saved to:', artifactPath);

  await browser.close();
}

run().catch(console.error);

