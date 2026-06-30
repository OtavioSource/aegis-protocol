import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';

const WEB_PORT = 3001;
const BASE_URL = `http://localhost:${WEB_PORT}`;
const AUTH_STATE = resolve(__dirname, 'evidence/.auth/session.json');
const MONOREPO_ROOT = resolve(__dirname, '../..');

export default defineConfig({
  testDir: './specs',
  outputDir: './evidence/test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,

  reporter: [
    ['html', { outputFolder: './evidence/playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    video: 'on',
    trace: 'on',
    screenshot: 'on',
    locale: 'en-US',
    timezoneId: 'America/Sao_Paulo',
  },

  projects: [
    {
      name: 'setup',
      testDir: './fixtures',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STATE,
      },
      dependencies: ['setup'],
      testIgnore: /auth\.spec\.ts/,
    },
    {
      name: 'chromium-noauth',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /auth\.spec\.ts/,
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @aegis/api dev',
      port: 4000,
      cwd: MONOREPO_ROOT,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @aegis/web exec -- next dev --port ${WEB_PORT}`,
      port: WEB_PORT,
      cwd: MONOREPO_ROOT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXTAUTH_URL: BASE_URL },
    },
  ],
});
