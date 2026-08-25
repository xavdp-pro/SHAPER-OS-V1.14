import { test, expect } from '@playwright/test';
import { ensureComposer25NoFast, openSidebar, sidebar } from './helpers/auth.js';

test.describe('Admin (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await ensureComposer25NoFast(page);
  });

  test('admin user reaches agent settings', async ({ page }) => {
    await page.goto('/admin/agent?lang=fr');
    await expect(page).toHaveURL(/\/admin\/agent/);
    await expect(page.getByRole('navigation', { name: /Sections administration|Administration sections/i })).toBeVisible();
    await expect(page.getByText(/Agent|Zephir/i).first()).toBeVisible();
  });

  test('admin navigation links are reachable', async ({ page }) => {
    await page.goto('/admin/agent?lang=fr');
    const nav = page.getByRole('navigation', { name: /Sections administration|Administration sections/i });
    await nav.getByRole('link', { name: /Utilisateurs|Users/i }).click();
    await expect(page).toHaveURL(/\/admin\/users/);

    await nav.getByRole('link', { name: /Briefing/i }).click();
    await expect(page).toHaveURL(/\/admin\/briefing/);

    await nav.getByRole('link', { name: /Voix|Voices/i }).click();
    await expect(page).toHaveURL(/\/admin\/voices/);

    await nav.getByRole('link', { name: /CLI/i }).click();
    await expect(page).toHaveURL(/\/admin\/cli/);
  });

  test('sidebar link opens admin from console', async ({ page }) => {
    await page.goto('/console/gbs-h1/zaza/Xavier?lang=fr');
    await openSidebar(page);
    await sidebar(page).getByRole('link', { name: /Administration/i }).click();
    await expect(page).toHaveURL(/\/admin/);
  });

  test('admin can return to console', async ({ page }) => {
    await page.goto('/admin/agent?lang=fr');
    await page.getByRole('link', { name: /Console/i }).click();
    await expect(page).toHaveURL(/\/console/);
  });
});
