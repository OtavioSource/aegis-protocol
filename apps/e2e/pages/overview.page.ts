import { type Locator, type Page } from '@playwright/test';

export class OverviewPage {
  readonly heading: Locator;
  readonly usdcCard: Locator;
  readonly xlmCard: Locator;
  readonly pendingApprovalsCard: Locator;
  readonly spendRequestsCard: Locator;
  readonly vendorsCard: Locator;
  readonly agentsCard: Locator;
  readonly recentSpendSection: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Overview', level: 1 });
    this.usdcCard = page.getByText('USDC').first();
    this.xlmCard = page.getByText('XLM').first();
    this.pendingApprovalsCard = page.getByText('Pending approvals', { exact: true });
    this.spendRequestsCard = page.getByText('Spend requests', { exact: true });
    this.vendorsCard = page.locator('a[href="/vendors"]').filter({ has: page.locator('[class*="text-slate-500"]') });
    this.agentsCard = page.locator('a[href="/agents"]').filter({ has: page.locator('[class*="text-slate-500"]') });
    this.recentSpendSection = page.getByRole('heading', { name: 'Recent spend requests', level: 2 });
  }

  async goto() {
    await this.page.goto('/');
  }
}
