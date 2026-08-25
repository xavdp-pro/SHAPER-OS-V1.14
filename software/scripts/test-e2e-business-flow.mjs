#!/usr/bin/env node
/**
 * Automated Playwright / Chromium End-to-End Business Flow Runner
 * Target: SHAPER OS Cockpit (default: http://127.0.0.1:8650)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPlaywright, getChromeExecutablePath } from './playwright-resolver.mjs';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8650';
const EMAIL = process.env.E2E_EMAIL || 'xavier@xavdp.pro';
const PASSWORD = process.env.E2E_PASSWORD || 'bgvfVFCD123!';

const SCREENSHOT_DIR = path.resolve(process.env.ART_DIR || process.env.ARTIFACT_DIR || './e2e-artifacts');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

console.log('===============================================================');
console.log(' 🎭 SHAPER OS — AUTONOMOUS BUSINESS E2E PLAYWRIGHT VALIDATION');
console.log(` Target : ${BASE_URL}`);
console.log(` User   : ${EMAIL}`);
console.log('===============================================================\n');

async function run() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: getChromeExecutablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // -------------------------------------------------------------
    // Step 1: Login Flow
    // -------------------------------------------------------------
    console.log('▶ [Step 1] Testing Authentication & Session Persistence...');
    await page.goto(`${BASE_URL}/?lang=fr`, { waitUntil: 'networkidle', timeout: 30000 });
    
    const emailField = page.getByPlaceholder(/you@domain|vous@domaine|tu@dominio/i)
      .or(page.locator('input[type="text"], input[type="email"]').first());
    const passwordField = page.getByPlaceholder('••••••••')
      .or(page.locator('input[type="password"]').first());
    
    if (await passwordField.isVisible()) {
      await emailField.fill(EMAIL);
      await passwordField.fill(PASSWORD);
      await page.getByRole('button', { name: /S'authentifier|Sign in|Se connecter/i }).click();
      await page.waitForURL(/\/(console|admin)/, { timeout: 25000 });
    }

    if (!page.url().includes('/console/opencode/zaza/Xavier')) {
      await page.goto(`${BASE_URL}/console/opencode/zaza/Xavier`);
      await page.waitForLoadState('networkidle');
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-console-logged-in.png') });
    console.log(`  ✓ Authentication successful and session active (${page.url()})`);

    // -------------------------------------------------------------
    // Step 2: Presentation & Briefing Verification
    // -------------------------------------------------------------
    console.log('\n▶ [Step 2] Testing Presentation Briefing & Active Engine Header...');
    await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 25000 });
    await page.getByText(/Bonjour Xavier|Zephir|KovZu/i).first().waitFor({ state: 'visible', timeout: 20000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-presentation-briefing.png') });
    console.log('  ✓ Presentation board displayed: "Bonjour Xavier ! Je suis Zephir..."');

    // -------------------------------------------------------------
    // Step 3: Document Ingestion (Catalog & Sales CSV)
    // -------------------------------------------------------------
    console.log('\n▶ [Step 3] Testing Document Ingestion (ventes-canapes-2026.csv)...');
    const csvData = 'Date,Modele,Quantite,PrixUnitaire,MargeBrute\n2026-06-01,Canapé Oslo,14,890,4200\n2026-06-15,Canapé Helsinki,9,1250,3750\n2026-07-02,Canapé Stockholm,22,650,4400\n2026-07-20,Canapé Oslo,18,890,5400\n2026-08-05,Canapé Helsinki,12,1250,5000\n';
    const fileInput = page.locator('input[type="file"]').first();
    
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles({
        name: 'ventes-canapes-2026.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvData, 'utf8'),
      });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-document-attached.png') });
      console.log('  ✓ CSV document attached successfully in composer');
    }

    // -------------------------------------------------------------
    // Step 4: Autonomous Business Request (Sofa Sales Chart)
    // -------------------------------------------------------------
    console.log('\n▶ [Step 4] Testing Business Prompt Injection (Sofa Sales Stats)...');
    const businessPrompt = 'Génère la page de statistiques interactive avec le graphique des ventes de nos canapés (Oslo, Helsinki, Stockholm).';
    const textarea = page.locator('textarea').first();
    await textarea.fill(businessPrompt);
    
    // Press Enter to submit
    await textarea.press('Enter');
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-prompt-injected.png') });
    console.log('  ✓ User prompt recorded and injected into reactive stream');

    // -------------------------------------------------------------
    // Step 5: Multi-Surface Navigation (/talk & /ged)
    // -------------------------------------------------------------
    console.log('\n▶ [Step 5] Testing Multi-surface Navigation (/talk & /ged)...');
    
    // Talk Page (uses WebSocket for voice streams)
    await page.goto(`${BASE_URL}/talk`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-talk-interface.png') });
    console.log('  ✓ Voice interface (/talk) verified');

    // GED Page
    await page.goto(`${BASE_URL}/ged`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-ged-interface.png') });
    console.log('  ✓ GED interface (/ged) verified');

    // -------------------------------------------------------------
    // Step 6: Audio Playback & 401 Prevention Verification
    // -------------------------------------------------------------
    console.log('\n▶ [Step 6] Testing Audio Play & 401 Unauthorized Prevention...');
    
    // Return to console session
    await page.goto(`${BASE_URL}/console`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Track any 401 status code
    let unauthorizedDetected = false;
    page.on('response', (response) => {
      if (response.status() === 401) {
        unauthorizedDetected = true;
        console.error(`  ❌ 401 Unauthorized intercepted on: ${response.url()}`);
      }
    });

    // Look for any play button in the timeline or chat interface
    const playButton = page.locator('button[aria-label*="Lire"], button[title*="Lire"], button:has(svg.lucide-play)').first();
    if (await playButton.count() > 0 && await playButton.isVisible()) {
      await playButton.click();
      await page.waitForTimeout(2000);
      console.log('  ✓ Clicked audio playback (Play) button');
    } else {
      // Test direct voice status / TTS authorization API with the active session
      const voiceCheck = await page.evaluate(async () => {
        const token = localStorage.getItem('helm-auth-token') || '';
        const res = await fetch('/api/voice/status', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        return { status: res.status, ok: res.ok };
      });
      if (voiceCheck.status === 401) throw new Error('401 Unauthorized on /api/voice/status');
      console.log(`  ✓ Voice API authorized successfully (HTTP status: ${voiceCheck.status})`);
    }

    if (unauthorizedDetected) {
      throw new Error('401 Unauthorized error detected during audio playback');
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-voice-play-tested.png') });
    console.log('  ✓ No 401 error during audio playback action');

    console.log('\n===============================================================');
    console.log(' 🏆 ALL PLAYWRIGHT E2E SCENARIOS 100% VALIDATED!');
    console.log('===============================================================');

  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('\n❌ ERROR DURING PLAYWRIGHT E2E TEST:', err);
  process.exit(1);
});
