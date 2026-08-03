import { expect, test } from '@playwright/test';

/**
 * The live-ambient reading sets the simulation's boundary conditions, and it
 * used to be fetched once per ward per session and never again — a tab left open
 * overnight kept a pulsing green "live" dot over the previous evening's weather.
 *
 * These tests pin the honesty rule that fixes it: the page may only CLAIM the
 * reading is live while it still is, and the reader must be able to act on that.
 *
 * met.no is stubbed so age is deterministic. Asserting against the real API
 * would make the suite depend on Norwegian weather and on being online, and the
 * thing under test is our arithmetic, not their forecast.
 */
const CANNED = {
  air_temperature: 29.4, relative_humidity: 71,
  wind_speed: 2.4, cloud_area_fraction: 38,
};

/** Serve a reading valid `hoursAgo` hours ago, on the hour as met.no does. */
async function stubMet(page: import('@playwright/test').Page, hoursAgo: number, temp = CANNED.air_temperature) {
  const time = `${new Date(Date.now() - hoursAgo * 3600_000).toISOString().slice(0, 14)}00:00Z`;
  await page.route('**/api.met.no/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      properties: { timeseries: [{ time, data: { instant: { details: { ...CANNED, air_temperature: temp } } } }] },
    }),
  }));
}

const dial = '#clockw';

test.describe('live reading freshness', () => {
  // The instrument builds a ward before any of this exists; the GPU-less CI
  // runner needs room for that (see runtime-performance.spec.ts).
  test.setTimeout(180_000);

  test('a fresh reading is shown as fresh, and the dot may say live', async ({ page }) => {
    await stubMet(page, 0);
    await page.goto('/heat-map/');
    await expect(page.locator(dial)).toHaveAttribute('data-age', 'fresh', { timeout: 60_000 });
    await expect(page.locator('#livedot')).toHaveClass(/\bon\b/);
    // The tooltip must say what the readout is NOT, because big digits read as
    // "the map's time" unless something says otherwise.
    await expect(page.locator(dial)).toHaveAttribute('title', /not a time of day/);
    // The big digits are the WARD's clock — they must agree with the zone, not
    // with the reading's validity hour (that mismatch is what read as broken).
    // Twelve-hour is the default face, and the meridiem lives in the stacked
    // pair beside it, so the digits themselves must carry NO am/pm suffix.
    const truth = await page.evaluate(() => new Intl.DateTimeFormat('en-US',
      { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hourCycle: 'h12' })
      .formatToParts(new Date())
      .filter(t => t.type === 'hour' || t.type === 'minute' || t.type === 'literal')
      .map(t => t.value).join('').trim());
    await expect(page.locator('#clockTime')).toHaveText(truth);
    await expect(page.locator('#clockTime')).not.toHaveText(/[AP]M/i);
    // Exactly one of the meridiem pair is lit — the whole point of stacking both.
    await expect(page.locator('#clockw .k-mer.on')).toHaveCount(1);
  });

  test('an overnight-stale reading loses the live claim', async ({ page }) => {
    await stubMet(page, 9);
    await page.goto('/heat-map/');
    await expect(page.locator(dial)).toHaveAttribute('data-age', 'stale', { timeout: 60_000 });
    await expect(page.locator('#clockAgeLab')).toHaveText('read 9h ago');
    // The whole point: the page stops asserting "live" once it isn't.
    await expect(page.locator('#livedot')).not.toHaveClass(/\bon\b/);
  });

  test('activating the dial re-reads and re-drives the simulation', async ({ page }) => {
    await stubMet(page, 6.5, 24.0);
    await page.goto('/heat-map/');
    await expect(page.locator(dial)).toHaveAttribute('data-age', 'stale', { timeout: 60_000 });
    await expect(page.locator('#liveT')).toHaveText('24.0');

    await stubMet(page, 0, 33.7);          // fresher weather is now available
    // The re-read lives on the age line, not the whole tile: the face owns the
    // 12/24-hour toggle. Clicking the shell must NOT be what refreshes.
    await page.locator('#clockAge').click();

    await expect(page.locator(dial)).toHaveAttribute('data-age', 'fresh', { timeout: 60_000 });
    // Not just the label — the forcing that feeds the sim actually changed.
    await expect(page.locator('#liveT')).toHaveText('33.7');
    await expect(page.locator('#livedot')).toHaveClass(/\bon\b/);
  });

  test('the readout clears the evidence rail it sits beside', async ({ page }) => {
    await stubMet(page, 0);
    await page.goto('/heat-map/');
    await expect(page.locator(dial)).toBeVisible({ timeout: 60_000 });
    const m = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
      const c = box('.clockw'), rail = box('.rail-r'), banner = box('.synthetic');
      return {
        gapToRail: c && rail ? rail.left - c.right : null,
        // The banner is centred and grows with its own text, so at narrower
        // widths it reaches UNDER this readout horizontally. Only the vertical
        // gap separates them, which makes that gap the thing to assert.
        gapBelowBanner: c && banner ? c.top - banner.bottom : null,
      };
    });
    expect(m.gapToRail).not.toBeNull();
    expect(m.gapToRail!).toBeGreaterThan(8);
    // A MARGIN, NOT MERE NON-OVERLAP. This first shipped with 3px of clearance,
    // which passed on macOS and collided on CI's Linux font metrics — the
    // banner renders a hair taller there. Anything under ~10px is luck, and a
    // test that only forbids overlap would have let it through again.
    expect(m.gapBelowBanner).not.toBeNull();
    expect(m.gapBelowBanner!).toBeGreaterThan(10);
  });

  test('the face toggles 12/24-hour, remembers it, and never re-fetches', async ({ page }) => {
    // THE TILE CARRIES TWO ACTIONS AND THEY MUST NOT BLEED. The face changes how
    // the time is written; the age line goes to the network. Before the split
    // there was one button and the re-read was the only way to refresh a stale
    // reading — so a toggle that quietly ate that click would leave a dial
    // reporting 14-hour-old data with no way to fix it.
    let met = 0;
    await page.route('**/api.met.no/**', (r) => { met += 1; r.continue(); });
    await stubMet(page, 0, 33.7);
    await page.goto('/heat-map/');
    await expect(page.locator(dial)).toHaveAttribute('data-h12', 'true', { timeout: 60_000 });
    await expect(page.locator('#clockFace')).toHaveAttribute('aria-pressed', 'false');

    const afterLoad = met;
    await page.locator('#clockFace').click();
    await expect(page.locator(dial)).toHaveAttribute('data-h12', 'false');
    await expect(page.locator('#clockFace')).toHaveAttribute('aria-pressed', 'true');
    // 24-hour is zero-padded, and the meridiem pair is REPLACED rather than
    // dimmed — a greyed "AM" beside a 24-hour readout would be stating a
    // half-truth about a clock that no longer has halves.
    await expect(page.locator('#clockTime')).toHaveText(/^\d{2}:\d{2}$/);
    await expect(page.locator('#clock24')).toBeVisible();
    await expect(page.locator('#clockAm')).toBeHidden();
    await expect(page.locator('#clockPm')).toBeHidden();
    expect(met, 'the format toggle must be a pure re-render').toBe(afterLoad);

    // ...and back again.
    await page.locator('#clockFace').click();
    await expect(page.locator(dial)).toHaveAttribute('data-h12', 'true');
    await expect(page.locator('#clockTime')).toHaveText(/^\d{1,2}:\d{2}$/);
    await expect(page.locator('#clock24')).toBeHidden();

    // The choice is about the reader, not the visit, so it outlives a reload.
    await page.locator('#clockFace').click();
    await page.reload();
    await expect(page.locator(dial)).toHaveAttribute('data-h12', 'false', { timeout: 60_000 });
  });

  test('digits and freshness bar move together', async ({ page }) => {
    await stubMet(page, 0);
    await page.goto('/heat-map/');
    await expect(page.locator(dial)).toHaveAttribute('data-age', 'fresh', { timeout: 60_000 });
    // Digits are a real ward-local clock reading, not a placeholder.
    await expect(page.locator('#clockTime')).toHaveText(/^\d{1,2}:\d{2}$/);
    const fresh = await page.locator('#clockBar').getAttribute('style');

    await stubMet(page, 4);
    // The age line, not the tile: since the face took over the 12/24-hour
    // toggle, a click on the shell refreshes nothing.
    await page.locator('#clockAge').click();
    await expect(page.locator(dial)).toHaveAttribute('data-age', 'aging', { timeout: 60_000 });
    const aged = await page.locator('#clockBar').getAttribute('style');
    const num = (s: string | null) => Number(/scaleX\(([\d.]+)\)/.exec(s ?? '')?.[1] ?? NaN);
    // The bar drains as the reading ages — that is the whole encoding.
    expect(num(aged)).toBeLessThan(num(fresh));
  });
});

test.describe('the now phase', () => {
  test.setTimeout(180_000);

  test('Now labels itself, and reads sanely against the air temperature', async ({ page }) => {
    await stubMet(page, 0);
    await page.goto('/heat-map/');
    await expect(page.locator('#clockw')).toBeVisible({ timeout: 60_000 });

    // The page now OPENS live: the reading agrees with the clock beside it
    // rather than being a 13:00 scenario the reader has to infer.
    await expect(page.locator('#lstPhase')).toHaveText('modelled now');
    await expect(page.locator('#segPhase button[data-p="now"]')).toHaveClass(/\bon\b/);

    // The scenarios are still one click away, and still label themselves.
    await page.locator('#segPhase button[data-p="peak"]').click();
    await expect(page.locator('#lstPhase')).toHaveText('modelled at 13:00', { timeout: 60_000 });
    await page.locator('#segPhase button[data-p="now"]').click();
    await expect(page.locator('#lstPhase')).toHaveText('modelled now', { timeout: 60_000 });

    // Whatever hour the suite runs at, "now" must sit within a physically
    // sane distance of the observed air temperature — the failure this guards
    // is the 13:00 scenario leaking into the live view.
    const [air, lst] = await Promise.all([
      page.locator('#liveT').textContent(),
      page.locator('#lst').textContent(),
    ]);
    const a = Number(air), t = Number(/(-?\d+\.\d+)/.exec(lst ?? '')?.[1]);
    expect(Number.isFinite(a) && Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(a - 6);
    expect(t).toBeLessThan(a + 22);   // midday surfaces run hot; 3am ones do not

    // The confidence chip must still be making a claim, of some kind.
    await expect(page.locator('#conf')).not.toBeEmpty();
  });
});
