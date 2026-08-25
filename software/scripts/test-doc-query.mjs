import fs from 'node:fs';
import path from 'node:path';
import { loadPuppeteer, getChromeExecutablePath } from './puppeteer-resolver.mjs';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8650';
const ART_DIR = process.env.ART_DIR || process.env.ARTIFACT_DIR || path.resolve('./artifacts');
fs.mkdirSync(ART_DIR, { recursive: true });

(async () => {
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: getChromeExecutablePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1000));

  const passInput = await page.$('input[type="password"]');
  if (passInput) {
    const emailInput = await page.$('input[type="text"], input[type="email"]');
    if (emailInput) await emailInput.type('xavier@xavdp.pro');
    await passInput.type('bgvfVFCD123!');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 2500));
  }

  await page.goto(`${BASE_URL}/talk`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));

  const buttons = await page.$$('main button');
  if (buttons.length >= 2) {
    console.log('Clicking 2nd suggestion: "Fais-moi le point sur les documents"');
    await buttons[1].click();
    await new Promise(r => setTimeout(r, 3500));
    const subtitle = await page.$eval('main p.text-base, main p.text-slate-200', el => el.textContent).catch(() => '');
    console.log('Spoken Subtitle from Zephir:', subtitle);
    await page.screenshot({ path: `${ART_DIR}/test_talk_doc_point.png` });
  }

  await browser.close();
  console.log('Doc query test completed successfully');
})();
