import { expect, test } from '@playwright/test';

import { PoliciesPage } from '../pages/policies.page.js';

const POLICY_NAME = `E2E Policy ${Date.now()}`;

test.describe('Policies', () => {
  test('page heading and form are visible', async ({ page }) => {
    const policies = new PoliciesPage(page);
    await policies.goto();

    await expect(policies.heading).toBeVisible();
    await expect(policies.newPolicySection).toBeVisible();
    await expect(policies.nameInput).toBeVisible();
    await expect(policies.createButton).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/policies-page.png', fullPage: true });
  });

  test('existing seed policy "Default Conservative Policy" is listed', async ({ page }) => {
    const policies = new PoliciesPage(page);
    await policies.goto();

    await expect(policies.table).toBeVisible();
    await expect(policies.policyRow('Default Conservative Policy')).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/policies-seed-policy.png', fullPage: true });
  });

  test('creates a new policy and it appears in the table', async ({ page }) => {
    const policies = new PoliciesPage(page);
    await policies.goto();

    await policies.createPolicy(POLICY_NAME, {
      maxPerTx: '200.00',
      monthlyBudget: '10000.00',
    });

    await expect(page).toHaveURL('/policies');
    await expect(policies.policyRow(POLICY_NAME)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'evidence/screenshots/policies-after-create.png', fullPage: true });
  });

  test('policy table shows Version, Max/tx, Monthly budget columns', async ({ page }) => {
    const policies = new PoliciesPage(page);
    await policies.goto();

    await expect(policies.table.getByRole('columnheader', { name: 'Version' })).toBeVisible();
    await expect(policies.table.getByRole('columnheader', { name: 'Max/tx' })).toBeVisible();
    await expect(policies.table.getByRole('columnheader', { name: 'Monthly budget' })).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/policies-table-columns.png', fullPage: true });
  });
});
