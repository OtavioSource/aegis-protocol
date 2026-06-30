import { expect, test as setup } from '@playwright/test';
import { mkdir } from 'fs/promises';
import { resolve } from 'path';

const AUTH_STATE = resolve(__dirname, '../evidence/.auth/session.json');

setup('authenticate as admin', async ({ page }) => {
  await mkdir(resolve(__dirname, '../evidence/.auth'), { recursive: true });

  await page.goto('/login');
  await page.locator('input[name="email"]').fill('admin@aegis-demo.com');
  await page.locator('input[name="password"]').fill('admin123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL('/', { timeout: 15_000 });

  await page.context().storageState({ path: AUTH_STATE });
});
