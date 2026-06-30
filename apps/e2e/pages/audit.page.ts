import { type Locator, type Page } from '@playwright/test';

export class AuditPage {
  readonly heading: Locator;
  readonly emptyState: Locator;
  readonly table: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Audit', level: 1 });
    this.emptyState = page.getByText('No audit events yet.');
    this.table = page.getByRole('table');
  }

  async goto() {
    await this.page.goto('/audit');
  }
}
