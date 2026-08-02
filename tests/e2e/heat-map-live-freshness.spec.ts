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
    // The tooltip must say what the dial is NOT, because a dial reads as a clock.
    await expect(page.locator(dial)).toHaveAttribute('title', /not the map’s time of day/);
  });

  test('an overnight-stale reading loses the live claim', async ({ page }) => {
    await stubMet(page, 9);
    await page.goto('/heat-map/');
    await expect(page.locator(dial)).toHaveAttribute('data-age', 'stale', { timeout: 60_000 });
    await expect(page.locator('#clockAgeLab')).toHaveText('9h');
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

  test('the dial does not collide with the compass beneath it', async ({ page }) => {
    await stubMet(page, 0);
    await page.goto('/heat-map/');
    await expect(page.locator(dial)).toBeVisible({ timeout: 60_000 });
    const gap = await page.evaluate(() => {
      const lab = document.querySelector('.k-age-lab')?.getBoundingClientRect();
      const comp = document.querySelector('.compass')?.getBoundingClientRect();
      return lab && comp ? comp.top - lab.bottom : null;
    });
    // Measured at 13px; it was -5 (overlapping) before the position was fixed.
    expect(gap).not.toBeNull();
    expect(gap!).toBeGreaterThan(4);
  });
});
