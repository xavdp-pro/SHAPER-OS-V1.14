import { test, expect } from '@playwright/test';
import { email } from './helpers/auth.js';

test.describe('Login (public)', () => {
  test('shows KovZu title and login form', async ({ page }) => {
    await page.goto('/?lang=fr');
    await expect(page).toHaveTitle(/KovZu/i);
    await expect(
      page.getByLabel(/Email ou identifiant|Email or username/i)
        .or(page.getByPlaceholder(/vous@domaine/i)),
    ).toBeVisible();
    await expect(
      page.getByLabel(/Mot de passe|Password/i)
        .or(page.getByPlaceholder('••••••••')),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /S'authentifier/i })).toBeVisible();
  });

  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/?lang=fr');
    await page.getByLabel(/Email ou identifiant/i)
      .or(page.getByPlaceholder(/vous@domaine/i))
      .fill('invalid@example.com');
    await page.getByLabel(/Mot de passe/i)
      .or(page.getByPlaceholder('••••••••'))
      .fill('wrong-password-xyz');
    await page.getByRole('button', { name: /S'authentifier/i }).click();
    await expect(page.getByText(/Identifiants incorrects|Invalid credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\//);
  });

  test('toggles password visibility', async ({ page }) => {
    await page.goto('/?lang=fr');
    const pwd = page.getByLabel(/Mot de passe/i).or(page.getByPlaceholder('••••••••'));
    await pwd.fill('secret-test');
    await expect(pwd).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: /Afficher|Show|Mostrar/i }).click();
    await expect(pwd).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: /Masquer|Hide|Ocultar/i }).click();
    await expect(pwd).toHaveAttribute('type', 'password');
  });

  test('supports Spanish locale via ?lang=es', async ({ page }) => {
    await page.goto('/?lang=es');
    await expect(page.getByRole('button', { name: /Iniciar sesión/i })).toBeVisible();
    await expect(page.getByLabel(/Email o identificador/i)).toBeVisible();
  });

  test('preserves next redirect query for protected routes', async ({ page }) => {
    await page.goto('/console/gbs-h1/zaza/Xavier');
    await expect(page).toHaveURL(/next=/);
    await expect(page.getByLabel(/Email ou identifiant|Email or username/i)
      .or(page.getByPlaceholder(/vous@domaine|you@domain/i))).toBeVisible();
  });
});
