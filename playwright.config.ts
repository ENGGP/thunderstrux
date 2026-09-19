import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/artifacts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['line'], ['./tests/e2e/summary-reporter.ts']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', testMatch: /mobile.spec.ts/, use: { ...devices['Pixel 7'] } }
  ]
});
