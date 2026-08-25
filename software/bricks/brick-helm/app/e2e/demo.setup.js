import { test as setup } from '@playwright/test';
import { signInDemoOperator } from './helpers/demo.js';

const authFile = 'e2e/.auth/demo-operator.json';

setup('authenticate demo operator', async ({ page }) => {
  await signInDemoOperator(page);
  await page.context().storageState({ path: authFile });
});
