import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

/**
 * WHOLE-CITY STREAMING, THE WALK (city-streaming integration). Skipped unless OBOS_STREAM_URL names a server running a build made
 * with PUBLIC_OBOS_STREAM_DEV=1 with the area data beside it (playwright.stream.config.ts starts one).
 *
 * Opens Canal Ring with ?stream=1 and walks E4 -> F4 -> F5 -> E5 by PANNING the map, then E5 -> E4 through the PICKER (a real click on the
 * chip and then on the cell). On every arrival it asserts what the person sees: the page header names the area (name from area-names.json,
 * its code beside it), the Area select names it, the address carries `area=<code>`, the drawn building count is the area's own, the loader
 * (if it was shown) has ended, no screen text says "sheet", and the page has thrown nothing. Then the picker sends the camera to G5 under a
 * held network so the rise and the plate are on screen for the screenshots.
 *
 * "The loader appeared and ended": it ENDED on every arrival. It APPEARED on every arrival whose data was not already resident; an area the
 * manager had already fetched (the one heading-prefetched area, a neighbour it still held) opens inside its quiet window and, by design,
 * never draws a loader. The test records which it was and fails if an arrival with nothing resident drew none.
 */
const BASE = process.env.OBOS_STREAM_URL;
const SHOTS = process.env.OBOS_STREAM_SHOTS ?? '/Volumes/PortableSSD/OBOS Lab/previews/city-streaming/int';
const TIER = process.env.OBOS_STREAM_TIER;                    // optional ?streamtier=
const HOLD_MS = Number(process.env.OBOS_WALK_HOLD_MS ?? 2_400);
const centre = (lon: number, lat: number) => ({ lon, lat });
const D_LAT = 0.025330197213674, D_LON = 0.041190546565045;
const AREA = {
  E4: { ...centre(4.885, 52.364), id: 'canal-ring' },
  F4: { ...centre(4.885 + D_LON, 52.364), id: 'ams-f4' },
  F5: { ...centre(4.885 + D_LON, 52.364 - D_LAT), id: 'ams-f5' },
  E5: { ...centre(4.885, 52.364 - D_LAT), id: 'ams-e5' },
  G5: { ...centre(4.885 + 2 * D_LON, 52.364 - D_LAT), id: 'ams-g5' },
} as const;
type Code = keyof typeof AREA;

const names = JSON.parse(readFileSync(new URL('../../data/cities/amsterdam/area-names.json', import.meta.url), 'utf8')).areas as Record<string, { name: string }>;
const build = JSON.parse(readFileSync(new URL('../../data/cities/amsterdam/sheets-build.json', import.meta.url), 'utf8')).sheets as Array<{ code: string; buildings: number }>;
const drawnOf = (code: string): number => build.find((s) => s.code === code)!.buildings;

interface Report { current: string | null; displayed: string | null; open: string | null; resident: string[]; massing: string[]; switches: number; modelMB: number; ceilingMB: number }
const report = (page: Page): Promise<Report | null> => page.evaluate(() => (window as unknown as { __obosStream?: { report(): unknown } }).__obosStream?.report() as Report | null ?? null);

test.describe.configure({ timeout: 420_000 });

/** Samples the loader's three faces every 25 ms from the first frame, so a loader that was up for half a second is seen however the test polls. */
async function watchLoader(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { rise: false, plate: false, sweep: false };
    (window as unknown as { __cl: unknown }).__cl = seen;
    setInterval(() => {
      if (document.querySelector('.cl-chip.on')) seen.rise = true;
      if (document.querySelector('.cl-plate.on')) seen.plate = true;
      if (document.querySelector('.cl-sweep.on')) seen.sweep = true;
    }, 25);
  });
}
const loaderSeen = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __cl: { rise: boolean; plate: boolean; sweep: boolean } }).__cl }));
const resetLoaderSeen = (page: Page) => page.evaluate(() => { const s = (window as unknown as { __cl: Record<string, boolean> }).__cl; s.rise = s.plate = s.sweep = false; });
const loaderOn = (page: Page) => page.evaluate(() => !!document.querySelector('.cl-chip.on, .cl-plate.on, .cl-sweep.on'));

async function arrived(page: Page, code: Code, thrown: string[], how: string, wasResident: boolean): Promise<void> {
  await expect.poll(async () => (await report(page))?.displayed, { timeout: 150_000, message: `${how}: ${code} is displayed` }).toBe(code);
  await expect.poll(() => loaderOn(page), { timeout: 30_000, message: `${how}: the loader has ended` }).toBe(false);
  await expect.poll(() => page.evaluate(() => document.getElementById('pname')?.textContent ?? ''), { message: `${how}: the header names ${code}` }).toContain(names[code]!.name);
  const header = await page.evaluate(() => ({ pname: document.getElementById('pname')?.textContent ?? '', pzone: document.getElementById('pzone')?.textContent ?? '', crumb: document.getElementById('crumbArea')?.textContent ?? '', explore: document.querySelector('[data-side-pane="explore"] .sp-head h2')?.textContent ?? '' }));
  expect(header.pname, `${how}: header code`).toContain(code);
  expect(header.pzone, `${how}: header zone`).toContain(`Area ${code}`);
  expect(header.crumb).toBe(names[code]!.name);
  expect(header.explore, 'the panel says "area", not "ward"').toBe('Explore the area');
  const select = await page.evaluate(() => {
    const s = document.querySelector<HTMLSelectElement>('select[data-scope="area"]');
    return { value: s?.value ?? '', text: s?.selectedOptions[0]?.textContent ?? '', visible: document.querySelector('[data-select-field] .field-value-text, [data-select-field] [data-select-value]')?.textContent ?? null };
  });
  expect(select.value, `${how}: Area select value`).toMatch(new RegExp(`/${AREA[code].id}$`));
  expect(select.text, `${how}: Area select text`).toContain(names[code]!.name);
  expect(new URL(page.url()).searchParams.get('area'), `${how}: the address`).toBe(code);
  await expect.poll(() => page.evaluate(() => document.getElementById('bcount')?.textContent ?? ''), { timeout: 20_000, message: `${how}: drawn count` }).toContain(drawnOf(code).toLocaleString('en-US'));
  const words = await page.evaluate(() => [...document.querySelectorAll('.st-title, .si-host, .cl, #pname, #pzone')].map((n) => (n as HTMLElement).innerText ?? n.textContent ?? '').join('\n'));
  expect(words, `${how}: no screen text says "sheet"`).not.toMatch(/\bsheets?\b/i);
  const seen = await loaderSeen(page);
  const appeared = seen.rise || seen.plate || seen.sweep;
  console.log(`[walk] ${how}: ${code} shown; loader appeared=${appeared} ${JSON.stringify(seen)}; resident before=${wasResident}`);
  if (!wasResident) expect(appeared, `${how}: ${code} had nothing resident, so its loader must have been drawn`).toBe(true);
  expect(thrown, `page errors: ${thrown.join(' | ')}`).toEqual([]);
}

async function panTo(page: Page, code: Code): Promise<void> {
  const c = AREA[code];
  await page.evaluate(({ lon, lat }) => {
    const map = (window as unknown as { __obosStream: { map: { easeTo(o: unknown): void } } }).__obosStream.map;
    map.easeTo({ center: [lon, lat], duration: 1_800 });
  }, { lon: c.lon, lat: c.lat });
}

for (const viewport of [{ width: 390, height: 844, tag: 'phone', tier: 'low' as string | undefined }, { width: 1440, height: 900, tag: 'desktop', tier: TIER }]) {
  test(`streaming walk E4 -> F4 -> F5 -> E5 by panning, E4 by the picker: ${viewport.tag}`, async ({ page }) => {
    test.skip(!BASE, 'set OBOS_STREAM_URL to a server running a PUBLIC_OBOS_STREAM_DEV=1 build');
    const tag = viewport.tier ? `${viewport.tag}-${viewport.tier}` : viewport.tag;
    mkdirSync(SHOTS, { recursive: true });
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    /* A held network for the detail files of every area (Canal Ring's too, so coming back to it is a real load), so a loader is on screen long enough to be seen and shot. */
    await page.route(/\/heat-map\/data\/(ams-[a-z0-9]+|canal-ring)-(terrain|trees|water)\.json/, async (route) => {
      const response = await route.fetch();
      await new Promise((r) => setTimeout(r, HOLD_MS));
      await route.fulfill({ response });
    });
    await watchLoader(page);
    await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/?stream=1${viewport.tier ? `&streamtier=${viewport.tier}` : ''}`, { waitUntil: 'domcontentloaded' });

    // first entry: E4, design C
    await expect.poll(async () => (await report(page))?.displayed, { timeout: 150_000, message: 'E4 opens through the stream' }).toBe('E4');
    await arrived(page, 'E4', thrown, 'first entry', false);
    await expect.poll(async () => (await report(page))?.massing.length ?? 0, { timeout: 90_000, message: 'the ring arrives' }).toBeGreaterThanOrEqual(4);
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: `${SHOTS}/${tag}-1-E4.png` });

    // the picker, open
    await page.locator('.si-chip').click();
    await expect(page.locator('.si[data-open="true"]')).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/${tag}-2-picker-open.png` });
    const chipLabel = await page.locator('.si-chip').getAttribute('aria-label');
    expect(chipLabel).toContain('E4');
    expect(await page.locator('.si-panel').innerText()).toContain(drawnOf('E4').toLocaleString('en-US'));
    await page.keyboard.press('Escape');
    await expect(page.locator('.si[data-open="false"]')).toHaveCount(1);

    // Shift + arrow on the MAP must still reach MapLibre (rotate), not the picker
    const bearing = async () => page.evaluate(() => (window as unknown as { __obosStream: { map: { getBearing(): number } } }).__obosStream.map.getBearing());
    const b0 = await bearing();
    await page.evaluate(() => (document.querySelector('.maplibregl-canvas') as HTMLElement).focus());
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(700);
    expect(Math.abs((await bearing()) - b0), 'MapLibre\'s own Shift + arrow still rotates the map').toBeGreaterThan(1);
    expect((await report(page))?.current, 'and did not move the picker').toBe('E4');

    // the walk, by panning
    let previous: Code = 'E4';
    for (const code of ['F4', 'F5', 'E5'] as const) {
      const before = await report(page);
      const wasResident = before?.resident.includes(code) ?? false;
      await resetLoaderSeen(page);
      await panTo(page, code);
      await arrived(page, code, thrown, `pan ${previous}->${code}`, wasResident);
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: `${SHOTS}/${tag}-3-arrived-${code}.png` });
      const r = (await report(page))!;
      expect(r.massing, `${previous} is now grey massing`).toContain(previous);
      expect(r.modelMB).toBeLessThanOrEqual(r.ceilingMB);
      previous = code;
    }

    // back to E4 through the picker: a real click on the chip, then on the E4 cell
    {
      const wasResident = (await report(page))?.resident.includes('E4') ?? false;
      await resetLoaderSeen(page);
      await page.locator('.si-chip').click();
      await expect(page.locator('.si[data-open="true"]')).toBeVisible();
      await page.locator('.si-grid .si-cell[data-code="E4"]').click();
      await arrived(page, 'E4', thrown, 'picker E5->E4', wasResident);
      await page.waitForTimeout(2_500);
      await page.screenshot({ path: `${SHOTS}/${tag}-3-arrived-E4-picker.png` });
    }

    // the loader on screen: the picker sends the camera to G5, under the held network
    await resetLoaderSeen(page);
    await page.locator('.si-chip').click();
    await expect(page.locator('.si[data-open="true"]')).toBeVisible();
    await page.locator('.si-grid .si-cell[data-code="G5"]').click();
    await expect.poll(() => page.evaluate(() => !!document.querySelector('.cl-chip.on')), { timeout: 30_000, message: 'the rise furniture shows' }).toBe(true);
    await page.screenshot({ path: `${SHOTS}/${tag}-4-loader-rise.png` });
    await expect.poll(() => page.evaluate(() => !!document.querySelector('.cl-plate.on')), { timeout: 30_000, message: 'the plate shows' }).toBe(true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/${tag}-5-loader-plate.png` });
    await arrived(page, 'G5' as Code, thrown, 'picker E4->G5', false);
    await page.unrouteAll({ behavior: 'ignoreErrors' });        // a held request still in flight must not outlive the test
    expect(thrown, `page errors: ${thrown.join(' | ')}`).toEqual([]);
  });
}

/** A short phone-size recording of the walk E4 -> F4 -> F5 (OBOS_WALK_VIDEO=1; the file is written to SHOTS/walk-phone.webm). */
test('streaming walk, phone recording', async ({ browser }) => {
  test.skip(!BASE || process.env.OBOS_WALK_VIDEO !== '1', 'set OBOS_STREAM_URL and OBOS_WALK_VIDEO=1');
  mkdirSync(SHOTS, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: `${SHOTS}/.video`, size: { width: 390, height: 844 } } });
  const page = await context.newPage();
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(String(error)));
  await page.route(/\/heat-map\/data\/(ams-[a-z0-9]+|canal-ring)-(terrain|trees|water)\.json/, async (route) => {
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 900));
    await route.fulfill({ response });
  });
  await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/?stream=1&streamtier=low`, { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (await report(page))?.displayed, { timeout: 150_000 }).toBe('E4');
  await page.waitForTimeout(3_500);
  for (const code of ['F4', 'F5'] as const) {
    await panTo(page, code);
    await expect.poll(async () => (await report(page))?.displayed, { timeout: 150_000 }).toBe(code);
    await page.waitForTimeout(3_500);
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const video = page.video();
  await context.close();
  await video!.saveAs(`${SHOTS}/walk-phone.webm`);
  expect(thrown).toEqual([]);
});
