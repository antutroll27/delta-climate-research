// tests/e2e/obos-v2-compare.spec.ts — OBOS v2 D7 (Compare and the paired brief rebuilt in v2). Owner: Track C (plan amendment A1).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PW_ORIGIN } from './fixtures/ui-v2-state';

/* ════════════════════════════════════════════════════════════════════════════════════════════
   1. v1 STAYS v1 (flag off). The S0 baseline already holds compare-dark and both pages' markup.
      This extends the proof to what it did not cover: the paired brief (style + pixels) and
      Compare on a phone. Recorded ONCE on the S2 head (318511e), before any Track C edit, with
      V2_COMPARE_V1=record; compared at every gate. Local only: the baseline lives on /Volumes/OBOSLab.
   ════════════════════════════════════════════════════════════════════════════════════════════ */
const BASE = '/Volumes/OBOSLab/obos-v2/shots/v1-compare-baseline';
const RECORD = process.env.V2_COMPARE_V1 === 'record';
const FIXED_NOW = '2026-10-07T06:05:00Z';
const PROPS = ['display', 'position', 'visibility', 'opacity', 'z-index', 'color', 'background-color',
  'border-top-color', 'font-family', 'font-size', 'font-weight'] as const;

async function settleV1(page: Page, path: string): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
  await page.goto(`/${path}/`);
  await expect(page.locator('main#main:not(.obos-v2)')).toHaveCount(1);
  await expect(page.locator('[data-compare-root], [data-brief-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 });
  await page.addStyleTag({ content: '[data-compare-root] canvas { visibility: hidden !important; }' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0; } });
  await page.waitForTimeout(250);
}

async function v1Lines(page: Page): Promise<string[]> {
  return page.evaluate((props) => {
    const r = (n: number) => Math.round(n * 2) / 2;
    const root = document.querySelector('main#main');
    if (!root) throw new Error('no main#main');
    return [document.body, root, ...Array.from(root.querySelectorAll('*'))].map((el, i) => {
      const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
      const cls = typeof el.className === 'string' ? el.className : '';
      return `${i}|${el.tagName.toLowerCase()}#${el.id}.${cls}|${r(b.x)},${r(b.y)},${r(b.width)},${r(b.height)}|` + props.map((p) => cs.getPropertyValue(p)).join('|');
    });
  }, [...PROPS]);
}

type V1View = { name: string; path: string; mobile: boolean };
const V1_VIEWS: readonly V1View[] = [
  { name: 'compare-phone', path: 'heat-map/compare', mobile: true },
  { name: 'brief-desktop', path: 'heat-map/brief', mobile: false },
  { name: 'brief-phone', path: 'heat-map/brief', mobile: true },
];

async function captureV1(browser: Browser, v: V1View): Promise<{ lines: string[]; png: Buffer }> {
  /* browser.newContext() does not inherit the project's storageState: the v2 flag stays OFF here. */
  const ctx = await browser.newContext(v.mobile
    ? { baseURL: PW_ORIGIN, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
    : { baseURL: PW_ORIGIN, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await settleV1(page, v.path);
  const lines = await v1Lines(page);
  const png = await page.screenshot();
  await ctx.close();
  return { lines, png };
}

test.describe('@v2 compare: v1 unchanged with the flag off', () => {
  test.skip(!!process.env.CI, 'local only: the baseline lives on /Volumes/OBOSLab');
  test.setTimeout(240_000);

  for (const v of V1_VIEWS) {
    test(`@v2 v1 ${v.name} is unchanged: computed style and pixels`, async ({ browser }) => {
      mkdirSync(join(BASE, 'style'), { recursive: true });
      mkdirSync(join(BASE, 'png'), { recursive: true });
      const styleFile = join(BASE, 'style', `${v.name}.json`);
      const pngFile = join(BASE, 'png', `${v.name}.png`);
      const a = await captureV1(browser, v);
      if (RECORD) {
        const b = await captureV1(browser, v);
        expect(a.lines.filter((l, i) => l !== b.lines[i]), 'NON-DETERMINISTIC nodes: stop and report').toEqual([]);
        expect(a.png.equals(b.png), 'NON-DETERMINISTIC pixels: stop and report').toBe(true);
        writeFileSync(styleFile, JSON.stringify(a.lines));
        writeFileSync(pngFile, a.png);
        return;
      }
      expect(existsSync(styleFile) && existsSync(pngFile), `baseline missing for ${v.name}`).toBe(true);
      const want = JSON.parse(readFileSync(styleFile, 'utf8')) as string[];
      expect(a.lines.length, 'element count changed').toBe(want.length);
      expect(a.lines.map((l, i) => (l === want[i] ? null : `got  ${l}\nwant ${want[i]}`)).filter(Boolean).slice(0, 20)).toEqual([]);
      expect(a.png.equals(readFileSync(pngFile)), `${v.name}: pixels changed`).toBe(true);
    });
  }
});
