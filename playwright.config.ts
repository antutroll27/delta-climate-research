import { defineConfig, devices } from '@playwright/test';
import { PW_ORIGIN, PW_PORT } from './tests/e2e/fixtures/ui-v2-state';
import { V2_PART_A, V2_PART_B, v2Match } from './tests/e2e/fixtures/v2-split';

/** Chromium args for the perf runs (BRIEF.md, founder rule 17 Oct: NO window ever appears on his screen). The off-screen
    variant (--window-position=-32000,-32000 --no-startup-window ...) was tried on 17 Oct and macOS CLAMPED the window back onto
    the display (CDP Browser.getWindowBounds: left 0, top 30), so the committed default is the brief's fallback, new headless on
    Metal. The JSON is labelled "headless". One list, shared with the glass spec. */
const PERF_METAL = ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

/** WHICH PROJECTS RUN (FINAL audit F1, founder-approved 19 Oct). Unset = every project, as always (local runs). CI sets it per job, so the @v2 browser suite has a job of its own and the 38-minute stop
    below never has to hold both suites:
      main  -> everything except chromium-v2-a and chromium-v2-b (the existing job);
      v2-a  -> chromium-v2-a only;      v2-b  -> chromium-v2-b only (the obos-v2-browser matrix, verify.yml).
    Any other value is refused: a typo must not quietly run nothing, or everything. */
const SCOPE = process.env.OBOS_PW_SCOPE;
const V2_PARTS = ['chromium-v2-a', 'chromium-v2-b'];
function scopeProjects<T extends { name: string }>(projects: T[]): T[] {
  if (SCOPE === undefined || SCOPE === '') return projects;
  if (SCOPE === 'main') return projects.filter((p) => !V2_PARTS.includes(p.name));
  if (SCOPE === 'v2-a' || SCOPE === 'v2-b') return projects.filter((p) => p.name === `chromium-${SCOPE}`);
  throw new Error(`OBOS_PW_SCOPE must be unset, "main", "v2-a" or "v2-b" (got "${SCOPE}")`);
}

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
     is what would make this hold on every runner, and it is a separate decision.

     2026-10-14: THAT DECISION, TAKEN. 33 became 40, with the job limit raised from 40 to 50
     in verify.yml in the same change. From the durations.json of the last two full runs:
       · 12 Oct (run 38309541448): 195 tests, 23.7 min;
       · 13 Oct (run 38448354814): 197 tests, 28.7 min, with no retry and no new slow test.
         The same suite, 21% slower on a slower runner; the job took 34.6 min in all.
     So a healthy run had 4.3 min under the 33-minute stop on an ordinary day, and the
     slowest healthy run on record (32.5) had half a minute. The CBAM three-year strip adds
     10 browser tests in two engines, about 0.7 min at the measured 1.8 s and 2.4 s medians
     for that file, and more CBAM tests follow it.
     THE ARITHMETIC NOW: the runner ends a 50-minute job about 48.8 min after its first log
     line; setup and the static checks have taken 3.1-6.2; that leaves 42.6 on the slowest
     setup. 40 stops the suite 2.6 min before that, which is time to print the summary, write
     durations.json and upload. Against 40, the slowest healthy run on record plus the new
     tests (32.5 + 0.7 = 33.2) has 6.8 min, about 20%: one runner-speed swing of the size
     seen between 12 and 13 October. It is a stop for an overrun, not a budget to grow into:
     four tests account for 9 of the 28.7 minutes (see the slowest-test list in the pull
     request that made this change), and that is where time is to be found.

     2026-10-14, LATER THE SAME DAY: 40 BECAME 38, because the 6.2 above was out of date
     within hours. Three runs on the new limits:
       · 38459464137: 213 tests, 26.8 min of browser tests, job 32.3 min (5.5 outside them);
       · 38464957721: 215 tests, 30.8 min, job 38.65 min, so 7.8 min outside them. That run
         would have been cancelled under the old 40-minute job;
       · 38465533485: 221 tests, 19.8 min, job 24.5 min (4.7 outside them).
     Setup plus the static checks is therefore up to 7.8, not 6.2, and it moves with the
     runner just as the suite does (19.8 against 30.8 for nearly the same tests, started six
     minutes apart). Redone on 7.8: 48.8 - 7.8 = 41.0 for the browser tests. A stop at 40
     left 1.0 min to print and upload; 38 leaves 3.0. Against 38, the slowest healthy suite
     on record (32.5) has 5.5 min, about 17%. */
  globalTimeout: process.env.CI ? 38 * 60_000 : undefined,
  use: {
    baseURL: PW_ORIGIN,
    trace: 'on-first-retry',
  },
  projects: scopeProjects([
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
    { name: 'chromium-tier0', testIgnore: ['**/._*', '**/obos-v2-*.spec.ts'], use: { ...devices['Desktop Chrome'] } },

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
    /* OBOS v2 (spec §9.2). v2 is the default UI (flip), so every spec opens it with no query and no storage state. SwiftShader = tier 0 = Plates: no backdrop-filter in CI.
       TWO PROJECTS, ONE SUITE (S8). chromium-v2 had grown to 95 specs and 8.8 minutes against the 9-minute global timeout of one e2e tool run, so it is split by spec file into
       chromium-v2-a and chromium-v2-b (tests/e2e/fixtures/v2-split.ts; tests/unit/obos-v2-ci-split.test.mjs fails if a spec belongs to neither part or to both).
       MEASURED AT S8 (dev machine, M-series, CPU-marginal, 1 worker, 18 Oct): part A 54 tests, 6.2 min; part B 73 tests, 6.1 min; the pair 127 tests, 12.3 min (the old project's
       95 specs were 8.8). BUDGET: each part <= 6.5 min on the dev machine, so neither is near the 9-minute stop; the pair is the @v2 budget, 12.5 min.
       CI ARITHMETIC, STATED AND NOT HIDDEN (spec 9.4 set <= 6 min for 22 tests; that no longer holds). On the 2-CPU runner the same tests take about 1.5x: ~18.5 min for the pair. The last
       full CI run was 28.7 min for 197 tests (13 Oct) against the 38-minute stop above, so 28.7 + 18.5 = 47.2 does not fit. Spec 9.4's fallback, moving obos-v2-contrast and
       obos-v2-phone (2.1 min here, ~3.2 on CI) to local-only, gets to ~44 and still does not fit. So the flip PR must give the @v2 suite its own CI job (a matrix leg per part, which
       also halves the wall time) or raise the stop and the job limit; neither was done at S8. FINAL audit F1 (founder-approved 19 Oct): the @v2 parts have their own CI job (verify.yml, `obos-v2-browser`, a matrix leg per part, each ~9-10 CI-min), selected by OBOS_PW_SCOPE above; the existing job runs OBOS_PW_SCOPE=main.
       Fold checks into one engine load (openV2 ~20 s locally) before adding a load. */
    {
      name: 'chromium-v2-a',
      testMatch: v2Match(V2_PART_A),
      grep: /@v2/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-v2-b',
      testMatch: v2Match(V2_PART_B),
      grep: /@v2/,
      use: { ...devices['Desktop Chrome'] },
    },
    ...(process.env.CI ? [] : [{
      name: 'chromium-v2-relief',
      testMatch: ['**/obos-v2-glass.spec.ts', '**/obos-v2-boot.spec.ts', '**/obos-v2-contrast.spec.ts', '**/obos-v2-shots.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        /* HEADED: a headless Chromium has no display vsync (the perf gate read 1.2 ms frames, 210 fps, for
           everything), so Glass would look free. Brainstorm 02 measured vsync-on, headed.
           FOUNDER RULE (17 Oct): NO WINDOW EVER APPEARS ON HIS SCREEN. Playwright's headless:false plus --headless=new gives
           Chromium's new headless mode (no window at all) with the real Metal GPU path. Every other project stays headless.
           The perf spec asserts the frame rate stayed at display rate and labels its JSON "headless". */
        headless: false,
        launchOptions: { args: [...PERF_METAL] },
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
  ]),
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
    command: `node scripts/preview-with-api.mjs --port ${PW_PORT} --canned`,
    url: PW_ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
