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
    // WEBKIT RUNS LOCALLY, NOT IN CI, and the reason is apt rather than the browser.
    //
    // WebKit needs ~35 system libraries the GitHub runner image does not ship — libgtk-4,
    // libgraphene, the gstreamer suite, flite, libavif. Installing them means `playwright
    // install-deps webkit`, which means apt, and archive.ubuntu.com stalled that step on three
    // separate runs: twice for eighteen minutes until the job was cancelled, once until the
    // four-minute timeout fired. Chromium and Firefox both launch on the stock image and need
    // none of it, so gating a release on WebKit means gating it on a mirror.
    //
    // The engine still earns its place — it is the one a customs consultant might open the
    // calculator in, it disagrees with Chromium about print CSS and date inputs, and it already
    // caught a mega-menu bug Chromium could not see. That bug was found by a LOCAL full-suite
    // run, which is exactly the coverage this preserves: `npx playwright test` here runs all
    // three, and the CI matrix runs the two that do not need a package manager.
    //
    // Set PLAYWRIGHT_WEBKIT=1 to force it on in CI once the image ships the libraries, or when
    // running against a Playwright container that already has them.
    ...(process.env.CI && !process.env.PLAYWRIGHT_WEBKIT ? [] : [{
      name: 'webkit-cbam',
      testMatch: '**/cbam-lines.spec.ts',
      use: { ...devices['Desktop Safari'] },
    }]),
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
