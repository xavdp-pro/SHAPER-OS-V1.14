import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(root, 'e2e', '.env') });

if (!String(process.env.HELM_E2E_JWT_SECRET || '').trim()) {
  try {
    const { config } = await import('./server/config.js');
    if (config.jwtSecret) process.env.HELM_E2E_JWT_SECRET = config.jwtSecret;
  } catch {
    /* not on app server */
  }
}

if (!process.env.HELM_E2E_USER_ID) process.env.HELM_E2E_USER_ID = '3';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:7923';
const authFile = 'e2e/.auth/user.json';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 1400, height: 900 },
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'public',
      testMatch: /login\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'authenticated',
      testMatch: /(console|admin|flows|render|chat)\.spec\.js/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
    },
    {
      name: 'agent',
      testMatch: /agent\.spec\.js/,
      dependencies: ['setup'],
      timeout: Number(process.env.HELM_E2E_AGENT_TIMEOUT_MS || 270_000),
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
    },
    {
      name: 'demo',
      testMatch: /demo\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        // Variable dédiée : le projet demo cible toujours le déploiement demo,
        // sans hériter du PLAYWRIGHT_BASE_URL (helm2 production) des autres projets.
        baseURL: process.env.PLAYWRIGHT_DEMO_BASE_URL || 'http://127.0.0.1:7923',
      },
    },
  ],
});
