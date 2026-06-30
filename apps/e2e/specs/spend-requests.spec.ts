import { expect, test } from '@playwright/test';

import { SpendRequestsPage } from '../pages/spend-requests.page.js';

test.describe('Spend Requests', () => {
  test('page heading and new spend form are visible', async ({ page }) => {
    const spendRequests = new SpendRequestsPage(page);
    await spendRequests.goto();

    await expect(spendRequests.heading).toBeVisible();
    await expect(spendRequests.newSpendSection).toBeVisible();
    await expect(spendRequests.agentSelect).toBeVisible();
    await expect(spendRequests.vendorSelect).toBeVisible();
    await expect(spendRequests.actionTypeInput).toBeVisible();
    await expect(spendRequests.amountInput).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/spend-requests-page.png', fullPage: true });
  });

  test('shows table or empty state', async ({ page }) => {
    const spendRequests = new SpendRequestsPage(page);
    await spendRequests.goto();

    const hasTable = await spendRequests.table.isVisible().catch(() => false);
    const hasEmpty = await page.getByText('No spend requests yet.').isVisible().catch(() => false);

    expect(hasTable || hasEmpty).toBe(true);
    await page.screenshot({ path: 'evidence/screenshots/spend-requests-list.png', fullPage: true });
  });

  test('table headers are correct when data is present', async ({ page }) => {
    const spendRequests = new SpendRequestsPage(page);
    await spendRequests.goto();

    const hasTable = await spendRequests.table.isVisible().catch(() => false);
    if (!hasTable) {
      test.skip();
      return;
    }

    await expect(spendRequests.table.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(spendRequests.table.getByRole('columnheader', { name: 'Action' })).toBeVisible();
    await expect(spendRequests.table.getByRole('columnheader', { name: 'Amount' })).toBeVisible();
    await expect(spendRequests.table.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/spend-requests-table-columns.png', fullPage: true });
  });

  test('asset input defaults to USDC', async ({ page }) => {
    const spendRequests = new SpendRequestsPage(page);
    await spendRequests.goto();
    await expect(spendRequests.assetInput).toHaveValue('USDC');
  });
});
