import { type Locator, type Page } from '@playwright/test';

export class ApprovalsPage {
  readonly heading: Locator;
  readonly emptyState: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Approvals', level: 1 });
    this.emptyState = page.getByText('No pending approvals.');
  }

  async goto() {
    await this.page.goto('/approvals');
  }

  approveButton() {
    return this.page.getByRole('button', { name: /approve and execute/i }).first();
  }

  rejectButton() {
    return this.page.getByRole('button', { name: /reject/i }).first();
  }

  pendingCards() {
    return this.page.locator('[class*="space-y-4"] > div');
  }
}
