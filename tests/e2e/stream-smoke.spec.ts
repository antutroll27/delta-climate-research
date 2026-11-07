import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * WHOLE-CITY STREAMING, DEV SMOKE (city-streaming P3b). Skipped unless OBOS_STREAM_URL names a server: it needs a build made with
 * PUBLIC_OBOS_STREAM_DEV=1 and the sheet data beside it, neither of which exists in CI (playwright.stream.config.ts starts it).
 *
 * Opens Canal Ring (sheet E4) with ?stream=1, waits for the grey neighbour ring, pans the camera across the seam into F4, and
 * asserts the sheet switched, the memory model stayed under the tier's ceiling, and the page threw nothing. Two screenshots
 * (before and after the crossing) per viewport go to SHOTS.
 */
const BASE = process.env.OBOS_STREAM_URL;
const SHOTS = process.env.OBOS_STREAM_SHOTS ?? '/Volumes/PortableSSD/OBOS Lab/previews/city-streaming/p3b';
const TIER = process.env.OBOS_STREAM_TIER;     // optional ?streamtier=
const F4_CENTRE = { lon: 4.926190546565045, lat: 52.364 };

interface Report {
  tier: string; current: string | null; displayed: string | null; open: string | null; modelMB: number; ceilingMB: number;
  massing: string[]; massingMB: number; haloKB: number; resident: string[]; switches: number;
  workerMs: { prepare: number[]; mesh: number[]; massing: number[] };
}
const report = (page: Page): Promise<Report | null> =>
  page.evaluate(() => (window as unknown as { __obosStream?: { report(): unknown } }).__obosStream?.report() as Report | null ?? null);

for (const viewport of [{ width: 390, height: 844, tag: 'phone' }, { width: 1440, height: 900, tag: 'desktop' }]) {
  test(`streaming dev: E4 to F4 across the seam, ${viewport.tag}`, async ({ page }) => {
    test.skip(!BASE, 'set OBOS_STREAM_URL to a server running a PUBLIC_OBOS_STREAM_DEV=1 build');
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/?stream=1${TIER ? `&streamtier=${TIER}` : ''}`, { waitUntil: 'domcontentloaded' });

    await expect.poll(async () => (await report(page))?.open, { timeout: 90_000, message: 'E4 opens through the stream' }).toBe('E4');
    await expect.poll(async () => (await report(page))?.massing.length ?? 0, { timeout: 90_000, message: 'the eight-neighbour ring arrives' }).toBeGreaterThanOrEqual(4);
    await page.waitForTimeout(3_000);                        // let the first grow and the first solve settle
    const before = (await report(page))!;
    await page.screenshot({ path: `${SHOTS}/p3b-${viewport.tag}-1-E4-before.png` });

    // Pan to the middle of F4 and let go: the crossing needs the centre 200 m inside, no gesture, 400 ms idle.
    await page.evaluate(({ lon, lat }) => {
      const map = (window as unknown as { __obosStream: { map: { easeTo(o: unknown): void } } }).__obosStream.map;
      map.easeTo({ center: [lon, lat], duration: 2_500 });
    }, F4_CENTRE);
    await expect.poll(async () => (await report(page))?.open, { timeout: 120_000, message: 'the sheet switches to F4' }).toBe('F4');
    await page.waitForTimeout(4_000);
    const after = (await report(page))!;
    await page.screenshot({ path: `${SHOTS}/p3b-${viewport.tag}-2-F4-after.png` });

    console.log(`[stream ${viewport.tag}] before ${JSON.stringify(before)}\n[stream ${viewport.tag}] after ${JSON.stringify(after)}`);
    expect(after.switches).toBeGreaterThanOrEqual(2);
    expect(after.displayed).toBe('F4');
    expect(after.massing, 'the sheet we left is now grey massing').toContain('E4');
    expect(after.modelMB).toBeLessThanOrEqual(after.ceilingMB);
    expect(before.modelMB).toBeLessThanOrEqual(before.ceilingMB);
    expect(thrown, `page errors: ${thrown.join(' | ')}`).toEqual([]);
  });
}
