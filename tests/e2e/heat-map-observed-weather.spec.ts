import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * "Now" from the airport — 2026-10-07, the morning OBOS drew a 46.7 °C surface in
 * the rain. Both feeds are stubbed with what they actually said that morning
 * (tests/fixtures/metar): met.no's forecast (fair, 13 % cloud) and the airports'
 * METARs (VECC: -RA SCT018 FEW025CB BKN100 31/23 at 0600Z).
 *
 * THE PAGE'S CLOCK IS MOVED BY THE `Date` HEADER, the same way production corrects
 * a wrong device clock (heat-map-app.ts `clockSkewMs`): /api/live is served with
 * that morning's date, so the sun, the report's age and the rain's duration are all
 * computed for that morning without touching the browser's own clock.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'tests/fixtures/metar');
const METAR = JSON.parse(readFileSync(join(FIX, 'metar-20261007T0609Z.json'), 'utf8')) as { icaoId: string; rawOb: string }[];
const METNO = readFileSync(join(FIX, 'metno-ballygunge-20261007T0609Z.json'), 'utf8');

async function stub(page: Page, serverNow: string) {
  await page.route(/\/api\/live\?/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { date: new Date(serverNow).toUTCString(), age: '0' }, body: METNO,
  }));
  await page.route(/\/api\/metar\?/, (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids')?.split(',') ?? [];
    route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { date: new Date(serverNow).toUTCString() },
      body: JSON.stringify({
        source: 'aviationweather.gov', fetchedAt: '2026-10-07T06:09:00.000Z',
        reports: METAR.filter((r) => ids.includes(r.icaoId)).map((r) => ({ icao: r.icaoId, raw: r.rawOb })),
      }),
    });
  });
}

const surfaceMean = async (page: Page) => Number.parseFloat((await page.locator('#lst').textContent()) ?? 'NaN');

test.describe('observed weather', () => {
  test.setTimeout(180_000);

  test('Kolkata in the rain: air leads, the surface is labelled and near air, the rain is said', async ({ page }) => {
    await stub(page, '2026-10-07T06:05:00Z');
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Dum Dum airport (16 km)', { timeout: 60_000 });
    // a METAR carries whole degrees; "31.0" would claim a tenth it does not have
    await expect(page.locator('#liveT')).toHaveText('31');
    const line = page.locator('#wxLine');
    await expect(line).toHaveText(
      '🌧Light rain at Dum Dum airport (16 km) · observed 11:30 IST · surfaces cooling · conditions over the ward may differ');
    // the pictograph has a name
    await expect(line.locator('[role="img"]')).toHaveAttribute('aria-label', 'Rain');
    // no published band covers a wet ward, and the chip says so
    await expect(page.locator('#conf')).toContainText('Outside validation · wet surfaces');
    // READ ORDER: air, then the labelled surface, then the weather line
    const order = await page.evaluate(() => ['liveT', 'liveFeel', 'lst', 'wxLine']
      .map((id) => document.getElementById(id)!)
      .every((e, i, a) => i === 0 || (a[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)));
    expect(order).toBe(true);
    await expect(page.locator('.metric .k', { hasText: 'Ground & rooftop surface' })).toBeVisible();
    // and the number itself: near the 31 °C air, nowhere near 46.7
    await expect.poll(() => surfaceMean(page), { timeout: 60_000 }).toBeLessThan(36);
    expect(await surfaceMean(page)).toBeGreaterThan(30);
  });

  test('a stale report hands "now" back to met.no, and says so', async ({ page }) => {
    // 2 h after the newest report: past the 90-minute limit
    await stub(page, '2026-10-07T08:05:00Z');
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Met Norway forecast', { timeout: 60_000 });
    await expect(page.locator('#liveT')).toHaveText('32.0');
    await expect(page.locator('#wxLine')).toContainText('no airport report in the last 90 min');
    await expect(page.locator('#conf')).not.toContainText('wet surfaces');
  });

  test('no airport answer at all: met.no, as before', async ({ page }) => {
    await page.route(/\/api\/live\?/, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { date: new Date('2026-10-07T06:05:00Z').toUTCString(), age: '0' }, body: METNO,
    }));
    await page.route(/\/api\/metar\?/, (route) => route.fulfill({ status: 502, body: '{"error":"x"}' }));
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Met Norway forecast', { timeout: 60_000 });
    await expect(page.locator('#liveT')).toHaveText('32.0');
  });

  test('Bengaluru reads the nearer airport, HAL, with its distance', async ({ page }) => {
    await stub(page, '2026-10-07T06:05:00Z');
    await page.goto('/heat-map/in/bengaluru/indiranagar/');
    await expect(page.locator('#liveSrc')).toHaveText('Air now · HAL airport (4 km)', { timeout: 60_000 });
    await expect(page.locator('#liveT')).toHaveText('28');
    await expect(page.locator('#wxLine')).toContainText('Partly cloudy at HAL airport (4 km) · observed 11:30 IST');
  });
});
