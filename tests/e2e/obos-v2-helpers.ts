// tests/e2e/obos-v2-helpers.ts
import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'tests/fixtures/metar');
export const METAR = JSON.parse(readFileSync(join(FIX, 'metar-20261007T0609Z.json'), 'utf8')) as { icaoId: string; rawOb: string }[];
export const METNO = readFileSync(join(FIX, 'metno-ballygunge-20261007T0609Z.json'), 'utf8');

/** The observed-weather spec's stub (heat-map-observed-weather.spec.ts:22–39), parameterised. */
export async function stubWeather(page: Page, serverNow: string, reports: readonly { icao: string; raw: string }[] | null = null): Promise<void> {
  await page.route(/\/api\/live\?/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { date: new Date(serverNow).toUTCString(), age: '0' }, body: METNO,
  }));
  await page.route(/\/api\/metar\?/, (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids')?.split(',') ?? [];
    const list = reports ?? METAR.map((r) => ({ icao: r.icaoId, raw: r.rawOb }));
    void route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { date: new Date(serverNow).toUTCString() },
      body: JSON.stringify({ source: 'aviationweather.gov', fetchedAt: '2026-10-07T06:09:00.000Z',
        reports: list.filter((r) => ids.includes(r.icao)) }),
    });
  });
}

/** A fixed instant and a synthetic met.no reading at it; /api/metar stays the server's canned empty list. */
export async function stubAt(page: Page, iso: string): Promise<void> {
  await page.clock.setFixedTime(new Date(iso));
  await page.route(/\/api\/live\?/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { date: new Date(iso).toUTCString(), age: '0' },
    body: JSON.stringify({ properties: { timeseries: [{ time: `${iso.slice(0, 14)}00:00Z`, data: { instant: { details: {
      air_temperature: 30.0, relative_humidity: 65, wind_speed: 2.4, cloud_area_fraction: 20 } } } }] } }),
  }));
}

export async function openV2(page: Page, path = '/heat-map/in/kolkata/ballygunge/'): Promise<void> {
  await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'v2');
  await expect(page.locator('main.obos-v2')).toHaveCount(1);
  if (path.includes('/in/')) {
    await expect(page.locator('#simBackend')).not.toHaveText('SELECTING ENGINE', { timeout: 60_000 });
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
  }
}

export async function duplicateIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const e of document.querySelectorAll('[id]')) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
}

/** Visible text of a node, as a sighted reader gets it (innerText drops display:none). */
export const visibleText = (page: Page, sel: string): Promise<string> =>
  page.locator(sel).evaluate((e) => (e as HTMLElement).innerText);
