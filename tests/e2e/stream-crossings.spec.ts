import { expect, test } from '@playwright/test';
import { loadavg } from 'node:os';

/**
 * WHOLE-CITY STREAMING, CROSSING TIMES (P3b audit S5). Skipped unless OBOS_STREAM_URL is set. Crosses E4 <-> F4 ten times on one tier and
 * prints the longest main-thread task of each crossing (the `longtask` entries from the camera move until 2.5 s after the sheet
 * has opened), with the median, p90 and max. A busy machine makes these numbers meaningless, so it first waits for the one-minute
 * load average to fall under 2 (up to OBOS_STREAM_IDLE_WAIT_S, default 600) and prints the load it measured with the result.
 */
const BASE = process.env.OBOS_STREAM_URL;
const TIER = process.env.OBOS_STREAM_TIER ?? '';
const CENTRES = { E4: { lon: 4.885, lat: 52.364 }, F4: { lon: 4.926190546565045, lat: 52.364 } } as const;
const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };

test.describe.configure({ timeout: 900_000 });

test(`streaming dev: ten crossings, longest main-thread task per crossing (${TIER || 'device tier'})`, async ({ page }) => {
  test.skip(!BASE, 'set OBOS_STREAM_URL to a server running a PUBLIC_OBOS_STREAM_DEV=1 build');
  const waitUntil = Date.now() + 1000 * Number(process.env.OBOS_STREAM_IDLE_WAIT_S ?? 600);
  while (loadavg()[0] >= 2 && Date.now() < waitUntil) await new Promise((r) => setTimeout(r, 10_000));
  const load = loadavg()[0];
  await page.addInitScript(() => {
    (window as unknown as { __lt: Array<[number, number]> }).__lt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as unknown as { __lt: Array<[number, number]> }).__lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] });
  });
  await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/?stream=1${TIER ? `&streamtier=${TIER}` : ''}`, { waitUntil: 'domcontentloaded' });
  const open = (): Promise<string | null> => page.evaluate(() => (window as unknown as { __obosStream: { report(): { open: string | null } } }).__obosStream?.report().open ?? null);
  await expect.poll(open, { timeout: 120_000 }).toBe('E4');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __obosStream: { report(): { massing: string[] } } }).__obosStream.report().massing.length), { timeout: 120_000 }).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(4_000);
  const maxima: number[] = [];
  let at: 'E4' | 'F4' = 'E4';
  for (let i = 0; i < 10; i++) {
    const to: 'E4' | 'F4' = at === 'E4' ? 'F4' : 'E4';
    const t0 = await page.evaluate((c) => {
      const s = (window as unknown as { __obosStream: { map: { easeTo(o: unknown): void } } }).__obosStream;
      const t = performance.now(); s.map.easeTo({ center: [c.lon, c.lat], duration: 1_500 }); return t;
    }, CENTRES[to]);
    await expect.poll(open, { timeout: 120_000 }).toBe(to);
    await page.waitForTimeout(2_500);
    const tasks = await page.evaluate((t) => (window as unknown as { __lt: Array<[number, number]> }).__lt.filter(([s]) => s >= t).map(([, d]) => d), t0);
    maxima.push(Math.round(Math.max(0, ...tasks)));
    at = to;
  }
  console.log(`[crossings ${TIER || 'device'}] load=${load.toFixed(2)} longest task per crossing ms: ${JSON.stringify(maxima)} median=${pct(maxima, 0.5)} p90=${pct(maxima, 0.9)} max=${Math.max(...maxima)}${load >= 2 ? ' (MACHINE NOT IDLE)' : ''}`);
});
