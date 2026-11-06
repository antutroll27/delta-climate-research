import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AMSTERDAM'S CANAL RING, A GEOMETRY-TIER CITY, OPENS AND SAYS ONLY WHAT IT KNOWS (plan Task A12).
 *
 * What a browser can see that a unit test cannot:
 *   · the instrument mounts for a city that is not in India (the wiring, not the data: see heat-map-second-city.spec.ts for the scar);
 *   · 3D BAG's licence asks for its credit in the bottom-right corner of a browsable map, so the chip must carry it on a desktop AND on
 *     a phone (where the long lead is hidden by phone.css);
 *   · the geometry tier prints no accuracy band and, with no EUR cost basis adopted (plan Q1), no currency figure;
 *   · the clock zone label reads CET / CEST. `istLike` (heat-map-app.ts) rewrites only 'GMT+5:30', so this checks the label the
 *     browser's own ICU gives en-GB for Europe/Amsterdam is the abbreviation and not "GMT+1";
 *   · the reader can get here from Kolkata.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const METNO = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/metar/metno-ballygunge-20261007T0609Z.json'), 'utf8')) as {
  properties: { meta: { updated_at: string }; timeseries: { time: string }[] };
};
const PATH = '/heat-map/nl/amsterdam/canal-ring/';

/** met.no's forecast re-dated so its first hour is `firstHourIso`; the page clock follows the `Date` header like production's. */
async function stubWeather(page: Page, firstHourIso: string, serverNowIso: string) {
  const shift = Date.parse(firstHourIso) - Date.parse(METNO.properties.timeseries[0].time);
  const body = JSON.parse(JSON.stringify(METNO)) as typeof METNO;
  const move = (t: string) => new Date(Date.parse(t) + shift).toISOString().replace('.000Z', 'Z');
  body.properties.meta.updated_at = move(body.properties.meta.updated_at);
  for (const ts of body.properties.timeseries) ts.time = move(ts.time);
  await page.route(/\/api\/live\?/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { date: new Date(serverNowIso).toUTCString(), age: '0' }, body: JSON.stringify(body),
  }));
}

/* What a reader SEES on the page (innerText skips display:none), not the whole DOM: the Solar section's "Ask about this" card carries
   static yield-confidence copy (about +-10%) that Bengaluru shares and that is only on screen once that section is open. */
const visibleText = (page: Page) => page.evaluate(() => (document.querySelector('main#main') as HTMLElement | null)?.innerText ?? '');

test.describe('Amsterdam, canal ring', () => {
  test.setTimeout(360_000);

  test('mounts, credits 3D BAG at the bottom right, shows the geometry badge, and prints no band, no currency, no India AQI key', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    await stubWeather(page, '2026-07-15T12:00:00Z', '2026-07-15T12:05:00Z');
    await page.goto(PATH, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.maplibregl-map')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.maplibregl-map canvas').first()).toBeAttached({ timeout: 90_000 });
    /* measured: 21,342 footprints */
    const count = page.locator('#bcount');
    await expect(count).not.toHaveText(/^—/, { timeout: 150_000 });
    const parsed = Number(((await count.textContent()) ?? '').replace(/[^0-9]/g, ''));
    expect(parsed, `building count read "${await count.textContent()}"`).toBeGreaterThan(21_342 * 0.9);
    await expect(page.locator('#simBackend')).not.toHaveText(/SELECTING ENGINE/i, { timeout: 60_000 });

    /* THE CREDIT, bottom right, on a desktop: the chip is the only credit visible there */
    const chip = page.locator('.st-attrib .attrib');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('© 3DBAG by tudelft3d and 3DGI');
    expect(await chip.locator('.at-req').isVisible(), 'the phone-only credit is hidden on a desktop').toBe(false);
    const box = (await chip.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x + box.width, 'the chip sits in the right half').toBeGreaterThan(vp.width / 2);
    expect(box.y + box.height, 'the chip sits in the bottom half').toBeGreaterThan(vp.height / 2);
    await chip.click();
    const credits = page.locator('#v2Credits');
    await expect(credits).toBeVisible();
    await expect(credits).toContainText('3DBAG by tudelft3d and 3DGI');
    await expect(credits).toContainText('Het Waterschapshuis');
    await expect(credits).toContainText('bron: KNMI');
    await expect(credits).not.toContainText('Google Open Buildings');
    await page.locator('#v2Credits [data-pop-close]').click();

    /* THE GEOMETRY BADGE: the tier is a caveat on the City card */
    const badge = page.locator('.scope-tier.tier-geometry').first();
    await expect(badge).toHaveText('Geometry only');
    await expect(badge).toBeVisible();

    /* NO BAND, NO CURRENCY. The temperature must have painted first, or an empty readout would pass for the wrong reason. */
    await expect(page.locator('#lst')).toContainText(/\d\d\.\d|\d\.\d/, { timeout: 180_000 });
    await expect(page.locator('#conf')).toHaveText('Heat accuracy not yet validated for this city', { timeout: 30_000 });
    expect(await page.locator('#lst .band').count()).toBe(0);
    const text = await visibleText(page);
    expect(text, 'a ± reached the page').not.toContain('±');
    expect(text.match(/[€₹$£¥]|\bEUR\b|\bINR\b|\bRs\.?\s?\d/g) ?? [], 'a currency figure reached the page').toEqual([]);

    /* THE KEY: no India AQI bands on a city with no CPCB data */
    const key = await page.evaluate(() => document.getElementById('v2Key')?.textContent ?? '');
    expect(key).not.toContain('India AQI bands');
    expect(key).toContain('Red and orange belong to the heat ramp.');

    expect(thrown, `threw during mount:\n${thrown.join('\n')}`).toEqual([]);
  });

  test('the clock zone reads CEST in July and CET in January, never "GMT+"', async ({ page }) => {
    await stubWeather(page, '2026-07-15T12:00:00Z', '2026-07-15T12:05:00Z');
    await page.goto(PATH, { waitUntil: 'domcontentloaded' });
    const line = page.locator('#wxLine');
    await expect(line).toContainText('Met Norway forecast', { timeout: 180_000 });
    await expect(line).toContainText('14:00 CEST');
    expect(await line.textContent()).not.toMatch(/GMT\+/);
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Met Norway forecast');
    /* the ward-clock tooltip names the zone it reads in */
    await expect(page.locator('#clockw')).toHaveAttribute('title', /Europe\/Amsterdam/);
  });

  test('January: the same label reads CET', async ({ page }) => {
    await stubWeather(page, '2027-01-15T12:00:00Z', '2027-01-15T12:05:00Z');
    await page.goto(PATH, { waitUntil: 'domcontentloaded' });
    const line = page.locator('#wxLine');
    await expect(line).toContainText('Met Norway forecast', { timeout: 180_000 });
    await expect(line).toContainText('13:00 CET');
    expect(await line.textContent()).not.toMatch(/GMT\+|CEST/);
  });

  test('Kolkata reaches Amsterdam through the country switcher, and the single-area city hides nothing it should not', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    await page.goto('/heat-map/in/kolkata/ballygunge/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.maplibregl-map')).toBeVisible({ timeout: 30_000 });
    /* the Netherlands is offered because it draws */
    const option = page.locator('select[data-scope="country"] option[value="nl/amsterdam/canal-ring"]');
    await expect(option).toHaveText('Netherlands');
    await Promise.all([
      page.waitForURL(/\/heat-map\/nl\/amsterdam\/canal-ring\/?$/, { timeout: 180_000 }),
      page.evaluate(() => {
        const sel = document.querySelector<HTMLSelectElement>('select[data-scope="country"]')!;
        sel.value = 'nl/amsterdam/canal-ring';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    ]);
    await expect(page.locator('.maplibregl-map')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 180_000 });
    /* and the page declares itself noindex (the founder decides indexing after review) */
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    expect(thrown, `threw crossing cities:\n${thrown.join('\n')}`).toEqual([]);
  });
});

test.describe('Amsterdam on a phone', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the chip keeps "© 3DBAG" where the long lead is hidden', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('obos:entry-note-seen', '1'); sessionStorage.setItem('obos:rotate-nudge-dismissed', '1'); } catch { /* none */ } });
    await page.goto(PATH, { waitUntil: 'domcontentloaded' });
    const chip = page.locator('.attrib').first();
    await expect(chip).toBeVisible({ timeout: 90_000 });
    await expect(chip.locator('.at-lead')).toBeHidden();
    await expect(chip.locator('.at-req')).toBeVisible();
    await expect(chip.locator('.at-req')).toHaveText('© 3DBAG');
    /* the chip's own "© " must not stack in front of it: "© 3DBAG · Credits", not "© © 3DBAG" */
    const before = await chip.evaluate((el) => getComputedStyle(el, '::before').content);
    expect(before === 'none' || before === 'normal' || before === '""', `chip ::before is ${before}`).toBe(true);
  });
});
