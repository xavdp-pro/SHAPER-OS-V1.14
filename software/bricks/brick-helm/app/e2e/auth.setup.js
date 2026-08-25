import { test as setup } from '@playwright/test';
import { hasE2eAuth, hasE2eTokenAuth } from './helpers/testUser.js';
import { signIn, ensureComposer25NoFast } from './helpers/auth.js';
import { applyE2eSession } from './helpers/e2eToken.js';
import { applyE2eBrowserPrefs, installE2eBrowserPrefs } from './helpers/browserPrefs.js';

const authFile = 'e2e/.auth/user.json';

setup('authenticate', async ({ page, baseURL }) => {
  setup.skip(!hasE2eAuth(), 'Set HELM_E2E_JWT_SECRET or HELM_E2E_PASSWORD in e2e/.env');

  await installE2eBrowserPrefs(page.context());

  if (hasE2eTokenAuth()) {
    await applyE2eSession(page, {
      baseURL,
      targetPath: '/console/gbs-h1/zaza/Xavier?lang=fr',
    });
    await ensureComposer25NoFast(page);
  } else {
    await signIn(page);
  }

  await applyE2eBrowserPrefs(page);

  await page.context().storageState({ path: authFile });
});
