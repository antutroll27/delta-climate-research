import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // macOS may create AppleDouble sidecars beside copied test files. They are
  // binary metadata, not executable specs, and must never enter discovery.
  testIgnore: ['**/._*'],
  fullyParallel: true,
  // The suite exercises several live WebGL surfaces and one wall-clock loader
  // contract. A single browser worker avoids test-induced GPU/CPU contention
  // being mistaken for a production regression.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4322',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox-cbam',
      testMatch: '**/cbam-lines.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-cbam',
      testMatch: '**/cbam-lines.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    // Browser contracts exercise the exact static output that will ship. A
    // dedicated port prevents an existing development server masking it.
    command: 'npm run preview -- --host 127.0.0.1 --port 4322',
    url: 'http://127.0.0.1:4322',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
