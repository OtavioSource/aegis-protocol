import { expect, test } from '@playwright/test';

import { NAV_LINKS, NavComponent } from '../pages/nav.component.js';

test.describe('Navigation', () => {
  test('sidebar shows all 9 navigation links', async ({ page }) => {
    await page.goto('/');
    const nav = new NavComponent(page);

    for (const { label } of NAV_LINKS) {
      await expect(nav.link(label)).toBeVisible();
    }
    await page.screenshot({ path: 'evidence/screenshots/nav-all-links.png', fullPage: true });
  });

  test('Overview link is active on the overview page', async ({ page }) => {
    await page.goto('/');
    const nav = new NavComponent(page);

    const active = nav.activeLink();
    await expect(active).toHaveText('Overview');
    await expect(active).toHaveAttribute('aria-current', 'page');
  });

  test('Policies link becomes active when navigating to /policies', async ({ page }) => {
    await page.goto('/');
    const nav = new NavComponent(page);

    await nav.link('Policies').click();
    await expect(page).toHaveURL('/policies');
    await expect(nav.activeLink()).toHaveText('Policies');
    await page.screenshot({ path: 'evidence/screenshots/nav-policies-active.png', fullPage: true });
  });

  test('Agents link becomes active when navigating to /agents', async ({ page }) => {
    await page.goto('/');
    const nav = new NavComponent(page);

    await nav.link('Agents').click();
    await expect(page).toHaveURL('/agents');
    await expect(nav.activeLink()).toHaveText('Agents');
  });

  test('Vendors link becomes active when navigating to /vendors', async ({ page }) => {
    await page.goto('/');
    const nav = new NavComponent(page);

    await nav.link('Vendors').click();
    await expect(page).toHaveURL('/vendors');
    await expect(nav.activeLink()).toHaveText('Vendors');
  });

  test('Approvals link becomes active when navigating to /approvals', async ({ page }) => {
    await page.goto('/');
    const nav = new NavComponent(page);

    await nav.link('Approvals').click();
    await expect(page).toHaveURL('/approvals');
    await expect(nav.activeLink()).toHaveText('Approvals');
    await page.screenshot({ path: 'evidence/screenshots/nav-approvals-active.png', fullPage: true });
  });

  test('user name and role are visible in the sidebar', async ({ page }) => {
    await page.goto('/');
    // Desktop sidebar (aside:not(#mobile-drawer)) shows user name and role
    const desktopSidebar = page.locator('aside:not(#mobile-drawer)');
    await expect(desktopSidebar.locator('p.truncate')).toBeVisible();
    await expect(desktopSidebar.getByText('OWNER')).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/nav-user-info.png', fullPage: true });
  });
});
