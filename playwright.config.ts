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
  /* ONE LINE PER TEST IN CI, WITH ITS DURATION, AS IT FINISHES.
     This was `github` alone, which prints nothing until the run ends: a run left
     9-16 minutes of silence in the log, and a run cancelled at the job limit left
     no record of which test it was in or how long any had taken. Six cancellations
     were diagnosed from the timestamps of single-character progress marks.
       list   — a line per test as it ends, so the log of a cancelled run still says
                where the time went and what was running when it stopped;
       github — the failure annotations on the pull request, as before;
       json   — every duration in one file, uploaded by verify.yml on passing runs
                too, so "which tests got slower" is a diff and not an excavation.
     The file sits in test-results/ because that directory is what the workflow
     already uploads; Playwright empties it at the START of a run and the reporter
     writes at the end. */
  reporter: process.env.CI
    ? [['list'], ['github'], ['json', { outputFile: 'test-results/durations.json' }]]
    : 'list',
  /* STOP BEFORE THE JOB LIMIT DOES, WHERE THE ARITHMETIC ALLOWS IT. CI only.
     A job cancelled at its limit reports "cancelled", prints no summary, writes no
     durations and uploads nothing. A run stopped HERE fails instead: Playwright
     prints what passed, what failed and what never ran, the json above is written,
     and the upload step still has time to run.

     THE NUMBER, FROM 17 LOGGED RUNS (2026-10-05 to 10-12), in minutes:
       · the runner ends the job 38.8-39.0 after its first log line, not 40.0;
       · everything before "Running N tests" took 3.1-6.2;
       · the slowest browser run that PASSED took 32.5 (after 6.1 of setup).
     So on the slowest runners the suite has 38.8 - 6.2 = 32.6, of which a healthy
     run has used 32.5. NO VALUE both spares that run and leaves time to upload.
     33 is chosen on the side of never failing a run that would have passed: it is
     half a minute above the slowest healthy one. What that costs is stated rather
     than hidden — when setup takes more than about 5.3 (38.8 - 33 - 0.5 to upload)
     the job limit still fires first, and the `list` lines above are then the
     record. On the quicker runners, where setup takes 3-5, this fires first and
     the run ends with a summary and its artifact.
     Neither the job limit nor any test timeout is changed here; raising the first
     is what would make this hold on every runner, and it is a separate decision. */
  globalTimeout: process.env.CI ? 33 * 60_000 : undefined,
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
      /* The ward-switch spec too: it clicks 3D Relief, so it also runs in the
         default project on SwiftShader, and here it runs on the real GPU path. */
      testMatch: ['**/heat-map-tiers.spec.ts', '**/heat-map-ward-switch.spec.ts'],
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
    /* Browser contracts exercise the exact static output that will ship. A
       dedicated port prevents an existing development server masking it.

       THE SERVER SERVES /api/live NOW, AND THAT IS NOT A CONVENIENCE.
       This was `npm run preview` — a plain `astro preview`, which has no
       serverless functions and answers 404 for it. The console reads that exactly
       as it reads a met.no outage, which is correct behaviour and meant the ward
       clock was never drawn: `paintClock` hides #clockw behind `btn.hidden = !L`.
       MEASURED — 0x0 on that server against 122x75 with the feed answering.

       So every spec that opens a ward console ran against one missing a widget,
       and nothing said so. The lone exception was heat-map-live-freshness.spec.ts,
       which stubs the route itself — the only reason the clock was tested at all.
       console-contrast.spec.ts is the sharpest case: it walks every text node on
       the console and asserts a contrast floor, over a console the clock was
       absent from. The collision in heat-map-overlap.spec.ts sat in that blind
       spot the whole time.

       `--canned` answers the route from a fixed reading rather than calling
       met.no: the suite must not depend on being online, and must not aim ten
       requests per run at an endpoint whose terms cap the entire application at
       20 a second. A spec's own page.route still intercepts first, so
       heat-map-live-freshness.spec.ts goes on driving age with its own payloads. */
    command: 'node scripts/preview-with-api.mjs --port 4322 --canned',
    url: 'http://127.0.0.1:4322',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
