import { expect, test } from '@playwright/test';

/**
 * A KOLKATA DAWN MUST NOT KEEP THE MAP AWAKE (2026-10-13).
 *
 * `syncSky` runs on every MapLibre `render` and is guarded by comparing the sky
 * spec it would apply with the one it last applied — because `setSky` asks for a
 * repaint, and an unguarded call there repaints forever. In the live "Now" view
 * the sun's height comes off the clock in milliseconds, and while the sun is
 * between -8° and +12° the spec carried a float of it, so the guard never held:
 * `setSky` on every render, a map that never went idle, for about an hour and a
 * half around every sunrise and sunset. On a visitor's device that is a GPU
 * working flat out behind a still picture. In CI it made this whole suite run
 * about twice as slow in those two windows and get cancelled at the job limit —
 * which read, five times, as a slow runner.
 *
 * THE PAGE'S CLOCK IS MOVED BY THE `Date` HEADER, as in
 * heat-map-observed-weather.spec.ts: /api/live is served as of a dawn, the page
 * adopts that instant as its own clock (heat-map-app.ts `clockSkewMs`), and the
 * browser's clock is left alone — so time still RUNS, which is the whole defect.
 * `page.clock.setFixedTime` would freeze the sun, hand the guard one spec for ever,
 * and pass against the bug.
 *
 * `?lab=1` exposes the map on localhost only (look.ts `labHookAllowed`); that is
 * how `setSky` is counted without the page knowing it is being watched.
 *
 * Tier 0 on purpose (the default project): that is the tier CI runs, and it has no
 * idle orbit, so "the map comes to rest" is a fair thing to ask of it.
 */
const DAWN = Date.parse('2026-10-12T00:30:00Z');       // 06:00 IST, the sun ~2.7° up and climbing

test.describe('the twilight sky', () => {
  test.setTimeout(180_000);

  test('a Kolkata dawn changes the sky in steps and lets the map idle', async ({ page }, testInfo) => {
    const opened = Date.now();
    /* The served instant advances with the test, so a second poll of the feed
       re-adopts the same running clock rather than yanking the sun back. */
    const servedNow = () => new Date(DAWN + (Date.now() - opened));
    await page.route(/\/api\/live\?/, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { date: servedNow().toUTCString(), age: '0' },
      body: JSON.stringify({
        properties: { timeseries: [{ time: `${servedNow().toISOString().slice(0, 14)}00:00Z`, data: { instant: { details: {
          air_temperature: 26.0, relative_humidity: 80, wind_speed: 1.5, cloud_area_fraction: 20,
        } } } }] },
      }),
    }));

    await page.goto('/heat-map/in/kolkata/ballygunge/?lab=1');
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
    /* THE PRECONDITION, ASSERTED. Without it this test passes at any hour the
       clock stub silently fails to land — noon and night never looped. A single
       digit of elevation is a sun on the ramp; the suite's real clock, wherever
       it is, cannot fake that except by being a dawn or a dusk itself. */
    await expect(page.locator('#sunLineText')).toHaveText(/· [1-6]° up ·/, { timeout: 60_000 });

    // let the load, the first solve and the entrance settle before counting anything
    await page.waitForTimeout(3000);

    const seen = await page.evaluate(async () => {
      const map = (window as unknown as { __obosMap?: {
        setSky: (spec: unknown) => unknown;
        on: (type: string, fn: () => void) => void;
        off: (type: string, fn: () => void) => void;
        once: (type: string, fn: () => void) => void;
        triggerRepaint: () => void;
      } }).__obosMap;
      if (!map) return null;
      let renders = 0, skies = 0;
      const onRender = () => { renders++; };
      const setSky = map.setSky.bind(map);
      map.on('render', onRender);
      map.setSky = (spec) => { skies++; return setSky(spec); };
      await new Promise((done) => setTimeout(done, 4000));
      map.off('render', onRender);
      map.setSky = setSky;
      /* Ask for one more frame and see whether the map comes to rest after it.
         MapLibre fires `idle` only when a frame ends with nothing left to draw;
         under the loop every frame ended by dirtying the style again. */
      const idle = await new Promise<boolean>((done) => {
        const timer = setTimeout(() => done(false), 10_000);
        map.once('idle', () => { clearTimeout(timer); done(true); });
        map.triggerRepaint();
      });
      return { renders, skies, idle };
    });

    expect(seen, 'the ?lab=1 hook must expose the map on localhost').not.toBeNull();
    testInfo.annotations.push({
      type: 'twilight',
      description: `${seen!.skies} setSky and ${seen!.renders} renders in 4 s; idle ${seen!.idle}`,
    });
    console.log(`twilight: ${seen!.skies} setSky and ${seen!.renders} renders in 4 s; idle ${seen!.idle}`);
    /* At most one: the sky moves a step about every 26 s of twilight, so a 4 s
       window can straddle one boundary and never two. */
    expect(seen!.skies, `setSky ran ${seen!.skies} times across ${seen!.renders} renders in 4 s of dawn`)
      .toBeLessThanOrEqual(1);
    expect(seen!.idle, `the map never went idle (${seen!.renders} renders and ${seen!.skies} setSky in 4 s)`)
      .toBe(true);
  });
});
