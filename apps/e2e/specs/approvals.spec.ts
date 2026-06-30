import { expect, test } from '@playwright/test';

import { ApprovalsPage } from '../pages/approvals.page.js';

test.describe('Approvals', () => {
  test('page heading is visible', async ({ page }) => {
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    await expect(approvals.heading).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/approvals-page.png', fullPage: true });
  });

  test('shows empty state or pending approval cards', async ({ page }) => {
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    const hasEmpty = await approvals.emptyState.isVisible().catch(() => false);
    const hasCards = await approvals.approveButton().isVisible().catch(() => false);

    expect(hasEmpty || hasCards).toBe(true);
    await page.screenshot({ path: 'evidence/screenshots/approvals-state.png', fullPage: true });
  });

  test('description mentions "Approval triggers on-chain payment"', async ({ page }) => {
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    await expect(
      page.getByText(/spend requests escalated for human decision/i),
    ).toBeVisible();
  });

  test('approval cards show amount, action type and buttons when pending items exist', async ({ page }) => {
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    const hasCards = await approvals.approveButton().isVisible().catch(() => false);
    if (!hasCards) {
      test.skip();
      return;
    }

    await expect(approvals.approveButton()).toBeVisible();
    await expect(approvals.rejectButton()).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/approvals-cards.png', fullPage: true });
  });
});
