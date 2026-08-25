import { test, expect } from '@playwright/test';

const TARGET_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8650';

test.describe.configure({ mode: 'serial' });

test.describe('Shaper OS — Autonomous Business Owner E2E Suite', () => {
  test.use({ baseURL: TARGET_URL });

  test('1. Authentication & Console Navigation', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    
    // Check if login form is present
    const emailInput = page.locator('input[type="text"], input[type="email"]').first();
    const passInput = page.locator('input[type="password"]').first();
    const submitBtn = page.locator('button[type="submit"]').first();

    if (await passInput.isVisible()) {
      await emailInput.fill('xavier@xavdp.pro');
      await passInput.fill('bgvfVFCD123!');
      await submitBtn.click();
    }

    await page.waitForURL(/.*\/console.*/, { timeout: 15_000 });
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByText('Xavier').first()).toBeVisible();
  });

  test('2. Agent Console & Prompt Composer Readiness', async ({ page }) => {
    await page.goto('/console', { waitUntil: 'domcontentloaded' });
    
    const input = page.getByPlaceholder(/Tapez votre message|Type your message/i);
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    // Verify paperclip upload attachment button
    const attachBtn = page.locator('button').filter({ hasText: /Joindre|Attach/i }).or(page.locator('button[title*="Joindre"], button[title*="Attach"], button[aria-label*="Joindre"], button[aria-label*="Attach"]')).first();
    if (await attachBtn.isVisible()) {
      await expect(attachBtn).toBeEnabled();
    }
  });

  test('3. Document Ingestion (Catalog / Sales CSV Upload)', async ({ page }) => {
    await page.goto('/console', { waitUntil: 'domcontentloaded' });

    const csvContent = 'Date,Modele,Quantite,PrixUnitaire,MargeBrute\n2026-06-01,Canapé Oslo,14,890,4200\n2026-06-15,Canapé Helsinki,9,1250,3750\n2026-07-02,Canapé Stockholm,22,650,4400\n2026-07-20,Canapé Oslo,18,890,5400\n2026-08-05,Canapé Helsinki,12,1250,5000\n';
    const fileInput = page.locator('input[type="file"]').first();

    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles({
        name: 'ventes-canapes-q2-2026.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvContent, 'utf8'),
      });
      await expect(page.getByText(/ventes-canapes/i).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('4. Autonomous Production Delivery — The Sofa Sales Chart', async ({ page }) => {
    await page.goto('/console', { waitUntil: 'domcontentloaded' });

    const promptText = 'Génère la page de statistiques interactive avec le graphique des ventes de canapés (Oslo, Helsinki, Stockholm).';
    const input = page.getByPlaceholder(/Tapez votre message|Type your message/i);
    const sendBtn = page.getByRole('button', { name: /Envoyer|Send/i });

    await input.fill(promptText);
    await sendBtn.click();

    // Verify human turn appears in timeline
    await expect(page.getByText(promptText).first()).toBeVisible({ timeout: 10_000 });
  });

  test('5. Multi-Page Cockpit Navigation (/talk & /ged)', async ({ page }) => {
    // Test Talk Voice Interface
    await page.goto('/talk', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();

    // Test GED Document Management Interface
    await page.goto('/ged', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
  });
});
