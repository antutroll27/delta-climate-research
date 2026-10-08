import { expect, test } from '@playwright/test';

/**
 * THE DRY-SEASON CAVEAT reaches the readout (2026-10-05).
 *
 * Pre-monsoon night runs warm of ECOSTRESS by more than the published ±3.0 K night
 * band (accuracy.ts SEASONAL_CAVEATS, read from data/calibration/seasonal-caveat.json).
 * Since the ventilation damping came out, the daytime band holds in every season,
 * so an April NOON must show nothing while an April NIGHT shows the caveat. The
 * caveat is keyed on the ward's own calendar month, so the clock is stubbed, and
 * /api/live is stubbed to the same instant so the page stays in its live "now" view.
 */
async function at(page: import('@playwright/test').Page, iso: string) {
  await page.clock.setFixedTime(new Date(iso));
  await page.route(/\/api\/live\?/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { date: new Date(iso).toUTCString(), age: '0' },
    body: JSON.stringify({
      properties: { timeseries: [{ time: `${iso.slice(0, 14)}00:00Z`, data: { instant: { details: {
        air_temperature: 30.0, relative_humidity: 65, wind_speed: 2.4, cloud_area_fraction: 20,
      } } } }] },
    }),
  }));
}

test.describe('the seasonal caveat', () => {
  test.setTimeout(180_000);

  test('an April night in Ballygunge says the reading runs warm', async ({ page }) => {
    await at(page, '2026-04-15T17:30:00Z');          // 23:00 IST
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    const note = page.locator('#seasonNote');
    await expect(note).toBeVisible({ timeout: 60_000 });
    await expect(note).toHaveText(/^Dry-season reading: the modelled surface runs at night ~\d\.\d–\d\.\d °C warm in Mar–Apr against ECOSTRESS$/);
    await expect(page.locator('#conf')).toContainText('dry-season warm');
    await expect(page.locator('#conf')).toHaveAttribute('title', /outside the published ±3\.0 K band/);
    await page.locator('.metric:has(#lst)').screenshot({ path: test.info().outputPath('april-night-readout.png') });
  });

  test('an April noon carries no caveat: the daytime band holds', async ({ page }) => {
    await at(page, '2026-04-15T06:30:00Z');          // 12:00 IST
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#conf')).not.toBeEmpty({ timeout: 60_000 });
    await expect(page.locator('#seasonNote')).toBeHidden();
    await expect(page.locator('#conf')).not.toContainText('dry-season');
  });

  test('an October night carries no caveat', async ({ page }) => {
    await at(page, '2026-10-15T17:30:00Z');
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#conf')).not.toBeEmpty({ timeout: 60_000 });
    await expect(page.locator('#seasonNote')).toBeHidden();
    await expect(page.locator('#conf')).not.toContainText('dry-season');
  });
});
