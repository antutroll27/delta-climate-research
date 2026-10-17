// tests/e2e/obos-v2-boot.spec.ts
import { expect, test } from '@playwright/test';
import { duplicateIds, openV2 } from './obos-v2-helpers';

test.describe('@v2 boot', () => {
  test.setTimeout(180_000);

  /* CI TIME BUDGET (S0 audit F6). Each openV2 waits ~20 s for the engine (longer on the 2-CPU
     SwiftShader runner), so the boot checks that need a live engine share ONE load. The whole
     @v2 suite is budgeted at <= 6 min in CI; fold new checks into existing loads before adding one. */
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
    /* S0 audit F4: compare has no v2 tree yet (S9), so the soft hop must not leave data-ui="v2" on it */
    await soft('/heat-map/compare/');
    await expect(page).toHaveURL(/\/heat-map\/compare/);
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
  });
});
