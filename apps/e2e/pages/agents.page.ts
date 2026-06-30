import { type Locator, type Page } from '@playwright/test';

export class AgentsPage {
  readonly heading: Locator;
  readonly newAgentSection: Locator;
  readonly nameInput: Locator;
  readonly policySelect: Locator;
  readonly descriptionInput: Locator;
  readonly createButton: Locator;
  readonly table: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Agents', level: 1 });
    this.newAgentSection = page.getByRole('heading', { name: 'New agent', level: 2 });
    this.nameInput = page.getByLabel('Name').first();
    this.policySelect = page.getByLabel('Active policy');
    this.descriptionInput = page.getByLabel(/description/i);
    this.createButton = page.getByRole('button', { name: 'Create agent' });
    this.table = page.getByRole('table');
  }

  async goto() {
    await this.page.goto('/agents');
  }

  async createAgent(name: string, policyIndex = 1) {
    await this.nameInput.fill(name);
    await this.policySelect.selectOption({ index: policyIndex });
    await this.createButton.click();
  }

  agentLink(name: string) {
    return this.page.getByRole('link', { name });
  }

  agentRow(name: string) {
    return this.page.getByRole('row').filter({ hasText: name });
  }
}
