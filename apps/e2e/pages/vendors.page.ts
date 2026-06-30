import { type Locator, type Page } from '@playwright/test';

export class VendorsPage {
  readonly heading: Locator;
  readonly newVendorSection: Locator;
  readonly nameInput: Locator;
  readonly assetSelect: Locator;
  readonly descriptionInput: Locator;
  readonly createButton: Locator;
  readonly table: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Vendors', level: 1 });
    this.newVendorSection = page.getByRole('heading', { name: 'New vendor', level: 2 });
    this.nameInput = page.getByLabel('Name');
    this.assetSelect = page.getByLabel('Preferred asset');
    this.descriptionInput = page.getByLabel(/description/i);
    this.createButton = page.getByRole('button', { name: 'Create vendor' });
    this.table = page.getByRole('table');
  }

  async goto() {
    await this.page.goto('/vendors');
  }

  async createVendor(name: string, asset = 'USDC') {
    await this.nameInput.fill(name);
    await this.assetSelect.selectOption(asset);
    await this.createButton.click();
  }

  vendorRow(name: string) {
    return this.page.getByRole('row').filter({ hasText: name });
  }
}
