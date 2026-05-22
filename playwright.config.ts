import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Unit tests under tests/unit are run by vitest, not Playwright.
  testIgnore: '**/unit/**',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
