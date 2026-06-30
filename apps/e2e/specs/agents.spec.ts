import { expect, test } from '@playwright/test';

import { AgentsPage } from '../pages/agents.page.js';

const AGENT_NAME = `E2E Agent ${Date.now()}`;

test.describe('Agents', () => {
  test('page heading and form are visible', async ({ page }) => {
    const agents = new AgentsPage(page);
    await agents.goto();

    await expect(agents.heading).toBeVisible();
    await expect(agents.newAgentSection).toBeVisible();
    await expect(agents.nameInput).toBeVisible();
    await expect(agents.policySelect).toBeVisible();
    await expect(agents.createButton).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/agents-page.png', fullPage: true });
  });

  test('seed agent "Customer Success Bot" is listed', async ({ page }) => {
    const agents = new AgentsPage(page);
    await agents.goto();

    await expect(agents.table).toBeVisible();
    await expect(agents.agentRow('Customer Success Bot')).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/agents-seed-agent.png', fullPage: true });
  });

  test('agent table shows API key, Policy, Status, Created columns', async ({ page }) => {
    const agents = new AgentsPage(page);
    await agents.goto();

    await expect(agents.table.getByRole('columnheader', { name: 'API key' })).toBeVisible();
    await expect(agents.table.getByRole('columnheader', { name: 'Policy' })).toBeVisible();
    await expect(agents.table.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(agents.table.getByRole('columnheader', { name: 'Created' })).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/agents-table-columns.png', fullPage: true });
  });

  test('creates a new agent and it appears in the table', async ({ page }) => {
    const agents = new AgentsPage(page);
    await agents.goto();

    await agents.createAgent(AGENT_NAME);

    await expect(page).toHaveURL('/agents');
    await expect(agents.agentLink(AGENT_NAME)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'evidence/screenshots/agents-after-create.png', fullPage: true });
  });

  test('clicking agent name navigates to agent detail page', async ({ page }) => {
    const agents = new AgentsPage(page);
    await agents.goto();

    await agents.agentLink('Customer Success Bot').click();
    await expect(page).toHaveURL(/\/agents\/.+/);
    await expect(page.getByRole('heading', { name: 'Customer Success Bot', level: 1 })).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/agents-detail-page.png', fullPage: true });
  });
});
