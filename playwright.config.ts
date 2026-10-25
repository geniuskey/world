import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      url: 'http://localhost:5175/api/world/config',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
