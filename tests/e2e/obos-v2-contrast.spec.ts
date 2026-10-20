// tests/e2e/obos-v2-contrast.spec.ts — OBOS v2 spec §7.1 (S8): every word, against the pixels it is drawn on, in all four theme x card combinations.
/**
 * THE SWEEP. contrastFailures (obos-v2-helpers, copied verbatim from console-contrast.spec.ts) scores each text node against the dominant colour inside its own
 * box in the rendered frame, so a translucent card over a live map is judged on the map it is really over. AA: 4.5:1, 3:1 for large text.
 *
 *   · chromium-v2 (SwiftShader, tier 0): the COMPACT set (Overview, Air, the building card) in the four combinations. Glass is flat there (0.94 fill): it is the
 *     fill a tier-0 reader gets, and it is judged as such. Plates dark and light are the default look.
 *   · chromium-v2-relief (Metal, tier 2, local): the FULL set, every screen and every popover, with Glass LIVE (blur over the real canvas), including Light Glass over the
 *     bright Clay map and both cross-pairings of theme and map look (D1: they are independent).
 *   · the phone (390x844, Plates: phones are flat): the closed and the open sheet, the drawer, every section.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { stubAir } from './aqi-cpcb-stub.ts';
import { openV2, phoneIssues, report, SCORED, stubAt, sweepScreen } from './obos-v2-helpers';

/** a sweep that scored almost nothing proves nothing: every screen must have been read (the smallest, Air's pane or the closed phone sheet, has well over this many words) */
const MIN_SCORED = 60;        // a desktop screen has 99-126 scored words
const MIN_SCORED_PHONE = 20;  // the phone's closed sheet has 25

const go = (page: Page, section: string) => page.locator(`.nav-item[data-section="${section}"]`).click({ position: { x: 30, y: 22 } });
const settle = (page: Page) => page.waitForTimeout(1800);
const isFull = (t: TestInfo): boolean => t.project.name === 'chromium-v2-relief';

async function prime(page: Page, theme: string, cards: string, look?: 'dark' | 'studio', at = '2026-10-07T06:05:00Z'): Promise<void> {
  await stubAir(page, { nowcast: true });
  /* A FIXED DAYTIME (11:35 IST): the Sun card draws its azimuth glyph (a red N at 5.5 px) only while the sun is up, so a sweep on the wall clock passed at night and failed at noon. */
  await stubAt(page, at);
  await page.addInitScript(([t, c, l]) => {
    try {
      localStorage.setItem('obos:v2:theme', t); localStorage.setItem('obos:v2:cards', c);
      if (l) localStorage.setItem('obos:v2:look-chosen', '1');       // a chosen look is never re-paired with the theme (D1)
    } catch { /* none */ }
  }, [theme, cards, look ?? ''] as const);
}
/** the map look is the app's own #envchip (in the Layers popover); clicked in place so the popover need not be open */
async function setLook(page: Page, look: 'dark' | 'studio'): Promise<void> {
  await page.evaluate((l) => (document.querySelector(`#envchip button[data-e="${l}"]`) as HTMLElement).click(), look);
  await page.waitForTimeout(4000);
}

/** the building card, by the deterministic row path (a canvas click is not) */
async function openBuilding(page: Page): Promise<void> {
  await go(page, 'solar');
  await expect(page.locator('#solList tr[data-idx]').first()).toBeAttached({ timeout: 60_000 });
  await page.locator('#solList tr[data-idx]').first().dispatchEvent('click');
  await freezeOrbit(page, true);   // at once: the orbit resumes 2.5 s after a row pick, and the card follows the roof
  await expect(page.locator('#bcard')).toBeVisible({ timeout: 30_000 });
  /* the card is ON THE MAP now (brainstorm 04): its words are scored like any other, with its fold and its how-sure ladder open (a capped card scrolls inside itself: sweepScreen reads it at 50% and 100%) */
  await page.locator('#bcFold summary').click();
  await page.locator('#bcSure summary').click();
  await page.waitForTimeout(1500);
}
/* The card follows the roof, and the sweep skips what moved between its two reads (on a real GPU the orbit moves it every frame: 41 of 130 words were scored once). A key press on the canvas
   pauses the idle orbit for 2.5 s, so it is re-pressed every 400 ms for as long as the building is open (freezeOrbit(false) stops it). */
async function freezeOrbit(page: Page, on: boolean): Promise<void> {
  await page.evaluate((go) => {
    const w = window as unknown as { __freeze?: number };
    if (w.__freeze) { clearInterval(w.__freeze); w.__freeze = 0; }
    if (go) { const nudge = (): void => { document.querySelector('#mlmap canvas')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); }; nudge(); w.__freeze = window.setInterval(nudge, 400); }
  }, on);
  if (on) await page.waitForTimeout(600);
}

for (const theme of ['dark', 'light'] as const) for (const cards of ['plates', 'glass'] as const) {
  test(`@v2 contrast: every word clears AA over the live map · ${theme} · ${cards}`, async ({ page }, testInfo) => {
    test.setTimeout(isFull(testInfo) ? 420_000 : 240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await prime(page, theme, cards);
    await openV2(page);
    await settle(page);
    /* the point of the relief run: Glass is LIVE there (blur over the real canvas); everywhere else a chosen Glass is the flat 0.94 fill, and Plates never blur */
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-glass', isFull(testInfo) && cards === 'glass' ? 'live' : 'flat');
    const label = `${theme}/${cards}`;
    const found: string[] = [];
    const view = async (name: string, show: () => Promise<void>): Promise<void> => {
      await show(); await settle(page);
      found.push(...(await sweepScreen(page, `${label} ${name}`)));
      /* every screen's controls are 24 px or more (spec 7.2): the same live-page read the phone sweep uses, for its target rule only */
      if (isFull(testInfo)) found.push(...(await phoneIssues(page)).filter((l) => l.startsWith('target under 24 px')).map((l) => `${label} ${name}: ${l}`));
    };
    await view('overview', async () => {});
    await view('air', async () => { await go(page, 'air'); await expect(page.locator('#aqiBlock')).toBeVisible({ timeout: 30_000 }); });
    await view('building', async () => { await openBuilding(page); });
    if (isFull(testInfo)) {
      await freezeOrbit(page, false);
      await page.keyboard.press('Escape');
      for (const s of ['heat', 'solar', 'weather', 'scenarios']) await view(s, async () => { await go(page, s); });
      await view('methods', async () => { await go(page, 'methods'); await page.locator('#srcBtn').click(); });
      /* the open Area list (SelectField's listbox: the active row, the tier chip) is a state nothing else paints */
      await view('area list open', async () => { await go(page, 'overview'); await page.locator('#scope-area-trigger').focus(); await page.keyboard.press('ArrowDown'); await expect(page.locator('#scope-area-trigger')).toHaveAttribute('aria-expanded', 'true'); await page.keyboard.press('ArrowDown'); });
      await page.keyboard.press('Escape');
      for (const [name, opener] of [['key', '.key-btn'], ['layers', '.tab[data-pop-open="layers"]'], ['credits', '.st-attrib .attrib']] as const) {
        await view(name, async () => { await page.locator(opener).click(); });
        await page.keyboard.press('Escape');
      }
    }
    for (const [k, n] of SCORED) if (k.startsWith(label)) console.log(`[contrast] ${k}: scored ${n} text nodes`);
    for (const [k, n] of SCORED) if (k.startsWith(label)) expect(n, `${k}: the sweep scored ${n} text nodes`).toBeGreaterThanOrEqual(MIN_SCORED);
    expect(found, report(label, []) + '\n' + found.join('\n')).toEqual([]);
  });
}

/* rc3: the expanded rail is thinner (184 px). At 1280 x 720 (the laptop band) the menu is expanded by choice with the side panel closed: its labels sit closer to the pill's edge,
   so they are judged on their own, in both themes, as well as on the pill of the current page. */
for (const theme of ['dark', 'light'] as const) {
  test(`@v2 contrast: the thinner expanded rail at 1280 x 720 · ${theme} · plates`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await prime(page, theme, 'plates');
    await page.addInitScript(() => { try { localStorage.setItem('obos:v2:menu', 'labels'); localStorage.setItem('obos:v2:side', 'closed'); } catch { /* none */ } });
    await openV2(page);
    await settle(page);
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-menu-eff', 'labels');
    const found = await sweepScreen(page, `${theme}/plates 1280 x 720 labels · overview`);
    const rail = found.filter((l) => /nav-label|rail/.test(l));
    expect(rail, rail.join('\n')).toEqual([]);
    expect(found, found.join('\n')).toEqual([]);
    expect(SCORED.get(`${theme}/plates 1280 x 720 labels · overview`) ?? 0).toBeGreaterThanOrEqual(MIN_SCORED);
  });
}

test('@v2 contrast: Light Glass over the BRIGHT map and Dark Glass over the DARK map, each the other way round too (D1: look and theme are independent)', async ({ page }, testInfo) => {
  test.skip(!isFull(testInfo), 'live Glass over the real canvas: the relief project (Metal) only');
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const found: string[] = [];
  for (const [theme, look] of [['light', 'studio'], ['light', 'dark'], ['dark', 'studio'], ['dark', 'dark']] as const) {
    const p = await page.context().newPage();
    await p.setViewportSize({ width: 1440, height: 900 });
    await prime(p, theme, 'glass', look);
    await openV2(p);
    await setLook(p, look);
    await settle(p);
    found.push(...(await sweepScreen(p, `${theme} glass on the ${look} map · overview`)));
    await go(p, 'air'); await settle(p);
    found.push(...(await sweepScreen(p, `${theme} glass on the ${look} map · air`)));
    await p.close();
  }
  expect(found, found.join('\n')).toEqual([]);
});

test('@v2 contrast: after dark (00:30 IST) the Sun card says "Below horizon" and every word still clears AA', async ({ page }, testInfo) => {
  test.skip(!isFull(testInfo), 'the compact set judges the daytime screens; the night variant is the relief project\'s');
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const found: string[] = [];
  for (const theme of ['dark', 'light'] as const) {
    const p = await page.context().newPage();
    await p.setViewportSize({ width: 1440, height: 900 });
    await prime(p, theme, 'plates', undefined, '2026-10-07T19:00:00Z');
    await openV2(p);
    await settle(p);
    await expect(p.locator('#v2SunCard')).toContainText(/Below\s*horizon/, { timeout: 30_000 });
    found.push(...(await sweepScreen(p, `${theme}/plates at night · overview`)));
    await go(p, 'weather'); await settle(p);
    found.push(...(await sweepScreen(p, `${theme}/plates at night · weather`)));
    await p.close();
  }
  expect(found, found.join('\n')).toEqual([]);
});

test.describe('@v2 contrast on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const theme of ['dark', 'light'] as const) {
    test(`@v2 contrast: the phone's sheet, drawer and every section clear AA · ${theme} · plates`, async ({ page }, testInfo) => {
      test.setTimeout(isFull(testInfo) ? 420_000 : 240_000);
      await page.addInitScript(() => { try { sessionStorage.setItem('obos:entry-note-seen', '1'); sessionStorage.setItem('obos:rotate-nudge-dismissed', '1'); } catch { /* none */ } });
      await prime(page, theme, 'plates');
      await openV2(page);
      await settle(page);
      const found: string[] = [];
      const label = `phone ${theme}/plates`;
      found.push(...(await sweepScreen(page, `${label} closed sheet`)));
      await page.locator('[data-v2-menu]').click();
      await settle(page);
      found.push(...(await sweepScreen(page, `${label} drawer (Explore)`)));
      await page.keyboard.press('Escape');
      const sections = isFull(testInfo) ? ['overview', 'heat', 'air', 'solar', 'weather', 'scenarios', 'methods'] : ['overview', 'air'];
      for (const s of sections) {
        await page.locator('[data-v2-menu]').click();
        await page.locator(`#v2Drawer .nav-item[data-section="${s}"]`).click();
        await settle(page);
        found.push(...(await sweepScreen(page, `${label} ${s}`)));
        if (isFull(testInfo) && (s === 'air' || s === 'solar')) {
          await page.locator('[data-v2-menu]').click(); await settle(page);
          found.push(...(await sweepScreen(page, `${label} drawer (${s})`)));
          await page.keyboard.press('Escape');
        }
      }
      for (const [k, n] of SCORED) if (k.startsWith(label)) console.log(`[contrast] ${k}: scored ${n} text nodes`);
      for (const [k, n] of SCORED) if (k.startsWith(label)) expect(n, `${k}: the sweep scored ${n} text nodes`).toBeGreaterThanOrEqual(MIN_SCORED_PHONE);
      expect(found, found.join('\n')).toEqual([]);
    });
  }
});
