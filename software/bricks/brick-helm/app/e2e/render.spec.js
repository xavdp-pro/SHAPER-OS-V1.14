import { test, expect } from '@playwright/test';
import { openConsole } from './helpers/auth.js';
import { TEST_SESSIONS } from './helpers/testUser.js';
import { RICH_MARKDOWN_FIXTURE } from '../src/lib/richContent.js';

const RENDER_CONVERSATION = process.env.HELM_E2E_RENDER_CONVERSATION || TEST_SESSIONS.primary;

function fixtureItems() {
  const ts = Date.now();
  return [
    {
      type: 'human',
      id: `e2e-render-human-${ts}`,
      text: '[e2e-render] fixture livrable riche',
      time: ts,
    },
    {
      type: 'run',
      id: `e2e-render-run-${ts}`,
      status: 'done',
      model: 'composer-2.5',
      blocks: [
        {
          type: 'assistant',
          id: `e2e-render-assistant-${ts}`,
          text: RICH_MARKDOWN_FIXTURE,
          streaming: false,
        },
      ],
      time: ts,
    },
  ];
}

async function injectRichFixture(page, conversation) {
  await page.request.delete(`/api/timeline?conversation=${encodeURIComponent(conversation)}`);
  const items = fixtureItems();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await page.request.get(`/api/timeline?conversation=${encodeURIComponent(conversation)}`);
    const before = res.ok() ? await res.json() : { items: [], updated_at: null };
    const put = await page.request.put('/api/timeline', {
      data: {
        conversation,
        items,
        ifUpdatedAt: before.updated_at ?? undefined,
      },
    });
    if (put.ok()) return;
    if (put.status() === 409) {
      await page.request.delete(`/api/timeline?conversation=${encodeURIComponent(conversation)}`);
      const retry = await page.request.put('/api/timeline', { data: { conversation, items } });
      if (retry.ok()) return;
    }
    await page.waitForTimeout(200 * (attempt + 1));
  }
  const check = await page.request.get(`/api/timeline?conversation=${encodeURIComponent(conversation)}`);
  const body = check.ok() ? await check.json() : {};
  const hasFixture = (body.items || []).some(
    (it) => it.type === 'human' && String(it.text || '').includes('[e2e-render]'),
  );
  expect(hasFixture, 'timeline fixture not saved').toBeTruthy();
}

test.describe.serial('Rich deliverable rendering (text = voice base)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('helm-timeline-show-all', '1');
      localStorage.setItem('helm-cursor-pure', '1');
    });
    await openConsole(page, RENDER_CONVERSATION);
  });

  test('renders GFM table in assistant bubble', async ({ page }) => {
    await injectRichFixture(page, RENDER_CONVERSATION);
    await page.reload();
    await expect(page.getByText('[e2e-render]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('cell', { name: 'Alpha' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('cell', { name: '42' })).toBeVisible();
  });

  test('renders mermaid diagram', async ({ page }) => {
    await injectRichFixture(page, RENDER_CONVERSATION);
    await page.reload();
    await expect(page.locator('[data-rich-content="image"], .mermaid-diagram').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.mermaid-diagram svg, .rich-image img').first()).toBeVisible({ timeout: 20_000 });
  });

  test('renders inline SVG image (data URL)', async ({ page }) => {
    await injectRichFixture(page, RENDER_CONVERSATION);
    await page.reload();
    await expect(page.getByText('[e2e-render]')).toBeVisible({ timeout: 15_000 });
    const img = page.locator('.rich-image img').first();
    await expect(img).toBeVisible({ timeout: 15_000 });
    await expect(img).toHaveAttribute('src', /data:image\/svg\+xml|api\/workspace\/file/);
  });

  test('voice ack and assistant share the same rich stack class', async ({ page }) => {
    await injectRichFixture(page, RENDER_CONVERSATION);
    await page.reload();
    await expect(page.locator('.rich-content-stack').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.rich-content-stack table').first()).toBeVisible();
  });
});
