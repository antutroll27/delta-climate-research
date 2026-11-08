import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Kolkata at night: the airport reads warmer than the air the model was calibrated on, so the
 * model is given the reading less the measured November offset (src/data/night-air-correction.ts),
 * while the air tile keeps showing what the airport reported. By day nothing is adjusted.
 * Evidence: docs/evidence/2026-11-08-kolkata-night-air-correction.md. The page's clock is moved by
 * the `Date` header, as in heat-map-observed-weather.spec.ts.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'tests/fixtures/metar');
const METNO = readFileSync(join(FIX, 'metno-ballygunge-20261007T0609Z.json'), 'utf8');
const NIGHT = { now: '2025-11-10T20:05:00Z', raw: 'VECC 102000Z 02004KT 2500 HZ NSC 21/17 Q1015 NOSIG' };
const DAY = { now: '2025-11-10T06:05:00Z', raw: 'VECC 100600Z 02004KT 3000 HZ NSC 31/16 Q1012 NOSIG' };

async function stub(page: Page, s: { now: string; raw: string }) {
  await page.route(/\/api\/live\?/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { date: new Date(s.now).toUTCString(), age: '0' }, body: METNO,
  }));
  await page.route(/\/api\/metar\?/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { date: new Date(s.now).toUTCString() },
    body: JSON.stringify({ source: 'aviationweather.gov', fetchedAt: new Date(s.now).toISOString(),
      reports: [{ icao: 'VECC', raw: s.raw }] }),
  }));
}

test.describe('Kolkata night air', () => {
  test.setTimeout(180_000);

  test('at night the tile shows the airport, the line says the map uses lower air', async ({ page }) => {
    await stub(page, NIGHT);
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Dum Dum airport (16 km)', { timeout: 60_000 });
    await expect(page.locator('#liveT')).toHaveText('21');
    await expect(page.locator('#wxLine')).toContainText(/Map uses air [34]\.\d °C below the airport at night \(calibration\) · may differ over the ward/);
  });

  test('at night, choosing the 13:00 or 22:00 scenario drops the line: the offset is the Now view\'s only', async ({ page }) => {
    await stub(page, NIGHT);
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#wxLine')).toContainText('below the airport at night', { timeout: 60_000 });
    /* the control may be hidden in the v2 shell; the handler is the thing under test */
    const press = (id: string) => page.evaluate((p) => (document.querySelector(`#segPhase button[data-p="${p}"]`) as HTMLElement).click(), id);
    for (const id of ['peak', 'night']) {
      await press(id);
      await expect(page.locator('#wxLine')).not.toContainText('below the airport');
    }
    await press('now');
    await expect(page.locator('#wxLine')).toContainText('below the airport at night');
  });

  test('by day nothing is adjusted and nothing is said', async ({ page }) => {
    await stub(page, DAY);
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Dum Dum airport (16 km)', { timeout: 60_000 });
    await expect(page.locator('#liveT')).toHaveText('31');
    await expect(page.locator('#wxLine')).not.toContainText('below the airport');
  });
});
