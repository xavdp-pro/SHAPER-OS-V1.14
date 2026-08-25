import { expect } from '@playwright/test';
import { DEMO_CREDENTIALS } from '../../src/lib/demoCredentials.js';

export const DEMO_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:7923';

export const DEMO_OPERATOR = {
  email: DEMO_CREDENTIALS.email,
  password: DEMO_CREDENTIALS.password,
  conversation: 'Demo',
};

export async function signInDemo(page, { email, password, locale = 'en' } = {}) {
  await page.goto(`/?lang=${locale}`);
  const emailField = page.getByLabel(/Email or username|Email ou identifiant/i)
    .or(page.getByPlaceholder(/you@domain|vous@domaine/i));
  const passwordField = page.getByLabel(/Password|Mot de passe/i)
    .or(page.getByPlaceholder('••••••••'));
  await emailField.fill(email);
  await passwordField.fill(password);
  await page.getByRole('button', { name: /Sign in|S'authentifier/i }).click();
  await page.waitForURL(/\/console/, { timeout: 25_000 });
}

export async function signInDemoOperator(page) {
  await signInDemo(page, DEMO_OPERATOR);
}

export async function fetchIvonneInvite(request) {
  const res = await request.get('/api/auth/demo-invite?user=ivonne');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  return body;
}

/** CLI node on agent-demo (cas0) — cursor bridge. */
export const DEMO_CLI_PREFIX = process.env.HELM_DEMO_CLI_PREFIX || 'cursor/zaza';

export async function openDemoSidebar(page) {
  const panel = page.locator('aside').filter({ has: page.getByText(/History|Historique/i) }).first();
  const history = panel.getByText(/History|Historique/i);
  for (let i = 0; i < 2; i += 1) {
    if (await history.isVisible()) return panel;
    await page.getByRole('button', { name: /Conversations/i }).click();
    await page.waitForTimeout(200);
  }
  await expect(history).toBeVisible({ timeout: 10_000 });
  return panel;
}

export async function openDemoConsole(page, sessionName = DEMO_OPERATOR.conversation) {
  await page.goto(`/console/${DEMO_CLI_PREFIX}/${sessionName}?lang=en`);
  await expect(page.getByRole('button', { name: /Options/i })).toBeVisible({ timeout: 20_000 });
}
