// tests/e2e/obos-v2-boot.spec.ts
import { expect, test } from '@playwright/test';
import { duplicateIds, openV2 } from './obos-v2-helpers';

test.describe('@v2 boot', () => {
  test.setTimeout(180_000);

  /* CI TIME BUDGET (S0 audit F6). Each openV2 waits ~20 s for the engine (longer on the 2-CPU
     SwiftShader runner), so the boot checks that need a live engine share ONE load. The @v2 suite is two Playwright projects
     (chromium-v2-a and -b, tests/e2e/fixtures/v2-split.ts), each budgeted at <= 6.5 min on the dev machine (S8); fold new checks
     into existing loads before adding one. */
  test('@v2 boot: the flag swaps the tree before mount (one main, unique ids, live readouts, no page errors), writes no v1 preference, and an in-place ward switch still works', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openV2(page);
    expect(await duplicateIds(page)).toEqual([]);
    await expect(page.locator('template#obos-v2-tree')).toHaveCount(0);
    await expect(page.locator('#bcount')).not.toHaveText('— buildings');
    const keys = await page.evaluate(() => [localStorage.getItem('obos:panel'), localStorage.getItem('obos:rail')]);
    expect(keys, 'a v2 visit must never write the v1 panel or rail preference').toEqual([null, null]);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('obos:open-area', { detail: { key: 'in/kolkata/baruipur' } })));
    await expect(page).toHaveURL(/\/in\/kolkata\/baruipur\//, { timeout: 30_000 });
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-area', 'in/kolkata/baruipur');
    await expect(page.locator('#crumbArea')).toHaveText('Baruipur');
    expect(errors).toEqual([]);
  });

  test('@v2 ?ui=v1 clears the sticky flag; ?ui=v2 sets it again', async ({ page }) => {
    /* the storage state makes v2 sticky: a plain URL is already v2 (no engine wait needed) */
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('html')).toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('main.obos-v2')).toHaveCount(1);
    await page.goto('/heat-map/in/kolkata/ballygunge/?ui=v1');
    await expect(page.locator('html')).not.toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('main#main.stage:not(.obos-v2)')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('obos:ui'))).toBeNull();
    await page.goto('/heat-map/in/kolkata/ballygunge/?ui=v2');
    await expect(page.locator('main.obos-v2')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('obos:ui'))).toBe('v2');
  });

  test('@v2 the flag survives a hard navigation (cross-city) and a soft (ClientRouter) one; a soft hop to a page with no v2 tree drops it', async ({ page }) => {
    await openV2(page, '/heat-map/in/bengaluru/mg-road/');
    const soft = async (href: string): Promise<void> => {
      await page.evaluate((h) => { document.getElementById('softnav')?.remove(); const a = document.createElement('a'); a.href = h; a.id = 'softnav'; a.textContent = 'soft nav'; a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;padding:8px;background:#fff'; document.body.append(a); }, href);
      await page.locator('#softnav').click();
    };
    await soft('/heat-map/in/kolkata/baruipur/');
    await expect(page).toHaveURL(/baruipur/);
    await expect(page.locator('html')).toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('main.obos-v2')).toHaveCount(1);
    expect(await duplicateIds(page)).toEqual([]);
    /* S0 audit F4: a page with no v2 tree (here /team/; Compare and the brief have one since S9) must not keep data-ui="v2" */
    await soft('/team/');
    await expect(page).toHaveURL(/\/team/);
    await expect(page.locator('html')).not.toHaveAttribute('data-ui', 'v2');
    expect(await page.evaluate(() => localStorage.getItem('obos:ui')), 'the sticky flag itself must survive').toBe('v2');
  });

  test('@v2 SwiftShader (tier 0): Plates by default, flat glass, no backdrop-filter anywhere', async ({ page }, testInfo) => {
    /* chromium-v2-relief also runs this file, on a real GPU where tier 2 is Glass-live by design (obos-v2-glass.spec.ts). */
    test.skip(testInfo.project.name === 'chromium-v2-relief', 'tier 0 is a SwiftShader property');
    await openV2(page);
    const root = page.locator('main.obos-v2');
    await expect(root).toHaveAttribute('data-tier', 'low');
    await expect(root).toHaveAttribute('data-glass', 'flat');
    await expect(root).toHaveAttribute('data-cards', 'plates');
    const blurred = await page.evaluate(() => [...document.querySelectorAll('main.obos-v2 *')]
      .filter((e) => { const v = getComputedStyle(e).backdropFilter; return v && v !== 'none'; }).length);
    expect(blurred).toBe(0);
    /* The assertion above is only as strong as the surfaces it can see: the shell has none yet. So prove the
       CSS itself: a real v2 surface blurs ONLY under glass + live, in both themes (spec §2.2, the S1 audit item). */
    const matrix = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('main.obos-v2')!;
      const probe = document.createElement('div');
      probe.className = 'card'; probe.setAttribute('data-perf-dummy', '');
      root.appendChild(probe);
      const out: string[] = [];
      for (const theme of ['dark', 'light']) for (const cards of ['glass', 'plates']) for (const glass of ['flat', 'live']) {
        root.dataset.theme = theme; root.dataset.cards = cards; root.dataset.glass = glass;
        const cs = getComputedStyle(probe);
        const bf = cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter') || 'none';
        out.push(`${theme}|${cards}|${glass}|${bf === 'none' ? 'none' : 'blur'}`);
      }
      probe.remove();
      return out;
    });
    for (const row of matrix) {
      const [, cards, glass, bf] = row.split('|');
      expect(bf, row).toBe(cards === 'glass' && glass === 'live' ? 'blur' : 'none');
    }
    /* The digits subset really is the fallback where Helvetica Neue is absent (Windows, Android): ask for the
       family directly. Digits and the listed symbols load a woff2 per weight; a letter is outside the unicode-range. */
    const loaded = await page.evaluate(async () => {
      const n = async (weight: number, text: string): Promise<number> => (await document.fonts.load(`${weight} 40px "OBOS Num"`, text)).length;
      return { w300: await n(300, '31.4°'), w400: await n(400, '+12,5%'), w500: await n(500, '−4 – 6:30/7'), letter: await n(400, 'ABC') };
    });
    expect(loaded).toEqual({ w300: 1, w400: 1, w500: 1, letter: 0 });
  });
  /* ── S5.2 ── */
  test('@v2 Dubai (no artefacts): no instrument, the not-yet card centred, a working scope select, data sections disabled', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page, '/heat-map/ae/dubai/al-quoz/');
    await expect(page.locator('#mlmap')).toHaveCount(0);
    const card = page.locator('.notyet');
    await expect(card).toContainText('Open a validated area');
    await expect(card.locator('h1')).toHaveText('Al Quoz');
    await expect(card).toContainText('Nothing here would be a reading, so nothing is drawn.');
    const box = await card.boundingBox(), side = await page.locator('#v2Side').boundingBox();
    expect(box!.x, 'clear of the side panel').toBeGreaterThanOrEqual(side!.x + side!.width);
    const free = (side!.x + side!.width + 1440) / 2;
    expect(Math.abs(box!.x + box!.width / 2 - free), 'centred in the free ground').toBeLessThan(60);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    for (const s of ['heat', 'air', 'solar', 'weather', 'scenarios']) await expect(page.locator(`.nav-item[data-section="${s}"]`)).toBeDisabled();
    await expect(page.locator('.nav-item[data-section="methods"]')).toBeEnabled();
    await expect(page.locator('#scope-area-trigger')).toBeVisible();
    /* A-S5 audit F4: no map here, so the panel must not say "Every result is the live map's own" */
    await expect(page.locator('[data-side-pane="explore"]')).not.toContainText('live map');
    /* nothing looks like it is loading */
    await expect(page.locator('#loadchip, #simBackend, #v2SunCard')).toHaveCount(0);
  });

  test('@v2 Scenarios: v1\'s statement, the live result beside it, and a withdrawn score with no number', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page);
    await page.locator('.nav-item[data-section="scenarios"]').click({ position: { x: 30, y: 22 } });
    const card = page.locator('[data-v2-card="scenario"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Not built yet. The toolbox under Overview runs one scenario at a time and keeps none of them');
    await expect(card).toContainText('src/scripts/climate-engine/dc-urs-scenario.ts');
    await expect(card).toContainText('Resilience Score');
    await expect(card).toContainText('Coming soon');
    await expect(card).toContainText('Withdrawn on 17 Sep 2026. No score is shown until it returns.');
    await expect(page.locator('[data-v2-card="temp"]')).toBeVisible();          // the live result of the current package
    await expect(page.locator('[data-side-pane="explore"] #ivTrees')).toBeVisible();
    expect(await card.innerText()).not.toMatch(/\d+\s*\/\s*100|score of \d/i);
    await page.locator('.nav-item[data-section="overview"]').click({ position: { x: 30, y: 22 } });
    await expect(card).toBeHidden();
  });

  /* A-S5 audit F6: the screen's own card is the first thing on it, wholly above the fold, at the two common laptop sizes */
  for (const [w, h] of [[1440, 900], [1366, 768]] as const) {
    test(`@v2 Scenarios at ${w} x ${h}: the Scenarios card is first and wholly inside the column, the live result follows`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openV2(page);
      await page.locator('.nav-item[data-section="scenarios"]').click({ position: { x: 30, y: 22 } });
      const card = page.locator('[data-v2-card="scenario"]');
      await expect(card).toBeVisible();
      const col = (await page.locator('#legend').boundingBox())!, box = (await card.boundingBox())!, temp = (await page.locator('[data-v2-card="temp"]').boundingBox())!;
      expect(box.y, 'first in the column').toBeLessThan(temp.y);
      expect(box.y + box.height, 'wholly above the fold').toBeLessThanOrEqual(col.y + col.height);
      await expect(page.locator('[data-v2-card="scenario"] .foot')).toBeInViewport();
    });
  }
});
