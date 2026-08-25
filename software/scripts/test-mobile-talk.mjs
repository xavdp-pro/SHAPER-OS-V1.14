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

  // Mobile iPhone 14 (390 x 844)
  const mobilePage = await browser.newPage();
  await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  await mobilePage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1000));

  const passInput = await mobilePage.$('input[type="password"]');
  if (passInput) {
    const emailInput = await mobilePage.$('input[type="text"], input[type="email"]');
    if (emailInput) await emailInput.type('xavier@xavdp.pro');
    await passInput.type('bgvfVFCD123!');
    await mobilePage.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 2500));
  }

  await mobilePage.goto(`${BASE_URL}/talk`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));

  await mobilePage.screenshot({ path: `${ART_DIR}/mobile_talk_clean_no_bottom_button.png` });

  // Test tap on the big central orb
  const orb = await mobilePage.$('div[role="button"]');
  if (orb) {
    console.log('Tapping big central VoiceOrb on mobile...');
    await orb.click();
    await new Promise(r => setTimeout(r, 1500));
    await mobilePage.screenshot({ path: `${ART_DIR}/mobile_talk_orb_tapped.png` });
  }

  // Desktop (1280 x 800)
  const desktopPage = await browser.newPage();
  await desktopPage.setViewport({ width: 1280, height: 800 });
  await desktopPage.goto(`${BASE_URL}/talk`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));
  await desktopPage.screenshot({ path: `${ART_DIR}/desktop_talk_clean_no_bottom_button.png` });

  await browser.close();
  console.log('Mobile & Desktop tests completed successfully');
})();
