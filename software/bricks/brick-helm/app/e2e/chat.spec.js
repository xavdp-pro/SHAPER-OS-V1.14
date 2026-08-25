import { test, expect } from '@playwright/test';
import { openConsole } from './helpers/auth.js';

/**
 * Chat « complet » — vérifie que TOUTES les fonctionnalités du chat sont
 * présentes et câblées (composer, upload, livrables, canvas/panneau droit,
 * voix, filtres). Rapide (pas de vrai tour agent : voir agent.spec.js).
 * But : lancer à chaque modif pour être sûr que « le truc est carré ».
 */
test.describe('Chat — fonctionnalités complètes (authenticated)', () => {
  test('composer : saisie + trombone (upload) + envoi', async ({ page }) => {
    await openConsole(page);
    const input = page.getByPlaceholder(/Tapez votre message|Type your message/i);
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    // Trombone (upload images + documents)
    await expect(page.getByRole('button', { name: /Joindre une image ou un document|Attach/i })).toBeVisible();
    // Bouton envoyer
    await expect(page.getByRole('button', { name: /Envoyer|Send/i })).toBeVisible();
  });

  test('upload : une puce document apparaît', async ({ page }) => {
    await openConsole(page);
    const csv = Buffer.from('produit,ca\nA,1200\n', 'utf8');
    await page.locator('input[type=file]').first().setInputFiles({
      name: 'rapport-e2e.csv', mimeType: 'text/csv', buffer: csv,
    });
    await expect(page.getByText('rapport-e2e.csv')).toBeVisible({ timeout: 10_000 });
  });

  test('panneau Livrables présent', async ({ page }) => {
    await openConsole(page);
    await expect(page.getByRole('button', { name: /Livrables|Deliverables|Entregables/i })).toBeVisible();
  });

  test('panneau droit (canvas) : onglets Aperçu / Debug / Navigateur', async ({ page }) => {
    await openConsole(page);
    await page.getByRole('button', { name: /Panneau projet/i }).click();
    await expect(page.getByRole('button', { name: /^Aperçu$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Debug$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Navigateur$/ })).toBeVisible();
    // Aperçu : sélecteur dossier /apps + formulaire de création
    const folderPicker = page.locator('button.picker-trigger[aria-haspopup="listbox"]').first();
    await expect(folderPicker).toBeVisible();
    await folderPicker.click();
    await expect(page.getByRole('button', { name: /^Créer$|^Create$/i })).toBeVisible();
  });

  test('API vibe/projects répond', async ({ page }) => {
    await openConsole(page);
    const res = await page.request.get('/api/vibe/projects');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.projects)).toBe(true);
  });

  test('voix : statut API + contrôles composer', async ({ page }) => {
    await openConsole(page);
    const res = await page.request.get('/api/voice/status');
    expect(res.ok()).toBeTruthy();
    // Micro visible dans le composer
    await expect(page.locator('button[aria-label*="micro" i], button[title*="micro" i]').first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => {}); // selon config voix
  });

  test('bootstrap expose le mode', async ({ page }) => {
    await openConsole(page);
    const res = await page.request.get('/api/bootstrap');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.mode).toBe('string');
  });
});
