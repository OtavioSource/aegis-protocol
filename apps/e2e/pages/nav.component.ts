import { type Locator, type Page } from '@playwright/test';

export const NAV_LINKS = [
  { label: 'Overview', href: '/' },
  { label: 'Spend Requests', href: '/spend-requests' },
  { label: 'Approvals', href: '/approvals' },
  { label: 'Policies', href: '/policies' },
  { label: 'Agents', href: '/agents' },
  { label: 'Vendors', href: '/vendors' },
  { label: 'Fiat ramp', href: '/fiat' },
  { label: 'Audit', href: '/audit' },
  { label: 'Community', href: '/community' },
] as const;

export class NavComponent {
  readonly nav: Locator;

  constructor(private readonly page: Page) {
    this.nav = page.getByRole('navigation', { name: 'Main menu' });
  }

  link(label: string) {
    return this.nav.getByRole('link', { name: label });
  }

  activeLink() {
    return this.nav.locator('[aria-current="page"]');
  }

  signOutButton() {
    return this.page.getByRole('button', { name: /sign out/i });
  }
}
