import { test, expect } from '@playwright/test';
import {
  DEMO_OPERATOR,
  fetchIvonneInvite,
  openDemoConsole,
  openDemoSidebar,
  signInDemo,
  signInDemoOperator,
} from './helpers/demo.js';

test.describe('agent-demo public', () => {
  test('bootstrap exposes demo mode', async ({ request }) => {
    const res = await request.get('/api/bootstrap');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('demo');
    expect(body.demoLogin).toBe(true);
  });

  test('login page shows demo fill affordance', async ({ page }) => {
    await page.goto('/?lang=en');
    await expect(page.getByRole('button', { name: /Fill demo account|Remplir le compte démo/i })).toBeVisible();
  });

  test('demo invite returns Ivonne credentials', async ({ request }) => {
    const invite = await fetchIvonneInvite(request);
    expect(invite.user).toBe('ivonne');
    expect(invite.conversation).toBe('Ivonne');
    expect(invite.email).toMatch(/@/);
    expect(invite.password).toBeTruthy();
  });

  test('personalized ?user=ivonne link autofills login', async ({ page }) => {
    await page.goto('/?user=ivonne&lang=en');
    const emailField = page.getByLabel(/Email or username|Email ou identifiant/i)
      .or(page.getByPlaceholder(/you@domain|vous@domaine/i));
    const passwordField = page.getByLabel(/Password|Mot de passe/i)
      .or(page.getByPlaceholder('••••••••'));
    await expect(emailField).toHaveValue(/@/, { timeout: 20_000 });
    await expect(passwordField).not.toHaveValue('');
  });
});

test.describe('agent-demo operator (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await signInDemoOperator(page);
  });

  test('demo operator reaches scoped console', async ({ page }) => {
    await openDemoConsole(page, DEMO_OPERATOR.conversation);
    await expect(page.getByText(/cursor\s*\/\s*zaza\s*\/\s*Demo/i).first()).toBeVisible();
  });

  test('demo operator can access voices admin only', async ({ page }) => {
    await page.goto('/admin/voices?lang=en');
    await expect(page).toHaveURL(/\/admin\/voices/);
    await expect(page.getByRole('heading', { name: /Demo voices|Voix démo|Voces demo/i })).toBeVisible();
  });

  test('demo operator cannot access full admin', async ({ page }) => {
    await page.goto('/admin/users?lang=en');
    await expect(page).toHaveURL(/\/admin\/voices/);
  });

  test('demo operator cannot access admin agent', async ({ page }) => {
    await page.goto('/admin/agent?lang=en');
    await expect(page).toHaveURL(/\/admin\/voices/);
  });

  test('conversations list is scoped to Demo only', async ({ page }) => {
    await openDemoConsole(page, DEMO_OPERATOR.conversation);
    const panel = await openDemoSidebar(page);
    await expect(panel.getByText(/cursor\s*\/\s*zaza\s*\/\s*Demo/i)).toBeVisible();
    await expect(panel.getByText(/\/\s*Ivonne/i)).toHaveCount(0);
  });

  test('Ivonne guest login is scoped to Ivonne conversation', async ({ page }) => {
    const invite = await fetchIvonneInvite(page.request);
    await signInDemo(page, { email: invite.email, password: invite.password });
    await expect(page).toHaveURL(/\/console/);
    await page.goto(`/console/cursor/zaza/${invite.conversation}?lang=en`);
    await expect(page.getByText(/cursor\s*\/\s*zaza\s*\/\s*Ivonne/i).first()).toBeVisible();
    const panel = await openDemoSidebar(page);
    await expect(panel.getByText(/cursor\s*\/\s*zaza\s*\/\s*Ivonne/i)).toBeVisible();
    await expect(panel.getByText(/\/\s*Demo/i)).toHaveCount(0);
  });
});
