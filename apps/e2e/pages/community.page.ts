import { type Locator, type Page } from '@playwright/test';

export class CommunityPage {
  readonly heading: Locator;
  readonly actionsTab: Locator;
  readonly leaderboardTab: Locator;
  readonly rewardsTab: Locator;
  readonly pointsSummary: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Community', level: 1 });
    this.actionsTab = page.getByRole('button', { name: 'Actions' });
    this.leaderboardTab = page.getByRole('button', { name: 'Leaderboard' });
    this.rewardsTab = page.getByRole('button', { name: 'Rewards' });
    this.pointsSummary = page.getByText('Your total points');
  }

  async goto() {
    await this.page.goto('/community');
  }
}
