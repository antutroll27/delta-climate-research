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
    /* THE DEFAULT PROJECT IS TIER 0, AND NOBODY KNEW.
       Headless Chromium reports `ANGLE (Google, Vulkan … SwiftShader Device …)`,
       which src/utils/render-quality.ts matches as LOW_GPU -> tier 0 -> isotherm.
       So every browser test this repo has ever run exercised the canvas-raster
       renderer and NONE of the Three.js relief path: relief-renderer, sun-lighting,
       cloud-layer, vegetation-layer, road-layer, water-layer and building-pick were
       never fetched, let alone asserted. Measured — the relief chunk is absent from
       the network log here and present under the project below.

       That is how `map.setSky()` stopping the map from ever loading passed a full
       suite: eleven specs waited twenty seconds for a reading that was never coming
       and reported timeouts, which reads as a slow machine.

       The name says the tier now, so the gap cannot be re-opened by accident. */
    { name: 'chromium-tier0', use: { ...devices['Desktop Chrome'] } },

    /* THE RELIEF PATH, on a real GPU. `--use-angle=metal` gets Apple Silicon's
       Metal backend instead of SwiftShader, which lifts render-quality.ts to tier 2
       and loads the Three.js scene the founder actually looks at.

       LOCAL ONLY, deliberately: a GitHub runner has no GPU, so this project would
       silently demote to tier 0 there and become a second copy of the project
       above — two names, one tier, and a false sense of coverage. Skipped in CI
       rather than lying about what CI checks. */
    ...(process.env.CI ? [] : [{
      name: 'chromium-relief',
      testMatch: '**/heat-map-tiers.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
        },
      },
    }]),
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
