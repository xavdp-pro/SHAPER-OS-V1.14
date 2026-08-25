import { test, expect } from '@playwright/test';
import { openConsole } from './helpers/auth.js';
import { isAgentTestEnabled, TEST_SESSIONS } from './helpers/testUser.js';
import {
  buildPongPrompt,
  waitForAgentPong,
  waitForTimelineIdle,
  replyContainsPong,
} from './helpers/agent.js';

const AGENT_CONVERSATION = process.env.HELM_E2E_AGENT_CONVERSATION
  || TEST_SESSIONS.agent
  || 'gbs-h1/zaza/Interface';

test.describe.configure({ mode: 'serial' });

test.describe('Cursor agent (slow, optional)', () => {
  test.beforeEach(() => {
    test.skip(!isAgentTestEnabled(), 'Set HELM_E2E_AGENT=1 to run real agent e2e');
  });

  test('UI send → agent replies PONG', async ({ page }) => {
    test.setTimeout(Number(process.env.HELM_E2E_AGENT_TIMEOUT_MS || 240_000) + 30_000);

    const marker = `e2e-agent-${Date.now()}`;
    const prompt = buildPongPrompt(marker);

    await openConsole(page, AGENT_CONVERSATION);
    await waitForTimelineIdle(page, AGENT_CONVERSATION);

    const input = page.getByPlaceholder(/Tapez votre message|Type your message/i);
    const send = page.getByRole('button', { name: /Envoyer|Send/i });

    await input.fill(prompt);
    await expect(send).toBeEnabled();
    await send.click();

    await expect(input).toHaveValue('', { timeout: 10_000 });
    await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 });

    const replyText = await waitForAgentPong(page, {
      conversation: AGENT_CONVERSATION,
      marker,
    });

    expect(replyContainsPong(replyText)).toBe(true);
    await expect(page.getByText(/\bPONG\b/i).last()).toBeVisible({ timeout: 5_000 });
  });
});
