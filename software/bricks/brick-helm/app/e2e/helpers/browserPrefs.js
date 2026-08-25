/** E2E browser prefs — applied before app JS on each navigation. */
export async function installE2eBrowserPrefs(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('helm-cursor-pure', '1');
    } catch {
      /* ignore */
    }
  });
}

export async function applyE2eBrowserPrefs(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem('helm-cursor-pure', '1');
    } catch {
      /* ignore */
    }
  });
}
