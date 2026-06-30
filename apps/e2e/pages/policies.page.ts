import { type Locator, type Page } from '@playwright/test';

export class PoliciesPage {
  readonly heading: Locator;
  readonly newPolicySection: Locator;
  readonly nameInput: Locator;
  readonly maxPerTxInput: Locator;
  readonly monthlyBudgetInput: Locator;
  readonly approvalThresholdInput: Locator;
  readonly actionTypesInput: Locator;
  readonly createButton: Locator;
  readonly table: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Policies', level: 1 });
    this.newPolicySection = page.getByRole('heading', { name: 'New policy', level: 2 });
    this.nameInput = page.getByLabel('Name');
    this.maxPerTxInput = page.getByLabel(/max per transaction/i);
    this.monthlyBudgetInput = page.getByLabel(/monthly budget/i);
    this.approvalThresholdInput = page.getByLabel(/approval threshold/i);
    this.actionTypesInput = page.getByLabel(/allowed action types/i);
    this.createButton = page.getByRole('button', { name: 'Create policy' });
    this.table = page.getByRole('table');
  }

  async goto() {
    await this.page.goto('/policies');
  }

  async createPolicy(name: string, options?: { maxPerTx?: string; monthlyBudget?: string }) {
    await this.nameInput.fill(name);
    if (options?.maxPerTx) await this.maxPerTxInput.fill(options.maxPerTx);
    if (options?.monthlyBudget) await this.monthlyBudgetInput.fill(options.monthlyBudget);
    await this.createButton.click();
  }

  policyRow(name: string) {
    return this.page.getByRole('row').filter({ hasText: name });
  }

  toggleButton(name: string) {
    return this.policyRow(name).getByRole('button').first();
  }
}
