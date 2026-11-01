import { defineConfig, devices } from '@playwright/test';

import { E2E_JWT_SECRET } from './env.js';

/**
 * Browser e2e: a whole tournament driven through the admin SPA and the player
 * site, one isolated BrowserContext per user. The stack (Postgres container,
 * API, both Vite dev servers) is booted by setup/globalSetup.ts.
 *
 * One worker: every test shares the DB and the API process.
 */

// The fixtures import src/db/db.ts and the admin middleware, which throw at
// import time without DATABASE_URL / JWT_SECRET — and `--list` / UI mode load
// the test files before globalSetup runs. The pool is lazy, and globalSetup
// overwrites both with the real values before any worker starts, so the
// placeholder URL is never connected to.
process.env.DATABASE_URL ??= 'postgres://e2e-placeholder/not-started';
process.env.JWT_SECRET ??= E2E_JWT_SECRET;

export default defineConfig({
  testDir: './tests',
  globalSetup: './setup/globalSetup.ts',
  outputDir: '../test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: '../playwright-report', open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    locale: 'ru-RU',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
