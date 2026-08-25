import { test, expect } from '@playwright/test';
import { openConsole, openOptionsMenu, openSidebar, sidebar } from './helpers/auth.js';

test.describe('Console (authenticated)', () => {
  test('uses Composer 2.5 with Fast disabled', async ({ page }) => {
    await openConsole(page);
    const res = await page.request.get('/api/settings');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.modelFamily).toBe('composer-2.5');
    expect(body.modelFast).toBe(false);
    expect(body.composerModel).toBe('composer-2.5');

    await openOptionsMenu(page);
    const fastBtn = page.getByRole('button', { name: /^Fast$/i });
    if (await fastBtn.count()) {
      await expect(fastBtn).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('shows session breadcrumb in header', async ({ page }) => {
    await openConsole(page, 'gbs-h1/zaza/Xavier');
    await expect(page.locator('header').getByText(/gbs-h1\s*\/\s*zaza\s*\/\s*Xavier/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/console\/gbs-h1\/zaza\/Xavier/);
  });

  test('chat composer is ready', async ({ page }) => {
    await openConsole(page);
    const input = page.getByPlaceholder(/Tapez votre message|Type your message/i);
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    await expect(page.getByRole('button', { name: /Envoyer|Send/i })).toBeVisible();
  });

  test('conversations sidebar lists history', async ({ page }) => {
    await openConsole(page);
    await openSidebar(page);
    await expect(sidebar(page).getByText(/Historique|History|Historial/i)).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /Déconnexion|Log out|Cerrar sesión/i })).toBeVisible();
  });

  test('help overlay opens and closes', async ({ page }) => {
    await openConsole(page);
    await page.getByRole('button', { name: /Aide — zones de la console|Help — console/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: /Fermer|Close|Cerrar/i }).click();
    await expect(dialog).toBeHidden();
  });

  test('options menu exposes all view zones', async ({ page }) => {
    await openConsole(page);
    await openOptionsMenu(page);
    await expect(page.getByText(/^Zones$/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Réflexion$|^Thinking$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Outils$|^Tools$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Terminal$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Logs$/ })).toBeVisible();
  });

  test('toggles thinking zone filter', async ({ page }) => {
    await openConsole(page);
    await openOptionsMenu(page);
    const thinking = page.getByRole('button', { name: /^Réflexion$|^Thinking$/ });
    const before = await thinking.getAttribute('aria-pressed');
    await thinking.click();
    await expect(thinking).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  });

  test('karaoke toggle is visible when supported', async ({ page }) => {
    await openConsole(page);
    await openOptionsMenu(page);
    const karaoke = page.getByRole('button', { name: /^Karaoke$/ });
    if (await karaoke.count()) {
      await expect(karaoke).toBeVisible();
      await expect(karaoke).toHaveAttribute('aria-pressed', /true|false/);
    }
  });

  test('language selector switches UI to English', async ({ page }) => {
    await openConsole(page);
    await page.getByRole('button', { name: /Langue|Language/i }).click();
    await page.getByRole('option', { name: /English/i }).click();
    await expect(page.getByPlaceholder(/Type your message/i)).toBeVisible({ timeout: 10_000 });
  });

  test('reload keeps the same conversation URL', async ({ page }) => {
    await openConsole(page, 'gbs-h1/zaza/Xavier');
    await page.reload();
    await expect(page).toHaveURL(/\/console\/gbs-h1\/zaza\/Xavier/);
    await expect(page.locator('header').getByText(/gbs-h1\s*\/\s*zaza\s*\/\s*Xavier/).first()).toBeVisible();
  });

  test('logout returns to login page', async ({ page }) => {
    await openConsole(page);
    await openSidebar(page);
    await sidebar(page).getByRole('button', { name: /Déconnexion|Log out|Cerrar sesión/i }).click();
    await expect(page).toHaveURL(/\/?(\?|$)/);
    await expect(page.getByRole('button', { name: /S'authentifier|Sign in/i })).toBeVisible();
  });

  test('api /auth/me returns user profile', async ({ page }) => {
    await openConsole(page);
    const res = await page.request.get('/api/auth/me');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user?.email).toMatch(/@/);
    expect(['admin', 'operator', 'viewer']).toContain(body.user?.role);

    const settings = await page.request.get('/api/settings');
    const cfg = await settings.json();
    expect(cfg.modelFamily).toBe('composer-2.5');
    expect(cfg.modelFast).toBe(false);
  });
});
