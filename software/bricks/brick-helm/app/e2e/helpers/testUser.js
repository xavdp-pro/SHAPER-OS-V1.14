import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const e2eDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(e2eDir, '.env') });

/**
 * Compte E2E KovZu (Xavier admin).
 * Secrets : e2e/.env (gitignored) ou variables HELM_E2E_*.
 */
export const TEST_USER = {
  id: Number(process.env.HELM_E2E_USER_ID || 3),
  email: process.env.HELM_E2E_EMAIL || 'xavier@xavdp.pro',
  password: process.env.HELM_E2E_PASSWORD || '',
  displayName: 'Xavier de Poorter',
  role: process.env.HELM_E2E_ROLE || 'admin',
};

export const TEST_SESSIONS = {
  primary: 'gbs-h1/zaza/Xavier',
  render: 'gbs-h1/zaza/__e2e-render',
  now2: 'acer/zaza/NOW2',
  now3: 'asus/zaza/NOW3',
  agent: 'gbs-h1/zaza/Interface',
};

export const TEST_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:7923';

export function hasTestCredentials() {
  return Boolean(String(TEST_USER.password || '').trim());
}

/** Preferred E2E auth: JWT cookie bypass (no login UI). */
export function hasE2eTokenAuth() {
  return Boolean(String(process.env.HELM_E2E_JWT_SECRET || '').trim()) && Boolean(TEST_USER.id);
}

export function hasE2eAuth() {
  return hasE2eTokenAuth() || hasTestCredentials();
}

/** Real Cursor agent e2e — slow, token-consuming. */
export function isAgentTestEnabled() {
  const flag = String(process.env.HELM_E2E_AGENT || '').toLowerCase();
  return hasTestCredentials() && ['1', 'true', 'yes', 'on'].includes(flag);
}

export function requireTestCredentials() {
  if (!hasE2eAuth()) {
    throw new Error(
      'Auth E2E manquante — renseigne HELM_E2E_JWT_SECRET (+ HELM_E2E_USER_ID) ou HELM_E2E_PASSWORD dans e2e/.env',
    );
  }
}
