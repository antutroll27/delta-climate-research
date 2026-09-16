import { expect, test } from '@playwright/test';

/**
 * A SECOND CITY'S WARD ACTUALLY OPENS IN A BROWSER.
 *
 * WHY THIS FILE EXISTS, MEASURED. `heat-map-app.ts` indexed `WARD_MAP`, which is
 * built from `WARDS` — the CATALOGUE list, gated to Kolkata. So for every
 * Bengaluru ward `wardOf(key)` returned undefined, and the module's own
 *
 *     center: [wardOf(INITIAL_AREA).lon, wardOf(INITIAL_AREA).lat]
 *
 * threw `TypeError: Cannot read properties of undefined (reading 'lon')` BEFORE
 * maplibre was ever constructed. In the browser: zero canvases, no map, the
 * backend chip reading "SELECTING ENGINE" for ever, every number a dash. A whole
 * city dead on the page, under a fully rendered console shell that made it look
 * like a loading problem.
 *
 * AND THE SUITE WAS GREEN. 728 unit tests passed. Every other e2e spec opens
 * `/heat-map/in/kolkata/…`, and nothing anywhere opened a Bengaluru ward, so
 * there was no gate to fail — which is worse than a gate that fails, because it
 * reports success.
 *
 * THE UNIT GUARD IS NOT ENOUGH, AND THAT WAS MEASURED TOO.
 * `instrument-opens-every-renderable-area.test.mjs` asserts the DATA invariant —
 * every drawable area has a ward row, artefact URLs and a resolving scope. Under
 * the real mutation (restore `const WARDS = WARD_MAP`) it stayed 20/20 GREEN,
 * because the defect is in the WIRING, not the data. Only a browser sees it.
 * This file is that gate.
 *
 * WHAT IT ASSERTS, AND WHY EACH IS CHOSEN. A canvas plus `.maplibregl-map` is the
 * narrowest fact that the mount completed — the crash happened strictly before
 * either existed. The building count proves the ward's own artefact was fetched
 * and parsed, not merely that a map appeared. `pageerror` is captured because the
 * original failure was a silent throw: nothing in the DOM said anything was
 * wrong.
 */

/* Bengaluru's three, all of which the instrument can draw and none of which the
   catalogue publishes yet. Whitefield is included deliberately: it is the ward on
   the 43PGQ/43PHQ tile seam, so it exercises the artefact set most likely to be
   incomplete. */
const SECOND_CITY = [
  { path: '/heat-map/in/bengaluru/indiranagar/', name: 'Indiranagar', minBuildings: 10_000 },
  { path: '/heat-map/in/bengaluru/mg-road/', name: 'MG Road', minBuildings: 8_000 },
  { path: '/heat-map/in/bengaluru/whitefield/', name: 'Whitefield', minBuildings: 8_000 },
] as const;

for (const ward of SECOND_CITY) {
  test(`${ward.name} mounts the instrument, not just the shell`, async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    await page.goto(ward.path, { waitUntil: 'domcontentloaded' });

    /* THE MAP ITSELF. Both halves: a <canvas> can exist from some other widget,
       and the maplibre root can be in the DOM before GL comes up. The crash beat
       both, so either alone would have caught it — together they say the mount
       actually completed. */
    await expect(page.locator('.maplibregl-map')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.maplibregl-map canvas').first()).toBeAttached({ timeout: 30_000 });

    /* THE WARD'S OWN DATA REACHED THE PAGE. `— buildings` is the boot placeholder,
       so a real count proves {ward}.json was fetched, parsed and counted rather
       than the map merely having drawn a basemap. */
    const count = page.locator('#bcount');
    await expect(count).not.toHaveText(/^—/, { timeout: 30_000 });
    const text = (await count.textContent()) ?? '';
    const parsed = Number(text.replace(/[^0-9]/g, ''));
    expect(parsed, `${ward.name}: building count read "${text}"`).toBeGreaterThan(ward.minBuildings);

    /* THE SOLVER PICKED A BACKEND. "SELECTING ENGINE" is the boot state, and it is
       exactly what a reader saw for ever while the mount was dead. */
    await expect(page.locator('#simBackend')).not.toHaveText(/SELECTING ENGINE/i, { timeout: 30_000 });

    /* Say what actually went wrong, rather than leaving a timeout to be read as a
       slow machine — the misreading this repo's tier spec records. */
    expect(thrown, `${ward.name} threw during mount:\n${thrown.join('\n')}`).toEqual([]);
  });
}

test('the second city is reachable from the first without a reload', async ({ page }) => {
  /* THE SWITCH PATH, WHICH IS A DIFFERENT CODE PATH FROM THE MOUNT. Crossing
     cities is a navigation rather than an in-place swap (console-shell.ts only
     switches within one city), so this asserts the journey a reader actually
     takes: open Kolkata, choose Bengaluru, arrive somewhere that works. */
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(String(error)));

  await page.goto('/heat-map/in/kolkata/ballygunge/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.maplibregl-map')).toBeVisible({ timeout: 30_000 });

  await page.goto('/heat-map/in/bengaluru/mg-road/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.maplibregl-map')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });

  expect(thrown, `threw crossing cities:\n${thrown.join('\n')}`).toEqual([]);
});
