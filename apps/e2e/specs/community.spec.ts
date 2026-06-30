import { expect, test } from '@playwright/test';

import { CommunityPage } from '../pages/community.page.js';

test.describe('Community', () => {
  test('page heading and points summary are visible', async ({ page }) => {
    const community = new CommunityPage(page);
    await community.goto();

    await expect(community.heading).toBeVisible();
    await expect(community.pointsSummary).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/community-page.png', fullPage: true });
  });

  test('three tabs render: Actions, Leaderboard, Rewards', async ({ page }) => {
    const community = new CommunityPage(page);
    await community.goto();

    await expect(community.actionsTab).toBeVisible();
    await expect(community.leaderboardTab).toBeVisible();
    await expect(community.rewardsTab).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/community-tabs.png', fullPage: true });
  });

  test('Actions tab is active by default and shows action cards', async ({ page }) => {
    const community = new CommunityPage(page);
    await community.goto();

    await expect(page.getByText('Join the waitlist', { exact: true })).toBeVisible();
    await expect(page.getByText('Invite builders', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/community-actions-tab.png', fullPage: true });
  });

  test('Leaderboard tab shows leaderboard entries', async ({ page }) => {
    const community = new CommunityPage(page);
    await community.goto();

    await community.leaderboardTab.click();
    await expect(page.getByText('Community leaderboard')).toBeVisible();
    await expect(page.getByText('Early Builder')).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/community-leaderboard-tab.png', fullPage: true });
  });

  test('Rewards tab shows monthly and semiannual rewards', async ({ page }) => {
    const community = new CommunityPage(page);
    await community.goto();

    await community.rewardsTab.click();
    await expect(page.getByText('Monthly reward')).toBeVisible();
    await expect(page.getByText('Semiannual rewards')).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/community-rewards-tab.png', fullPage: true });
  });
});
