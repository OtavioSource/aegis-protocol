import { expect, test } from '@playwright/test';

import { LoginPage } from '../pages/login.page.js';

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    await expect(login.heading()).toBeVisible();
    await expect(page.getByText('Governance Console')).toBeVisible();
    await expect(login.emailInput).toBeVisible();
    await expect(login.passwordInput).toBeVisible();
    await expect(login.submitButton).toBeVisible();
    await page.screenshot({ path: 'evidence/screenshots/auth-login-page.png', fullPage: true });
  });

  test('shows error on invalid credentials', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('wrong@example.com', 'badpassword');

    const error = page.locator('#login-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Invalid email or password');
    await page.screenshot({ path: 'evidence/screenshots/auth-invalid-credentials.png', fullPage: true });
  });

  test('shows error on wrong password', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('admin@aegis-demo.com', 'wrongpassword');

    const error = page.locator('#login-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Invalid email or password');
  });

  test('password show/hide toggle works', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    await login.passwordInput.fill('admin123');
    await expect(login.passwordInput).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: /show password/i }).click();
    await expect(login.passwordInput).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: /hide password/i }).click();
    await expect(login.passwordInput).toHaveAttribute('type', 'password');
    await page.screenshot({ path: 'evidence/screenshots/auth-password-toggle.png', fullPage: true });
  });

  test('redirects unauthenticated user from protected route to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await page.screenshot({ path: 'evidence/screenshots/auth-redirect-to-login.png', fullPage: true });
  });

  test('successful login redirects to overview', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('admin@aegis-demo.com', 'admin123');

    await expect(page).toHaveURL('/', { timeout: 15_000 });
    await expect(page).not.toHaveURL('/login');
    await page.screenshot({ path: 'evidence/screenshots/auth-login-success.png', fullPage: true });
  });
});
