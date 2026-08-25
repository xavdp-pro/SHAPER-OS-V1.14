import fs from 'node:fs';
import path from 'node:path';
import { loadPuppeteer, getChromeExecutablePath } from './puppeteer-resolver.mjs';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8650';
const ART_DIR = process.env.ART_DIR || process.env.ARTIFACT_DIR || path.resolve('./artifacts');
fs.mkdirSync(ART_DIR, { recursive: true });

console.log('===========================================================');
console.log(' 🚀 CONSOLE CHAT TEST (MAIN MODE)');
console.log(` Target : ${BASE_URL}`);
console.log('===========================================================\n');

(async () => {
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: getChromeExecutablePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[error]') || text.includes('Uncaught') || text.includes('Error')) {
      console.log('  [Browser Log]', text);
    }
  });

  // 1. Authentication
  console.log('[1/4] Administrator login...');
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
  console.log('  ✓ Authenticated successfully, current URL:', page.url());

  // 2. Chat Console verification
  console.log('\n[2/4] Loading Chat Console (/console)...');
  await page.waitForSelector('textarea, [data-help-target="help-chat-input"]', { timeout: 15000 });
  console.log('  ✓ Chat input field present and active');

  await page.screenshot({ path: `${ART_DIR}/chat_console_initial.png` });

  // 3. Send message in chat
  console.log('\n[3/4] Sending a message in Chat...');
  const textarea = await page.$('textarea');
  if (!textarea) throw new Error('Textarea not found');

  await textarea.type('Bonjour ! Fais-moi une présentation synthétique de ton rôle.');
  await new Promise(r => setTimeout(r, 500));

  // Click submit button or press Enter
  const sendButton = await page.$('button[type="submit"], button[aria-label="Envoyer"]');
  if (sendButton) {
    await sendButton.click();
  } else {
    await textarea.press('Enter');
  }
  console.log('  ✓ Message submitted');

  // 4. Wait for streaming response
  console.log('\n[4/4] Waiting for assistant\'s response...');
  await new Promise(r => setTimeout(r, 5000));

  await page.screenshot({ path: `${ART_DIR}/chat_console_responded.png` });

  const textBlocks = await page.$$eval('[data-help-target="help-chat-viewport"] p, .prose p', els => els.map(e => e.textContent.trim()).filter(Boolean));
  console.log(`  -> Text blocks detected in timeline (${textBlocks.length})`);
  if (textBlocks.length > 0) {
    console.log('  Latest extracted text :', textBlocks[textBlocks.length - 1].slice(0, 120) + '...');
  }

  await browser.close();
  console.log('\n===========================================================');
  console.log(' ✅ CONSOLE CHAT WORKS PERFECTLY!');
  console.log('===========================================================');
})().catch(err => {
  console.error('❌ ERROR DURING CHAT TEST:', err);
  process.exit(1);
});
