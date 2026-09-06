import { expect, test, type Page } from '@playwright/test';

/**
 * THE TWO RENDER TIERS, EACH IN THE BROWSER THAT ACTUALLY PRODUCES IT.
 *
 * WHY THIS FILE EXISTS. Every browser test in this repository ran at tier 0
 * without anyone knowing: headless Chromium reports SwiftShader, which
 * render-quality.ts classifies LOW_GPU, which selects the canvas-raster renderer
 * and never fetches the Three.js relief chunk. So the relief path — the thing the
 * founder looks at, and where most of a day's work landed — had no browser
 * coverage at all, and the tier-0 path had coverage that could not see it.
 *
 * That combination is how `map.setSky()` stopping the map from ever firing `load`
 * survived a full suite: the specs waited on a readout, timed out, and reported
 * what looks like a slow machine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MEASUREMENT IS PIXELS, AND EVERY CHEAPER ONE FAILED ITS OWN SABOTAGE.
 *
 * Two earlier attempts at this test passed with the fix removed:
 *
 *   · "hide the field layer and see if the picture changes" — hiding a layer
 *     changes the picture whether or not its texture was ever uploaded.
 *   · "move a slider and compare screenshot BYTES" — the ward-name overlay sits
 *     in the frame, so PNG bytes shift on any repaint. It measured encoding noise.
 *
 * Reading the GL buffer directly is not available: MapLibre runs
 * `preserveDrawingBuffer: false`, so `readPixels` after a frame returns nothing.
 * So the screenshot is sent BACK INTO the page, drawn to a 2-D canvas and read as
 * ImageData — real pixels, counted, with a threshold no repaint jitter can cross.
 */

const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';

/**
 * PURE MAP — no chrome of any kind in frame, and that is not fussiness.
 *
 * A wider clip reads ~14% "ramp" on a map showing NOTHING, because the frame
 * catches the sidebar's cyan readouts on the left and the amber ward-name overlay
 * top-right. Both are saturated and neither is violet, so both score as field.
 * Measured: with the renderer's GPU push removed — bare basemap, verified by
 * eye — the wider clip still passed every assertion in this file.
 *
 * That is the fourth measurement in this session that passed with the defect
 * restored. The lesson is the same each time: the instrument has to be sabotaged
 * before it is trusted, and a frame that contains any of the console's own
 * colours cannot answer a question about the map.
 *
 * This window sits below the ward title and right of the sidebar, over ward
 * interior at the default camera.
 */
const MAP_CLIP = { x: 560, y: 430, width: 300, height: 190 };

/**
 * How many of the map's lit pixels carry a heat-ramp colour rather than basemap.
 *
 * IT MUST NOT ENCODE THE TIME OF DAY, and my first two attempts did. "Count warm
 * pixels" reads ~40% at 13:00 and ~2% at 22:00 — because at night the ward is
 * genuinely at the COOL end of the ramp. That test measures the sun, not the
 * renderer, and it failed the relief tier on a frame where the field was fine.
 *
 * WHAT IS INVARIANT is that the ramp is SATURATED and spans cyan (~190°) through
 * green and tan to red (~0°), while OBOS Slate is a desaturated violet at
 * 233–250°. So: enough saturation to be a deliberate colour, and a hue outside
 * the basemap's band. That holds at every hour and under every intervention.
 *
 * The margins are generous on purpose. The raster paints at `raster-opacity:
 * 0.5` over a dark ground, so every ramp colour arrives desaturated and darker
 * than its palette value — a threshold tuned to the source numbers reads 0.3% on
 * a frame where the field is plainly visible, which is exactly the mistake that
 * produced this comment.
 *
 * Near-black pixels are excluded: unlit ground would otherwise dominate the
 * denominator and make the fraction a measure of how much map is in frame.
 */
async function rampFraction(page: Page): Promise<number> {
  const shot = await page.screenshot({ clip: MAP_CLIP });
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((done, fail) => {
      img.onload = done; img.onerror = fail;
      img.src = `data:image/png;base64,${b64}`;
    });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('no 2d context for the pixel read');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    let ramp = 0, lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r + g + b < 45) continue;
      lit++;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.14) continue;                       // grey/near-grey: not a ramp colour
      const d = max - min;
      let hue = 0;
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue = ((hue * 60) % 360 + 360) % 360;
      // Everything except the basemap's violet band counts as ramp.
      if (hue < 205 || hue > 285) ramp++;
    }
    return lit === 0 ? 0 : ramp / lit;
  }, shot.toString('base64'));
}

/** Wait for the instrument to produce a reading — never a bare timeout. */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 30_000 });
  await page.waitForTimeout(4_000);
}

test.describe('the render tier this project actually runs', () => {
  test('names itself, so a silent demotion cannot masquerade as coverage', async ({ page }, testInfo) => {
    await page.goto(BALLYGUNGE);
    await settled(page);

    const relief = await page.evaluate(() => performance
      .getEntriesByType('resource')
      .some((e) => e.name.includes('relief-renderer')));

    if (testInfo.project.name === 'chromium-relief') {
      /* If this fails the GPU flags stopped working and this project has quietly
         become a second tier-0 run — which is worse than not having it, because
         the name would still claim relief coverage. */
      expect(relief, 'the relief chunk was not fetched under --use-angle=metal: '
        + 'this project has demoted to tier 0 and is now a duplicate of '
        + 'chromium-tier0 wearing a different name').toBe(true);
    } else {
      expect(relief, 'the relief chunk WAS fetched in the default project. That is '
        + 'not a failure of the app — it means headless Chromium now has a real GPU '
        + 'here, and the tier-0 renderer has silently lost its only coverage')
        .toBe(false);
    }
  });
});

test.describe('tier 0 — the canvas raster is the whole picture', () => {
  /* SKIPPED FROM INSIDE THE TEST, because a describe-level `test.skip(fn)` hands
     its callback fixtures and NOT testInfo — reading `testInfo.project` there
     throws, which is how the first version of this file reported three TypeErrors
     as though they were assertion failures. */
  test('the analytical field CONTRIBUTES to the picture', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-tier0',
      'the software-rendering path; the relief project draws its own field');
    /* THE DEFECT THIS CATCHES. `core-field-layer.ts` registers its canvas
       `animate: false`, and maplibre-gl 4.7.1 uploads such a canvas EXACTLY ONCE —
       on the first frame after addSource. `attach()` runs while the canvas is
       still blank, so without an explicit push the texture stays blank for ever:
       an empty basemap under a full set of confident readouts, which is the worst
       thing this instrument can render. Tier 0 has no relief scene to cover for
       it, so this is the only renderer there is.

       DIFFERENTIAL, NOT ABSOLUTE, AND THAT IS THE WHOLE DESIGN. "More than N% of
       the map is on the ramp" cannot work: the bare Slate basemap reads 14.1% in
       this window on its own — its building fills are warm — so any constant
       between that floor and the signal is one camera angle, one ward or one hour
       from being wrong in either direction. MEASURED: a 5% threshold passed with
       the renderer's GPU push removed and the map verifiably empty.

       Turning the layer off and measuring the DROP has no floor to clear. A blank
       texture contributes nothing, so with the defect the two readings are equal —
       which is precisely the state that has to fail. */
    await page.goto(BALLYGUNGE);
    await settled(page);
    const withField = await rampFraction(page);

    await page.locator('button[data-rail="layers"]').click();
    await page.locator('input[data-layer="thermal/surface"]').uncheck();
    await page.waitForTimeout(2_500);
    const withoutField = await rampFraction(page);

    expect(withField - withoutField,
      `turning the surface layer off changed the map from ${(withField * 100).toFixed(1)}% `
      + `ramp pixels to ${(withoutField * 100).toFixed(1)}% — a difference of `
      + `${((withField - withoutField) * 100).toFixed(1)} points. The layer is `
      + 'present and visible but contributes nothing to what is drawn, which is a '
      + 'canvas texture that was uploaded blank and never refreshed')
      .toBeGreaterThan(0.05);
  });

  test('the field FOLLOWS the model rather than freezing at its first frame', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-tier0',
      'the software-rendering path; the relief project draws its own field');
    /* PRESENCE IS NOT ENOUGH, and this is the half that pins the texture upload.
       A field painted once and never re-uploaded still shows colour — it simply
       stops answering. Cool the ward with tree corridors at maximum and the warm
       fraction must fall; a frozen texture holds its first value exactly. */
    await page.goto(BALLYGUNGE);
    await settled(page);
    const before = await rampFraction(page);

    await page.locator('#ivTrees').evaluate((el: HTMLInputElement) => {
      el.value = el.max;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#v1')).not.toHaveText('0', { timeout: 10_000 });
    await page.waitForTimeout(6_000);

    const after = await rampFraction(page);
    expect(Math.abs(after - before), `the ramp fraction was ${(before * 100).toFixed(1)}% `
      + `before the intervention and ${(after * 100).toFixed(1)}% after — the model `
      + 'moved and the picture did not, which is a texture frozen at its first '
      + 'upload').toBeGreaterThan(0.01);
  });
});

test.describe('the relief tier — the scene the founder looks at', () => {
  test('mounts the Three scene and paints a heat field over it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-relief',
      'needs a real GPU; the tier-0 project cannot reach this code at all');
    /* The first browser assertion this path has ever had. Everything named here —
       the relief chunk, the 3-D mode, the field over the extrusions — was
       unreachable from the suite until this project existed. */
    await page.goto(BALLYGUNGE);
    await settled(page);

    const chunks = await page.evaluate(() => performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /relief-renderer|three\.module/.test(n)).length);
    expect(chunks, 'the relief scene never loaded on a GPU that should reach tier 2')
      .toBeGreaterThan(0);

    const warm = await rampFraction(page);
    expect(warm, `only ${(warm * 100).toFixed(1)}% of lit pixels are on the heat `
      + 'ramp: the relief scene mounted but the thermal field is not on it')
      .toBeGreaterThan(0.05);
  });
});

const WARD_ROUTE = '/heat-map/in/kolkata/ballygunge/';

type Quality = { current?: { tier: number; gpuLabel: string }; baseline?: { tier: number }; applyTier?: (t: number) => void };

const state = (page: Page) => page.evaluate(() => {
  const c = (window as Window & { __deltaRenderQualityController?: Quality }).__deltaRenderQualityController;
  return {
    tier: c?.current?.tier, base: c?.baseline?.tier, gpu: c?.current?.gpuLabel ?? '',
    sim: document.getElementById('simBackend')?.textContent?.trim() ?? '',
    reliefChunk: performance.getEntriesByType('resource').some((e) => /relief-renderer/.test(e.name)),
  };
});

/* The header reads "SELECTING ENGINE" until the capability probe resolves; the
   renderer's chunk follows within the same tick on every tier now. */
async function bootedWard(page: Page) {
  await expect(page.locator('#simBackend')).not.toHaveText(/selecting/i, { timeout: 40_000 });
  await expect.poll(async () => (await state(page)).reliefChunk, { timeout: 30_000 }).toBe(true);
}

test.describe('the tier verdict survives the visitor\'s route (2026-09-06)', () => {
  /* THE FLAT-FIELD BOOT. A visitor arriving from the landing page found OBOS drawn
     as a flat tinted quad with "3D relief" selected and "CPU SIM" in the header;
     a reload cured it. Reproduced three ways on the built site, each a test here.
     The tell in every case: the 3-D renderer is a dynamic import, so whether its
     chunk was ever fetched says whether the city was attempted. RELIEF PROJECT
     ONLY — on SwiftShader the city is not attempted by design (a software
     rasteriser opens flat), so the tell means nothing there. */
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-relief',
      'the 3-D chunk is the tell, and a software renderer opens flat by design');
  });
  test.setTimeout(150_000);

  test('tier 0 opens on the 3-D city too', async ({ page }) => {
    /* Two cores classify as tier 0 before any GPU label is read (classifyHardware). */
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 });
    });
    await page.goto(WARD_ROUTE);
    await bootedWard(page);
    const s = await state(page);
    expect(s.base, 'the precondition: this run is tier 0').toBe(0);
    expect(s.reliefChunk).toBe(true);
    expect(s.sim).toMatch(/CPU/);
  });

  test('a demotion earned on the landing page does not follow the visitor into OBOS', async ({ page }) => {
    await page.addInitScript(() => { sessionStorage.setItem('delta:loaded', '1'); });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const hasController = () => page.evaluate(() => !!(window as Window & { __deltaRenderQualityController?: Quality }).__deltaRenderQualityController);
    await expect.poll(hasController, { timeout: 30_000 }).toBe(true);
    /* What six seconds of 34 ms frames did on the landing page, applied directly:
       the governor's own step-down. The precondition proves it took. */
    await page.evaluate(() => (window as Window & { __deltaRenderQualityController?: Quality }).__deltaRenderQualityController!.applyTier!(0));
    expect((await state(page)).tier).toBe(0);
    /* Through the site's own link, so the document — and the controller — survive. */
    await page.evaluate(() => (document.querySelector('a[href*="ballygunge"]') as HTMLAnchorElement | null)?.click());
    await page.waitForFunction(() => /ballygunge/.test(location.pathname), null, { timeout: 30_000 });
    await bootedWard(page);
    const s = await state(page);
    expect(s.tier, 'the ward boots on the device\'s own tier').toBe(s.base);
    expect(s.reliefChunk).toBe(true);
  });

  test('a capability probe that fails once is re-run, not cached as no WebGL', async ({ page }) => {
    /* Only detached canvases fail, and only twice: the probe's own; the map's canvas
       is attached and must keep its context or nothing boots at all. */
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext; let failed = 0;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if ((type === 'webgl2' || type === 'webgl') && !this.isConnected && failed < 2) { failed += 1; return null; }
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto(WARD_ROUTE);
    await bootedWard(page);
    const s = await state(page);
    expect(s.gpu, 'the label was re-probed').not.toMatch(/no-webgl|gpu-detect-error/);
    expect(s.reliefChunk).toBe(true);
  });
});
