// tests/e2e/obos-v2-compare.spec.ts — OBOS v2 D7 (Compare and the paired brief rebuilt in v2). Owner: Track C (plan amendment A1).
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PW_ORIGIN } from './fixtures/ui-v2-state';
import { duplicateIds, openV2 } from './obos-v2-helpers';

/* ════════════════════════════════════════════════════════════════════════════════════════════
   1. v1 STAYS v1 (flag off). The S0 baseline already holds compare-dark and both pages' markup.
      This extends the proof to what it did not cover: the paired brief (style + pixels) and
      Compare on a phone. Recorded ONCE on the S2 head (318511e), before any Track C edit, with
      V2_COMPARE_V1=record; compared at every gate. Local only: the baseline lives on /Volumes/OBOSLab.
   ════════════════════════════════════════════════════════════════════════════════════════════ */
const BASE = '/Volumes/OBOSLab/obos-v2/shots/v1-compare-baseline';
const RECORD = process.env.V2_COMPARE_V1 === 'record';
const NO_FLAG = { cookies: [], origins: [] };
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
  /* browser.newContext() DOES inherit the project's storageState here (the S2 head had no Compare v2 tree, so it never showed): the empty state keeps the v2 flag OFF. */
  const ctx = await browser.newContext(v.mobile
    ? { storageState: NO_FLAG, baseURL: PW_ORIGIN, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
    : { storageState: NO_FLAG, baseURL: PW_ORIGIN, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
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

/* ════════════════════════════════════════════════════════════════════════════════════════════
   2. THE v2 COMPARE PAGE AND THE PAIRED BRIEF. The flag comes from the project's storageState.
      Every test names the v1 behaviour it keeps; the v1 specs (heat-map-compare*.spec.ts) keep running against v1.
   ════════════════════════════════════════════════════════════════════════════════════════════ */
const METAL = ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

async function openCompare(page: Page, query = ''): Promise<void> {
  await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
  await page.goto(`/heat-map/compare/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'v2');
  await expect(page.locator('main.obos-v2[data-compare-root]')).toHaveCount(1);
  await expect(page.locator('main.obos-v2[data-compare-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
  await expect(page.locator('[data-role="status"]').first()).toContainText('Comparison settled', { timeout: 60_000 });
}

const cooling = (page: Page): Promise<string | null> => page.locator('[data-value="a-cooling"]').first().textContent();

test.describe('@v2 compare', () => {
  test.setTimeout(240_000);

  test('@v2 [H] one v2 tree; pickers, sliders, Reset/Undo, share URL, keyboard, brief link; the honesty lines and the menu', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openCompare(page);
    expect(await duplicateIds(page)).toEqual([]);
    await expect(page.locator('template#obos-v2-tree')).toHaveCount(0);
    expect(await page.evaluate(() => [localStorage.getItem('obos:panel'), localStorage.getItem('obos:rail')]), 'a v2 visit must never write the v1 panel or rail preference').toEqual([null, null]);

    /* the menu: "Analysis · Compare" is the current page, a button, not a self-link; the rest lead to the map */
    const cur = page.locator('.nav-item[aria-current="page"]');
    await expect(cur).toHaveText(/Analysis · Compare/);
    await expect(cur).toHaveJSProperty('tagName', 'BUTTON');
    await expect(page.locator('a.nav-item').first()).toHaveAttribute('href', /\/heat-map\/in\/kolkata\//);

    /* H25: v1's honesty, on screen */
    const main = page.locator('main.obos-v2');
    await expect(main).toContainText('Illustrative, editable');
    await expect(main).toContainText('not a ward ranking');
    await expect(main).toContainText('Thermal relief illustrative');
    await expect(main).toContainText('Screening-grade output. It does not assess vulnerability, equity, feasibility, ownership, operations, maintenance, or investment priority.');
    await expect(main).toContainText('fallback reference');
    await expect(main).toContainText('This is not a measured urban–rural heat-island value.');
    expect(await main.evaluate((el) => (el as HTMLElement).innerText)).not.toMatch(/validated/i);

    /* the A/B pickers: filled from the registry, inside the panel, the collision disabled */
    const a = page.locator('.side-panel [data-input="ward-a"]');
    const b = page.locator('.side-panel [data-input="ward-b"]');
    await expect(a.locator('option')).toHaveCount(3);
    await expect(b.locator('option')).toHaveCount(3);
    await expect(a).toHaveValue('in/kolkata/ballygunge');
    await expect(b).toHaveValue('in/kolkata/baruipur');
    await expect(a.locator('option[value="in/kolkata/baruipur"]')).toHaveAttribute('disabled', '');
    await b.selectOption('in/kolkata/barrackpore');
    await expect(page).toHaveURL(/[?&]b=/);
    await expect(page.locator('[data-value="b-name"]').first()).toHaveText('Barrackpore', { timeout: 60_000 });
    await expect(page.locator('[data-role="status"]').first()).toContainText('Comparison settled', { timeout: 60_000 });
    await page.locator('[data-action="swap"]').click();
    await expect(page.locator('[data-value="a-name"]').first()).toHaveText('Barrackpore', { timeout: 60_000 });
    await expect(page.locator('[data-value="b-name"]').first()).toHaveText('Ballygunge');
    await expect(page.locator('[data-role="status"]').first()).toContainText('Comparison settled', { timeout: 60_000 });

    /* a slider re-runs the model; Reset zeroes the package and arms Undo; Undo restores exactly what Reset took */
    const before = await cooling(page);
    const trees = page.locator('[data-input="trees"]');
    await trees.fill('20');
    await expect(page.locator('[data-output="trees"]')).toHaveText('20%');
    await expect(page).toHaveURL(/trees=20/);
    await expect.poll(() => cooling(page), { timeout: 60_000 }).not.toBe(before);
    const undo = page.locator('[data-action="undo"]');
    await expect(undo).toBeDisabled();
    await page.locator('[data-action="reset"]').click();
    await expect(trees).toHaveValue('0');
    await expect(page.locator('[data-action="reset"]')).toBeDisabled();
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(trees).toHaveValue('20');
    await expect(undo).toBeDisabled();

    /* keyboard on a slider (v1: ArrowRight on Cool roofs = +5) */
    await page.locator('[data-input="roofs"]').press('ArrowRight');
    await expect(page).toHaveURL(/roof=70/);
    await page.locator('[data-input="phase"][value="retained"]').check();
    await expect(page).toHaveURL(/phase=retained/);

    /* share: the field is hidden until the clipboard is refused; the URL it holds is the page's own (?a&b&phase&forcing) */
    await page.locator('[data-action="share"]').click();
    await expect(page.locator('[data-role="status"]').first()).toContainText('Shareable comparison URL copied');
    await expect(page.locator('[data-role="share-url"]')).toHaveValue(page.url());
    expect(new URL(page.url()).searchParams.get('phase')).toBe('retained');

    /* the brief link carries the same state */
    const href = await page.locator('a[data-role="brief-link"]').getAttribute('href');
    expect(href).toMatch(/^\/heat-map\/brief\/\?/);
    /* KNOWN v1 BEHAVIOUR, kept: the controller rewrites this href when a ward or a coverage changes, not when the phase does
       (paired-controller.ts: the phase listener never calls updateInputs). The page URL, the share field and a reload are right. */
    expect(new URL(href ?? '', 'http://x').searchParams.get('trees')).toBe('20');
    expect(errors).toEqual([]);
  });

  test('@v2 the frame works on Compare: theme, card style, menu pin, Key and Credits (popovers close on Esc), and the panel survives a closed-side preference', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('obos:v2:side', 'closed'); } catch { /* none */ } });
    await page.goto('/heat-map/compare/');
    const root = page.locator('main.obos-v2');
    await expect(root).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    /* the stored "side closed" an area page may have left must not hide the only controls this route has */
    await expect(page.locator('.side-panel')).toBeVisible();
    await expect(page.locator('[data-input="ward-a"]')).toBeVisible();
    await page.locator('[data-pref="theme"][data-v="light"]').click();
    await expect(root).toHaveAttribute('data-theme', 'light');
    await page.locator('[data-pref="theme"][data-v="dark"]').click();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await page.locator('[data-pref="cards"][data-v="glass"]').click();
    await expect(root).toHaveAttribute('data-cards', 'glass');
    await page.locator('[data-pref="cards"][data-v="plates"]').click();
    await expect(root).toHaveAttribute('data-cards', 'plates');
    const pin = page.locator('[data-menu-pin]');
    const was = await root.getAttribute('data-menu');
    await pin.click({ position: { x: 20, y: 20 } });
    await expect(root).not.toHaveAttribute('data-menu', was ?? '');
    await pin.click({ position: { x: 20, y: 20 } });
    await page.locator('.key-btn').click();
    await expect(page.locator('#v2Key')).toHaveAttribute('data-open', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#v2Key')).toHaveAttribute('data-open', 'false');
    await page.locator('.attrib').click();
    const credits = page.locator('#v2Credits');
    await expect(credits).toHaveAttribute('data-open', 'true');
    await expect(credits.locator('a[href="https://creativecommons.org/licenses/by-sa/2.5/in/"]')).toHaveCount(1);
    /* C audit F2: water (OSM) and the Sentinel-2 surface are model inputs here too */
    await expect(credits).toContainText('Water \u00a9 OpenStreetMap');
    await expect(credits).toContainText('Contains modified Copernicus Sentinel data 2021\u20132025');
    await expect(credits.locator('a[href*="Sentinel_Data_Legal_Notice"]')).toHaveCount(1);
    await expect(credits).not.toContainText(/OpenFreeMap|OpenMapTiles/);
    await page.keyboard.press('Escape');
    await expect(credits).toHaveAttribute('data-open', 'false');
  });

  test('@v2 a legacy link renders the wards it names; an unresolvable id still settles (v1 heat-map-compare)', async ({ page }) => {
    const missing: string[] = [];
    page.on('response', (r) => { if (r.status() === 404 && r.url().includes('/heat-map/data/')) missing.push(new URL(r.url()).pathname); });
    const names = async (q: string) => {
      await openCompare(page, q);
      return { a: await page.locator('[data-value="a-name"]').first().textContent(), b: await page.locator('[data-value="b-name"]').first().textContent() };
    };
    expect(await names('?a=barrackpore&b=ballygunge')).toEqual({ a: 'Barrackpore', b: 'Ballygunge' });
    expect(await names('?a=nonsense&b=ballygunge')).toEqual({ a: 'Ballygunge', b: 'Baruipur' });
    expect(missing, `data artefacts 404'd: ${missing.join(', ')}`).toEqual([]);
  });

  test('@v2 Retry model: a failed run says so and offers Retry, and Retry re-enters the run', async ({ page }) => {
    /* the first ward-data request of the page fails (a dropped connection); every later one succeeds.
       KNOWN v1 BEHAVIOUR, kept (the controller is untouched): the ward loader memoises a failed ward JSON, so Retry re-runs the
       model but a ward that failed to load stays failed until the page is reloaded. Checked on v1 on 17 Oct. This test therefore
       asserts what Retry promises today, that it runs again, and not that it recovers. */
    let seen = 0;
    await page.route(/\/heat-map\/data\//, (route) => { seen += 1; return seen === 1 ? route.abort() : route.continue(); });
    await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
    await page.goto('/heat-map/compare/');
    const retry = page.locator('[data-action="retry"]');
    await expect(page.locator('[data-role="status"]').first()).toContainText('Comparison unavailable', { timeout: 90_000 });
    await expect(retry).toBeVisible();
    await expect(page.locator('main.obos-v2')).toHaveAttribute('aria-busy', 'false');
    const before = seen;
    await retry.click();
    await expect.poll(() => seen, { timeout: 30_000 }).toBeGreaterThan(before);
    await expect(page.locator('main.obos-v2')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 });
  });

  test('@v2 the two maps stay side by side and clear of the panel and the column across laptop and desktop widths', async ({ page }) => {
    await openCompare(page);
    for (const width of [1280, 1366, 1440, 1536, 1680]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(600);
      const g = await page.evaluate(() => {
        const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const cards = [...document.querySelectorAll('.cmp-map')].map((c) => c.getBoundingClientRect());
        return { panelRight: r('.side-panel').right, colLeft: r('.cmp-col').left, cards: cards.map((c) => ({ l: c.left, r: c.right, w: c.width })) };
      });
      expect(g.cards.length).toBe(2);
      for (const c of g.cards) {
        expect(c.w, `a map card is ${Math.round(c.w)} px at ${width} px`).toBeGreaterThanOrEqual(230);
        expect(c.l, `a map card runs under the panel at ${width} px`).toBeGreaterThanOrEqual(g.panelRight);
        expect(c.r, `a map card runs under the column at ${width} px`).toBeLessThanOrEqual(g.colLeft);
      }
    }
  });

  test('@v2 flag off, Compare is v1 (no v2 tree, v1 console)', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: PW_ORIGIN, storageState: NO_FLAG });
    const page = await ctx.newPage();
    await page.goto('/heat-map/compare/');
    await expect(page.locator('main#main.heat-compare:not(.obos-v2)')).toHaveCount(1);
    await expect(page.locator('template#obos-v2-tree')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('[data-pane="analysis"]')).toHaveCount(1);
    await ctx.close();
  });

  test('@v2 a soft (ClientRouter) hop from an area to Compare keeps v2, one tree, unique ids, and the bench settles', async ({ page }) => {
    await openV2(page, '/heat-map/in/kolkata/ballygunge/');
    await page.evaluate(() => { const a = document.createElement('a'); a.href = '/heat-map/compare/'; a.id = 'softnav'; a.textContent = 'soft nav'; a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;padding:8px;background:#fff'; document.body.append(a); });
    await page.locator('#softnav').click();
    await expect(page).toHaveURL(/\/heat-map\/compare/);
    await expect(page.locator('html')).toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('main.obos-v2[data-compare-root]')).toHaveCount(1);
    await expect(page.locator('main.obos-v2[data-compare-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    expect(await duplicateIds(page)).toEqual([]);
    await expect(page.locator('.nav-item[aria-current="page"]')).toHaveText(/Analysis · Compare/);
  });

  test('@v2 C audit F1: the frame is bound once after soft hops (a ward to Compare by the menu, Compare to the brief by its link): the pin works and the brief starts ONE worker', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page, '/heat-map/in/kolkata/ballygunge/');
    await page.locator('a.nav-item[data-rail="analysis"]').click({ position: { x: 30, y: 22 } });   // the icon: the item's centre is clipped or covered (S2 re-check R2)
    await expect(page).toHaveURL(/\/heat-map\/compare\//);
    const root = page.locator('main.obos-v2');
    await expect(root).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    const pinFlips = async (): Promise<void> => {
      const was = await root.getAttribute('data-menu');
      await page.locator('[data-menu-pin]').click({ position: { x: 30, y: 22 } });
      await expect(root, 'a double binding flips the pin twice, which is no flip').not.toHaveAttribute('data-menu', was ?? '');
    };
    await pinFlips();
    let workers = 0; page.on('worker', () => { workers += 1; });
    await page.locator('a[data-role="brief-link"]').click();
    await expect(page.locator('main.obos-v2[data-brief-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    await pinFlips();
    await page.waitForTimeout(1500);
    expect(workers, 'only the brief\'s own reproduction may run on the brief (a hard load starts one)').toBe(1);
    await expect(page.locator('main.obos-v2[data-compare-root]'), 'the brief is not a Compare bench').toHaveCount(0);
  });

  test('@v2 the Compare link on a Bengaluru ward opens a Bengaluru pair that settles (v1 heat-map-compare-from-bengaluru)', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
    await page.goto('/heat-map/in/bengaluru/whitefield/', { waitUntil: 'domcontentloaded' });
    const link = page.locator('a.nav-item[data-rail="analysis"]');
    await expect(link).toHaveAttribute('href', /a=in%2Fbengaluru%2Fwhitefield/, { timeout: 60_000 });
    const href = await link.getAttribute('href');
    if (!href) throw new Error('the Compare link has no href');
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    const status = page.locator('[data-role="status"]').first();
    await expect(status).toContainText('Comparison settled', { timeout: 90_000 });
    await expect(status).not.toContainText(/unavailable|invalid/i);
    await expect(page.locator('[data-value="a-name"]').first()).toHaveText('Whitefield');
    await expect(page.locator('[data-value="b-name"]').first()).toHaveText('Indiranagar');
  });

  test('@v2 on a phone the workspace is a bottom sheet that has the page width (the rail is the drawer), opens to half and full, and holds the Evidence tab', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: PW_ORIGIN, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      storageState: { cookies: [], origins: [{ origin: PW_ORIGIN, localStorage: [{ name: 'obos:ui', value: 'v2' }] }] } });
    const page = await ctx.newPage();
    await page.goto('/heat-map/compare/');
    await expect(page.locator('main.obos-v2')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    /* S8: the rail is the phone drawer's now (C11), so the sheet no longer has to clear an icon column: it has the screen's width, 8 px in from each edge */
    await expect(page.locator('#v2Drawer nav.rail'), 'the rail lives in the drawer on a phone').toHaveCount(1);
    await expect(page.locator('#v2Drawer')).toBeHidden();
    const sheet = page.locator('.heat-compare__controls');
    const box = await sheet.boundingBox();
    if (!box) throw new Error('no box');
    expect(box.x, 'the sheet runs from the page margin, not from beside a rail').toBeLessThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(390.5);
    await expect(sheet).toHaveAttribute('data-sheet', 'collapsed');
    await expect(page.locator('[data-input="trees"]')).toBeHidden();
    await page.locator('[data-action="sheet-toggle"]').click();
    await expect(sheet).toHaveAttribute('data-sheet', 'half');
    await expect(page.locator('[data-input="trees"]')).toBeVisible();
    await page.locator('[data-action="sheet-toggle"]').click();
    await expect(sheet).toHaveAttribute('data-sheet', 'full');
    await page.locator('[data-tab="evidence"]').click();
    await expect(page.locator('[data-panel="evidence"]')).toBeVisible();
    await expect(page.locator('[data-panel="evidence"]')).toContainText('It is not live ward weather.');
    await page.locator('[data-tab="settings"]').click();
    await page.locator('[data-action="sheet-toggle"]').click();
    await expect(sheet).toHaveAttribute('data-sheet', 'collapsed');
    await ctx.close();
  });

  test('@v2 the paired brief: reached from the bench, filled from the real model, prints without chrome, and goes back with the state', async ({ page }) => {
    await openCompare(page, '?a=ballygunge&b=baruipur&trees=40');
    await page.locator('a[data-role="brief-link"]').click();
    await expect(page).toHaveURL(/\/heat-map\/brief\/\?/);
    const root = page.locator('main.obos-v2[data-brief-root]');
    await expect(root).toHaveCount(1);
    await expect(root).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    expect(await duplicateIds(page)).toEqual([]);
    await expect(page.locator('h1')).toHaveText('Paired scenario brief');
    await expect(page.locator('[data-role="status"]')).toContainText('Record reproduced in the client');
    for (const k of ['a-name', 'b-name', 'a-over', 'b-over', 'a-baseline', 'b-baseline', 'a-scenario', 'b-scenario', 'a-cooling', 'b-cooling', 'a-cost', 'b-cost']) {
      await expect(page.locator(`[data-value="${k}"]`), k).not.toHaveText('—');
    }
    await expect(page.locator('[data-value="trees"]')).toHaveText('40% modelled corridor cells');
    await expect(page.locator('[data-value="phase"]')).toHaveText('13:00 peak');
    await expect(root).toContainText('This is not a ward ranking or an investment-priority recommendation.');
    await expect(root).toContainText('It is not an observed regional heat-day record.');
    /* it is a document: the page scrolls and the root is a block */
    expect(await root.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
    await expect(page.locator('.brf-org'), 'the issuer line is for paper only').toBeHidden();
    /* print: ink on paper, no chrome, no print button */
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.brf-org'), 'C audit F3: the printed brief says who issued it').toHaveText('Delta Climate Research');
    await expect(page.locator('.brf-org')).toBeVisible();
    await expect(page.locator('[data-action="print"]')).toBeHidden();
    await expect(page.locator('nav.rail')).toBeHidden();
    await expect(page.locator('.toolbar')).toBeHidden();
    const ink = await root.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color]; });
    expect(ink).toEqual(['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
    const cardInk = await page.locator('.brf-evidence').evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color]; });
    expect(cardInk, 'a card must not keep its screen fill in print').toEqual(['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
    await page.emulateMedia({ media: 'screen' });
    /* back to Compare with the same pair and package */
    const back = page.locator('a[data-role="compare-link"]');
    await expect(back).toHaveAttribute('href', /\/heat-map\/compare\/\?.*trees=40/);
    await back.click();
    await expect(page).toHaveURL(/\/heat-map\/compare\/\?.*trees=40/);
    await expect(page.locator('main.obos-v2[data-compare-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    await expect(page.locator('[data-input="trees"]')).toHaveValue('40');
  });

  test('@v2 C audit F4: print hides the chrome by a rule, not a list - an element added to the brief root later (S8) cannot print', async ({ page }) => {
    await openV2(page, '/heat-map/brief/?a=ballygunge&b=baruipur&trees=40');
    await expect(page.locator('main.obos-v2[data-brief-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    await page.evaluate(() => {
      const root = document.querySelector('main.obos-v2[data-brief-root]');
      const el = document.createElement('div'); el.className = 'future-drawer'; el.textContent = 'a drawer S8 adds';
      el.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px';
      root?.append(el);
    });
    await expect(page.locator('.future-drawer')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.future-drawer'), 'anything outside the sheet is chrome').toBeHidden();
    await expect(page.locator('.brf-sheet')).toBeVisible();
    await expect(page.locator('.brf-acts'), 'the in-sheet buttons are chrome too').toBeHidden();
    await expect(page.locator('.brf-evidence')).toBeVisible();
  });

  test('@v2 print on the brief: window.print is what the button calls', async ({ page }) => {
    await page.addInitScript(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed += 1; }; });
    await page.goto('/heat-map/brief/');
    await expect(page.locator('main.obos-v2[data-brief-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    await page.locator('[data-action="print"]').click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  });
});

/* The linked cameras and the arrow / + / - / 0 keys live on the Three.js canvas, which needs a real GPU. Own browser args, so the
   chromium-v2 project's SwiftShader (tier 0, canvas fallback) never hides them; where the renderer still falls back, the 2D orbit
   and its reset are asserted instead (v1 heat-map-compare). Headless, as every run (BRIEF, 17 Oct). */
test.describe('@v2 compare cameras', () => {
  test.setTimeout(240_000);

  test('@v2 linked cameras: Relief/Top/Motion, arrow keys, plus, minus, 0, and Reset linked drive both maps', async () => {
    /* its own browser: launch args cannot differ inside one file's project, and the flag-off proofs above must keep the project's own renderer */
    const browser = await chromium.launch({ headless: true, args: METAL });
    const ctx = await browser.newContext({ baseURL: PW_ORIGIN, viewport: { width: 1440, height: 900 },
      storageState: { cookies: [], origins: [{ origin: PW_ORIGIN, localStorage: [{ name: 'obos:ui', value: 'v2' }] }] } });
    const page = await ctx.newPage();
    try { await cameras(page); } finally { await ctx.close(); await browser.close(); }
  });
});

async function cameras(page: Page): Promise<void> {
    await openCompare(page);
    const root = page.locator('main.obos-v2');
    await expect.poll(() => root.evaluate((n) => (n as HTMLElement).dataset.renderer === 'three' || Boolean((n as HTMLElement).dataset.rendererReason)), { timeout: 60_000 }).toBe(true);
    const three = (await root.getAttribute('data-renderer')) === 'three';
    test.info().annotations.push({ type: 'renderer', description: three ? 'three' : 'canvas fallback' });
    if (!process.env.CI) expect(three, 'Metal gives the Three.js renderer on a local run; a fallback here would hide the key and camera checks').toBe(true);
    if (!three) {
      /* the 2D fallback: orbit by drag, return by Reset linked */
      const map = page.locator('[data-map-field="a"]');
      const reset = await map.getAttribute('data-map-view');
      const box = await map.boundingBox();
      if (!box) throw new Error('no map box');
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.42);
      await page.mouse.up();
      await expect(map).not.toHaveAttribute('data-map-view', reset ?? '');
      await page.locator('[data-action="map-reset"][data-map-reset="a"]').click();
      await expect(map).toHaveAttribute('data-map-view', reset ?? '');
      return;
    }
    const A = page.locator('[data-map-three="a"]');
    const B = page.locator('[data-map-three="b"]');
    /* ambient motion drifts the yaw: pause it, return to the reset view, then drive the keys */
    const motion = page.locator('[data-action="motion"]');
    if (await motion.isEnabled() && (await motion.getAttribute('aria-pressed')) === 'true') await motion.click();
    await page.locator('[data-action="map-reset"][data-map-reset="a"]').click();
    await expect.poll(() => A.getAttribute('data-map-view')).toBe('-0.300,0.920,1.00');
    const yaw = async (loc: typeof A) => Number(((await loc.getAttribute('data-map-view')) ?? '').split(',')[0]);
    const zoom = async (loc: typeof A) => Number(((await loc.getAttribute('data-map-view')) ?? '').split(',')[2]);
    await A.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => yaw(A)).toBeGreaterThan(-0.3);
    /* linked: the other ward's camera followed */
    await expect.poll(async () => (await A.getAttribute('data-map-view')) === (await B.getAttribute('data-map-view'))).toBe(true);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => yaw(A)).toBeLessThan(-0.3);
    await page.keyboard.press('+');
    await expect.poll(() => zoom(A)).toBeGreaterThan(1);
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await expect.poll(() => zoom(A)).toBeLessThan(1);
    await page.keyboard.press('0');
    await expect.poll(() => A.getAttribute('data-map-view')).toBe('-0.300,0.920,1.00');
    await expect.poll(() => B.getAttribute('data-map-view')).toBe('-0.300,0.920,1.00');
    /* Top and Relief */
    const top = page.locator('[data-view-mode="top"]');
    await top.click();
    await expect(top).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-view-mode="relief"]').click();
    await expect(page.locator('[data-view-mode="relief"]')).toHaveAttribute('aria-pressed', 'true');
    /* Reset linked */
    await A.focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator('[data-action="map-reset"][data-map-reset="b"]').click();
    await expect.poll(() => A.getAttribute('data-map-view')).toBe('-0.300,0.920,1.00');
    /* Motion toggles, when the tier offers it */
    if (await motion.isEnabled()) {
      await motion.click();
      await expect(motion).toHaveAttribute('aria-pressed', 'true');
    }
}
