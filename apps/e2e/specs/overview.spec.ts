import { expect, test } from '@playwright/test';

import { OverviewPage } from '../pages/overview.page.js';

test.describe('Overview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page heading renders', async ({ page }) => {
    const overview = new OverviewPage(page);
    await expect(overview.heading).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/overview-heading.png', fullPage: true });
  });

  test('treasury balance section is visible with USDC and XLM cards', async ({ page }) => {
    const overview = new OverviewPage(page);
    await expect(page.getByText('Treasury balances')).toBeVisible();
    await expect(overview.usdcCard).toBeVisible();
    await expect(overview.xlmCard).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/overview-treasury-balances.png', fullPage: true });
  });

  test('activity metric cards are visible', async ({ page }) => {
    const overview = new OverviewPage(page);
    await expect(page.getByText('Activity')).toBeVisible();
    await expect(overview.pendingApprovalsCard).toBeVisible();
    await expect(overview.spendRequestsCard).toBeVisible();
    await expect(overview.vendorsCard).toBeVisible();
    await expect(overview.agentsCard).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/overview-activity-metrics.png', fullPage: true });
  });

  test('"Recent spend requests" section is present', async ({ page }) => {
    const overview = new OverviewPage(page);
    await expect(overview.recentSpendSection).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/overview-recent-spend.png', fullPage: true });
  });

  test('full overview page screenshot', async ({ page }) => {
    await page.screenshot({ path: 'evidence/screenshots/overview-full.png', fullPage: true });
  });
});
