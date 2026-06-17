import { defineConfig, devices } from '@playwright/test';

/**
 * Royal ERP — Playwright UI Automation Config
 * ─────────────────────────────────────────────
 * Run:
 *   npm run e2e                       # all tests, headless
 *   npm run e2e:ui                    # interactive Playwright UI
 *   npm run e2e:tenant1               # only royal-mudhol tenant
 *   npm run e2e:tenant2               # only test2shop tenant
 *   TENANT=royal-mudhol npm run e2e   # specific tenant
 *
 * Full docs: e2e/README.md
 */

export default defineConfig({
  testDir: './tests',
  timeout: 40_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,         // run sequentially (tests share tenant state)
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { outputFolder: '../test-reports/html', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.BASE_URL || 'https://pretty-stillness-production-cf79.up.railway.app',
    headless: process.env.HEADED !== '1',
    viewport: { width: 1400, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      name: 'tenant-royal-mudhol',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: undefined,
        // Tenant params injected via env — see e2e/fixtures/tenants.ts
      },
    },
    {
      name: 'tenant-test2shop',
      testMatch: /.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /.*\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
});
