// tests/e2e/cbam-perf.spec.ts — spec §9 perf: the entry animation, measured. Local only (chromium-cbam-perf).
// CBAM_PERF_DIR=/Volumes/OBOSLab/cbam-rail-ui/perf npx playwright test cbam-perf --project=chromium-cbam-perf
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CBAM_URL, VIEW_NAMES, priceLine } from './cbam-helpers';

const DIR = process.env.CBAM_PERF_DIR ?? '';
const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };

test('entering each view: no long task and no long frame while the entry animation plays', async ({ page }) => {
  test.skip(!DIR, 'set CBAM_PERF_DIR to run the perf measurement');
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const w = window as unknown as { __lt: number[][]; __loaf: number[][] };
    w.__lt = []; w.__loaf = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__loaf.push([e.startTime, e.duration]); }).observe({ type: 'long-animation-frame', buffered: true }); } catch { /* not supported */ }
  });
  await page.goto(CBAM_URL);
  await priceLine(page);
  await page.click('#cbAdd');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable');
  const layouts = async (): Promise<number> => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount')?.value ?? 0;
  const rows: Record<string, unknown>[] = [];
  const late: string[] = [];
  for (let round = 0; round < 3; round++) {
    for (const v of VIEW_NAMES) {
      const l0 = await layouts();
      const t0 = await page.evaluate(() => performance.now());
      await page.locator(`.cbx-rail [data-goto="${v}"]`).click();
      const frames = await page.evaluate(() => new Promise<number[]>((done) => {
        const d: number[] = []; let last = performance.now(); const end = last + 2200;
        const tick = (t: number): void => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else done(d); };
        requestAnimationFrame(tick);
      }));
      const l1 = await layouts();
      const { lt, loaf } = await page.evaluate((s) => {
        const w = window as unknown as { __lt: number[][]; __loaf: number[][] };
        return { lt: w.__lt.filter(([st]) => st >= s + 150), loaf: w.__loaf.filter(([st]) => st >= s + 150) };
      }, t0);
      const body = frames.slice(3);   // the entry frame and the two after it carry the click itself
      const median = pct(body, 0.5);
      const row = { view: v, round, frames: body.length, median, p95: pct(body, 0.95), max: Math.max(...body), longTasks: lt, longFrames: loaf, layoutsDuringAnimation: l1 - l0, vsync: median >= 12 };
      rows.push(row);
      if (lt.length) late.push(`${v} r${round}: long tasks ${JSON.stringify(lt)}`);
      if (row.max >= 50) late.push(`${v} r${round}: frame ${row.max.toFixed(1)} ms`);
      if (row.vsync && row.p95 > 20) late.push(`${v} r${round}: p95 ${row.p95.toFixed(1)} ms`);
    }
  }
  writeFileSync(join(DIR, `cbam-entry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify({ label: 'new-headless Metal (no window), CPU throttled 4x', viewport: '1440x900', rows }, null, 2));
  expect(late).toEqual([]);
});
