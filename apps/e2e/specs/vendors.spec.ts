import { expect, test } from '@playwright/test';

import { VendorsPage } from '../pages/vendors.page.js';

const VENDOR_NAME = `E2E Vendor ${Date.now()}`;

test.describe('Vendors', () => {
  test('page heading and form are visible', async ({ page }) => {
    const vendors = new VendorsPage(page);
    await vendors.goto();

    await expect(vendors.heading).toBeVisible();
    await expect(vendors.newVendorSection).toBeVisible();
    await expect(vendors.nameInput).toBeVisible();
    await expect(vendors.assetSelect).toBeVisible();
    await expect(vendors.createButton).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/vendors-page.png', fullPage: true });
  });

  test('seed vendor "Anthropic" is listed', async ({ page }) => {
    const vendors = new VendorsPage(page);
    await vendors.goto();

    await expect(vendors.table).toBeVisible();
    await expect(vendors.vendorRow('Anthropic')).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/vendors-seed-vendor.png', fullPage: true });
  });

  test('vendor table shows Asset, Status, Wallet, Action columns', async ({ page }) => {
    const vendors = new VendorsPage(page);
    await vendors.goto();

    await expect(vendors.table.getByRole('columnheader', { name: 'Asset' })).toBeVisible();
    await expect(vendors.table.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(vendors.table.getByRole('columnheader', { name: 'Wallet' })).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/vendors-table-columns.png', fullPage: true });
  });

  test('creates a new vendor and it appears in the table', async ({ page }) => {
    const vendors = new VendorsPage(page);
    await vendors.goto();

    await vendors.createVendor(VENDOR_NAME, 'USDC');

    await expect(page).toHaveURL('/vendors');
    await expect(vendors.vendorRow(VENDOR_NAME)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'evidence/screenshots/vendors-after-create.png', fullPage: true });
  });

  test('preferred asset select offers USDC, EURC, XLM options', async ({ page }) => {
    const vendors = new VendorsPage(page);
    await vendors.goto();

    const options = await vendors.assetSelect.locator('option').allTextContents();
    expect(options).toContain('USDC');
    expect(options).toContain('EURC');
    expect(options).toContain('XLM');
  });
});
