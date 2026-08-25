import jwt from 'jsonwebtoken';
import { expect } from '@playwright/test';
import { TEST_USER, TEST_BASE_URL } from './testUser.js';

const COOKIE_NAME = 'ca_token';

/** JWT minting for Playwright — requires HELM_E2E_JWT_SECRET in e2e/.env (same as server JWT_SECRET). */
export function hasE2eTokenAuth() {
  return Boolean(String(process.env.HELM_E2E_JWT_SECRET || '').trim());
}

export function mintE2eToken(user = TEST_USER) {
  const secret = String(process.env.HELM_E2E_JWT_SECRET || '').trim();
  if (!secret) return null;
  const sub = Number(user.id || process.env.HELM_E2E_USER_ID || 0);
  if (!sub) return null;
  return jwt.sign(
    {
      sub,
      email: user.email,
      name: user.displayName || user.name || '',
      role: user.role || 'operator',
    },
    secret,
    { expiresIn: '7d' },
  );
}

function resolveOrigin(baseURL) {
  return String(baseURL || TEST_BASE_URL || 'http://127.0.0.1:7923').replace(/\/$/, '');
}

/**
 * Inject ca_token cookie and open target page — bypasses login form.
 * @param {import('@playwright/test').Page} page
 * @param {{ baseURL?: string, targetPath?: string }} [opts]
 */
export async function applyE2eSession(page, { baseURL, targetPath = '/console?lang=fr' } = {}) {
  const token = mintE2eToken();
  if (!token) {
    throw new Error('HELM_E2E_JWT_SECRET et HELM_E2E_USER_ID requis dans e2e/.env');
  }

  const origin = resolveOrigin(baseURL);
  const { hostname, protocol } = new URL(origin);
  await page.context().addCookies([{
    name: COOKIE_NAME,
    value: token,
    domain: hostname,
    path: '/',
    httpOnly: true,
    secure: protocol === 'https:',
    sameSite: 'Lax',
  }]);

  const path = String(targetPath || '/console');
  const url = path.startsWith('http') ? path : `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  await page.goto(url);

  const me = await page.request.get('/api/auth/me');
  expect(me.ok()).toBeTruthy();
  const body = await me.json();
  expect(body.ok).toBe(true);
  expect(body.user?.email).toBe(TEST_USER.email);
  return body.user;
}

/** Navigate directly to a console session when token auth is configured. */
export async function gotoAuthenticatedConsole(page, sessionPath, { locale = 'fr', baseURL } = {}) {
  const path = `/console/${sessionPath}?lang=${locale}`;
  await applyE2eSession(page, { baseURL, targetPath: path });
}
