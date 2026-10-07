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
      '🌧Light rain at Dum Dum airport (16 km) at 11:30 IST · surfaces cooling · may differ over the ward');
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

  test('a feed that froze in the rain hands "now" to met.no, still drying — not snapped dry', async ({ page }) => {
    // 2 h after the newest report (06:00Z, -RA): past the 90-minute limit
    await stub(page, '2026-10-07T08:05:00Z');
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    /* the reading itself first: a source label alone can be read before any reading lands */
    await expect(page.locator('#liveT')).toHaveText('32.0', { timeout: 60_000 });
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Met Norway forecast');
    await expect(page.locator('#wxLine')).toContainText('no airport report in 90 min · surfaces drying after rain');
    await expect(page.locator('#conf')).toContainText('Outside validation · wet surfaces');
    // the defect was 46.7 here; drying from wet leaves it well short of the dry model
    await expect.poll(() => surfaceMean(page), { timeout: 60_000 }).toBeLessThan(42);
  });

  test('hours later the rain is spent: met.no, dry, with its band back', async ({ page }) => {
    await stub(page, '2026-10-07T11:00:00Z');
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#liveT')).toHaveText('32.0', { timeout: 60_000 });
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Met Norway forecast');
    await expect(page.locator('#wxLine')).not.toContainText('drying');
    await expect(page.locator('#conf')).not.toContainText('Outside validation');
  });

  test('the page takes its clock from /api/metar when met.no is down', async ({ page }) => {
    // met.no fails, so the only Date header the page sees is the airport function's
    await page.route(/\/api\/live\?/, (route) => route.fulfill({ status: 502, body: '{"error":"x"}' }));
    await page.route(/\/api\/metar\?/, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { date: new Date('2026-10-07T06:05:00Z').toUTCString(), age: '0' },
      body: JSON.stringify({ source: 'aviationweather.gov', fetchedAt: '2026-10-07T06:09:00.000Z',
        reports: METAR.filter((r) => r.icaoId === 'VECC').map((r) => ({ icao: r.icaoId, raw: r.rawOb })) }),
    }));
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    // judged on the visitor's clock the 06:00Z report would be stale; on the server's it is 5 min old
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Dum Dum airport (16 km)', { timeout: 60_000 });
    await expect(page.locator('#liveT')).toHaveText('31');
  });

  test('no airport answer at all: met.no, as before', async ({ page }) => {
    await page.route(/\/api\/live\?/, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { date: new Date('2026-10-07T06:05:00Z').toUTCString(), age: '0' }, body: METNO,
    }));
    await page.route(/\/api\/metar\?/, (route) => route.fulfill({ status: 502, body: '{"error":"x"}' }));
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    /* the reading itself first: a source label alone can be read before any reading lands */
    await expect(page.locator('#liveT')).toHaveText('32.0', { timeout: 60_000 });
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Met Norway forecast');
  });

  test('Bengaluru reads the nearer airport, HAL, with its distance', async ({ page }) => {
    await stub(page, '2026-10-07T06:05:00Z');
    await page.goto('/heat-map/in/bengaluru/indiranagar/');
    await expect(page.locator('#liveSrc')).toHaveText('Air now · HAL airport (4 km)', { timeout: 60_000 });
    await expect(page.locator('#liveT')).toHaveText('28');
    await expect(page.locator('#wxLine')).toContainText('Partly cloudy at HAL airport (4 km) at 11:30 IST');
    // SCT012 through Kasten & Czeplak is not the calibrated physics: no band may be printed over it
    await expect(page.locator('#conf')).toHaveText('Outside validation · station cloud');
    await expect(page.locator('#lst .band')).toHaveCount(0);
    // ...and the 13:00 scenario runs the calibrated physics, so its band comes back
    await page.locator('#segPhase button[data-p="peak"]').click();
    await expect(page.locator('#conf')).not.toContainText('Outside validation', { timeout: 30_000 });
    await expect(page.locator('#lst .band')).toHaveCount(1);
  });
});
