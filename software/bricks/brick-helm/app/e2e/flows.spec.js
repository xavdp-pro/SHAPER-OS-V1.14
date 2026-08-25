import { test, expect } from '@playwright/test';
import {
  openConsole,
  openOptionsMenu,
  openSidebar,
  sidebar,
  ensureComposer25NoFast,
} from './helpers/auth.js';
import { TEST_USER, TEST_SESSIONS } from './helpers/testUser.js';

test.describe('Flows Xavier (authenticated)', () => {
  test('profile API matches test user', async ({ page }) => {
    await openConsole(page);
    const res = await page.request.get('/api/auth/me');
    const body = await res.json();
    expect(body.user?.email).toBe(TEST_USER.email);
    expect(body.user?.role).toBe(TEST_USER.role);
    expect(body.user?.name).toContain('Xavier');
  });

  test('switches conversation via sidebar', async ({ page }) => {
    await openConsole(page, TEST_SESSIONS.primary);
    await openSidebar(page);
    await sidebar(page).getByRole('button', { name: /NOW2/i }).click();
    await expect(page).toHaveURL(/\/console\/acer\/zaza\/NOW2/);
    await expect(page.locator('header').getByText(/acer\s*\/\s*zaza\s*\/\s*NOW2/).first()).toBeVisible();
  });

  test('deep link NOW3 loads correct breadcrumb', async ({ page }) => {
    await openConsole(page, TEST_SESSIONS.now3);
    await expect(page.locator('header').getByText(/asus\s*\/\s*zaza\s*\/\s*NOW3/).first()).toBeVisible();
  });

  test('timeline API returns items for active session', async ({ page }) => {
    await openConsole(page, TEST_SESSIONS.primary);
    const res = await page.request.get(`/api/timeline?conversation=${encodeURIComponent(TEST_SESSIONS.primary)}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  test('composer accepts draft text and enables send', async ({ page }) => {
    await openConsole(page);
    const input = page.getByPlaceholder(/Tapez votre message|Type your message/i);
    const send = page.getByRole('button', { name: /Envoyer|Send/i });
    await expect(send).toBeDisabled();
    const draft = `[e2e ${Date.now()}] brouillon sans envoi`;
    await input.fill(draft);
    await expect(send).toBeEnabled();
    await input.fill('');
    await expect(send).toBeDisabled();
  });

  test('Reborn confirmation opens and cancels', async ({ page }) => {
    await openConsole(page);
    await openOptionsMenu(page);
    await page.getByRole('button', { name: /^Reborn$/i }).click();
    const dialog = page.getByRole('dialog', {
      name: /Recommencer à zéro|Start fresh|Empezar de cero/i,
    });
    await expect(dialog.getByRole('heading', {
      name: /Recommencer à zéro|Start fresh|Empezar de cero/i,
    })).toBeVisible();
    await dialog.getByRole('button', { name: /^Annuler$|^Cancel$|^Cancelar$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByPlaceholder(/Tapez votre message|Type your message/i)).toBeVisible();
  });

  test('copy conversation action is available', async ({ page }) => {
    await openConsole(page, TEST_SESSIONS.primary);
    await openOptionsMenu(page);
    const copyBtn = page.getByRole('button', { name: /^Copier$|^Copy$/i });
    await expect(copyBtn).toBeEnabled();
  });

  test('reload conversation button in sidebar', async ({ page }) => {
    await openConsole(page, TEST_SESSIONS.primary);
    await openSidebar(page);
    const reload = sidebar(page).getByRole('button', { name: /Recharger la conversation|Reload conversation/i });
    await expect(reload.first()).toBeVisible();
  });

  test('admin briefing page editable', async ({ page }) => {
    await ensureComposer25NoFast(page);
    await page.goto('/admin/briefing?lang=fr');
    await expect(page.getByRole('navigation', { name: /Sections administration/i })).toBeVisible();
    const field = page.locator('textarea').first();
    await expect(field).toBeVisible();
  });

  test('voice status API responds', async ({ page }) => {
    await openConsole(page);
    const res = await page.request.get('/api/voice/status');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test('bootstrap API exposes mode flags', async ({ page }) => {
    const res = await page.request.get('/api/bootstrap');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBeTruthy();
    expect(typeof body.demoLogin).toBe('boolean');
  });

  test('settings API exposes app name KovZu', async ({ page }) => {
    await openConsole(page);
    const res = await page.request.get('/api/settings');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(String(body.appName || '')).toMatch(/KovZu/i);
  });
});
