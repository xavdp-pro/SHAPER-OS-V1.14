import { expect } from '@playwright/test';
import { TEST_USER, hasTestCredentials, hasE2eTokenAuth } from './testUser.js';
import { applyE2eSession } from './e2eToken.js';
import { applyE2eBrowserPrefs, installE2eBrowserPrefs } from './browserPrefs.js';

export const email = TEST_USER.email;
export const password = TEST_USER.password;
export const hasE2eCredentials = hasTestCredentials;

/** E2E default: Cursor Composer 2.5 — Fast OFF. */
export const E2E_CURSOR_MODEL = {
  agentPlugin: 'cursor',
  modelFamily: 'composer-2.5',
  modelEffort: 'full',
  modelFast: false,
};

/** Persist Composer 2.5 (no fast) for the authenticated user. */
export async function ensureComposer25NoFast(page) {
  const res = await page.request.patch('/api/settings', {
    data: E2E_CURSOR_MODEL,
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.modelFamily).toBe('composer-2.5');
  expect(body.modelFast).toBe(false);
  expect(body.composerFast).toBe(false);
  expect(String(body.composerModel || '')).toBe('composer-2.5');
  expect(String(body.modelLabel || '')).not.toMatch(/fast/i);
}

export async function signIn(page, { locale = 'fr', targetPath } = {}) {
  if (hasE2eTokenAuth()) {
    await applyE2eSession(page, {
      targetPath: targetPath || `/console?lang=${locale}`,
    });
    await ensureComposer25NoFast(page);
    return;
  }

  await page.goto(`/?lang=${locale}`);
  const emailField = page.getByLabel(/Email ou identifiant|Email or username|Email o identificador/i)
    .or(page.getByPlaceholder(/you@domain|vous@domaine|tu@dominio/i));
  const passwordField = page.getByLabel(/Mot de passe|Password|Contraseña/i)
    .or(page.getByPlaceholder('••••••••'));
  await emailField.fill(email);
  await passwordField.fill(password);
  await page.getByRole('button', { name: /S'authentifier|Sign in|Iniciar sesión/i }).click();
  await page.waitForURL(/\/(console|admin)/, { timeout: 25_000 });
  await ensureComposer25NoFast(page);
}

export async function openConsole(page, sessionPath = 'gbs-h1/zaza/Xavier') {
  await installE2eBrowserPrefs(page.context());

  const targetPath = `/console/${sessionPath}?lang=fr`;
  if (hasE2eTokenAuth()) {
    await applyE2eSession(page, { targetPath });
  } else {
    await ensureComposer25NoFast(page);
    await page.goto(targetPath);
  }

  await applyE2eBrowserPrefs(page);
  await ensureComposer25NoFast(page);

  await expect(page.getByRole('button', { name: /Options/i })).toBeVisible({ timeout: 20_000 });
  const input = page.getByPlaceholder(/Tapez votre message|Type your message/i);
  await expect(input).toBeVisible({ timeout: 20_000 });

  const settings = await page.request.get('/api/settings');
  expect(settings.ok()).toBeTruthy();
  const cfg = await settings.json();
  expect(cfg.modelFamily).toBe('composer-2.5');
  expect(cfg.modelFast).toBe(false);
  expect(cfg.agentPlugin).toBe('cursor');

  await expect(page.locator('header')).toContainText('Composer 2.5');
  await expect(page.locator('header')).not.toContainText('Composer 2.5 Fast');
}

/** Close help tour / presentation overlays that intercept header clicks. */
export async function dismissBlockingOverlays(page) {
  const helpClose = page.getByRole('button', { name: /Fermer|Close|Cerrar/i });
  if (await helpClose.isVisible().catch(() => false)) {
    await helpClose.first().click();
    await expect(helpClose.first()).toBeHidden({ timeout: 5_000 }).catch(() => {});
  }

  const stopPresentation = page.getByRole('button', {
    name: /Arrêter la présentation|Stop presentation|Detener la presentación/i,
  });
  if (await stopPresentation.isVisible().catch(() => false)) {
    await stopPresentation.click();
    await expect(stopPresentation).toBeHidden({ timeout: 15_000 }).catch(() => {});
  }

  const nudgeDismiss = page.getByRole('button', {
    name: /Fermer l'astuce|Dismiss tip|Cerrar el consejo/i,
  });
  if (await nudgeDismiss.isVisible().catch(() => false)) {
    await nudgeDismiss.click();
  }
}

export async function openOptionsMenu(page) {
  await dismissBlockingOverlays(page);

  const optionsBtn = page.locator('[data-help-target="help-options"]');
  await expect(optionsBtn).toBeVisible({ timeout: 15_000 });

  const dialog = page.locator('[role="dialog"][data-help-scroll="options-menu"]');
  if (!(await dialog.isVisible().catch(() => false))) {
    await optionsBtn.click({ timeout: 15_000 });
  }

  await expect(dialog).toBeVisible({ timeout: 10_000 });
}

/** Ensure the conversations sidebar is expanded (desktop default may be collapsed). */
export async function openSidebar(page) {
  const panel = sidebar(page);
  const history = panel.getByText(/Historique|History|Historial/i);
  for (let i = 0; i < 2; i += 1) {
    if (await history.isVisible()) return;
    await page.getByRole('button', { name: /Conversations/i }).click();
    await page.waitForTimeout(200);
  }
  await expect(history).toBeVisible({ timeout: 10_000 });
}

export function sidebar(page) {
  return page.locator('aside').filter({ has: page.getByText(/Historique|History|Historial/i) }).first();
}
