import { expect, test } from '@playwright/test';

import { AuditPage } from '../pages/audit.page.js';

test.describe('Audit', () => {
  test('page heading and description are visible', async ({ page }) => {
    const audit = new AuditPage(page);
    await audit.goto();

    await expect(audit.heading).toBeVisible();
    await expect(page.getByText(/immutable trail of decisions/i)).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/audit-page.png', fullPage: true });
  });

  test('shows audit table or empty state', async ({ page }) => {
    const audit = new AuditPage(page);
    await audit.goto();

    const hasTable = await audit.table.isVisible().catch(() => false);
    const hasEmpty = await audit.emptyState.isVisible().catch(() => false);

    expect(hasTable || hasEmpty).toBe(true);
    await page.screenshot({ path: 'evidence/screenshots/audit-state.png', fullPage: true });
  });

  test('audit table has Date, Event, Actor columns when events exist', async ({ page }) => {
    const audit = new AuditPage(page);
    await audit.goto();

    const hasTable = await audit.table.isVisible().catch(() => false);
    if (!hasTable) {
      test.skip();
      return;
    }

    await expect(audit.table.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(audit.table.getByRole('columnheader', { name: 'Event' })).toBeVisible();
    await expect(audit.table.getByRole('columnheader', { name: 'Actor' })).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/audit-table-columns.png', fullPage: true });
  });
});
