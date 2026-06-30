import { type Locator, type Page } from '@playwright/test';

export class SpendRequestsPage {
  readonly heading: Locator;
  readonly newSpendSection: Locator;
  readonly agentSelect: Locator;
  readonly vendorSelect: Locator;
  readonly actionTypeInput: Locator;
  readonly amountInput: Locator;
  readonly assetInput: Locator;
  readonly createButton: Locator;
  readonly table: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Spend Requests', level: 1 });
    this.newSpendSection = page.getByRole('heading', { name: 'New spend request', level: 2 });
    this.agentSelect = page.getByLabel('Agent');
    this.vendorSelect = page.getByLabel('Vendor');
    this.actionTypeInput = page.locator('input[name="actionType"]');
    this.amountInput = page.locator('input[name="amount"]');
    this.assetInput = page.getByLabel('Asset');
    this.createButton = page.getByRole('button', { name: 'Create' });
    this.table = page.getByRole('table');
  }

  async goto() {
    await this.page.goto('/spend-requests');
  }
}
