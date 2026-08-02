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
    const truth = await page.evaluate(() => new Intl.DateTimeFormat('en-GB',
      { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()));
    await expect(page.locator('#clockTime')).toHaveText(truth);
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
    await page.locator(dial).click();

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
      const overlaps = (a: DOMRect | null, b: DOMRect | null) =>
        !!a && !!b && !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
      return { gapToRail: c && rail ? rail.left - c.right : null, hitsBanner: overlaps(c, banner) };
    });
    // The readout is parked left of the rail so it reads as qualifying the live
    // block. It must not touch the rail, nor the honesty banner above it.
    expect(m.gapToRail).not.toBeNull();
    expect(m.gapToRail!).toBeGreaterThan(8);
    expect(m.hitsBanner).toBe(false);
  });

  test('digits and freshness bar move together', async ({ page }) => {
    await stubMet(page, 0);
    await page.goto('/heat-map/');
    await expect(page.locator(dial)).toHaveAttribute('data-age', 'fresh', { timeout: 60_000 });
    // Digits are a real ward-local clock reading, not a placeholder.
    await expect(page.locator('#clockTime')).toHaveText(/^\d{2}:\d{2}$/);
    const fresh = await page.locator('#clockBar').getAttribute('style');

    await stubMet(page, 4);
    await page.locator(dial).click();
    await expect(page.locator(dial)).toHaveAttribute('data-age', 'aging', { timeout: 60_000 });
    const aged = await page.locator('#clockBar').getAttribute('style');
    const num = (s: string | null) => Number(/scaleX\(([\d.]+)\)/.exec(s ?? '')?.[1] ?? NaN);
    // The bar drains as the reading ages — that is the whole encoding.
    expect(num(aged)).toBeLessThan(num(fresh));
  });
});
