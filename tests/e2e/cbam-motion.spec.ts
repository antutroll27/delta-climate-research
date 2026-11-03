// tests/e2e/cbam-motion.spec.ts — spec §8.3 (entry motion) and §9 (first paint with the pack loading).
import { expect, test, type Page } from '@playwright/test';
import { CBAM_URL, VIEW_NAMES, priceLine, view, type ViewName } from './cbam-helpers';

const entry = (page: Page, v: ViewName) => page.evaluate((name) => {
  const sec = document.querySelector(`[data-view="${name}"]`)!;
  const anims = sec.getAnimations({ subtree: true }).filter((a) => 'animationName' in a);
  return { on: sec.classList.contains('b-anim'), n: anims.length, early: anims.filter((a) => Number(a.currentTime ?? 0) < 600).length };
}, v);

test.describe('CBAM entry motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('entering a view replays the entry animation, and the class leaves when it ends', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(CBAM_URL);
    await priceLine(page);
    await view(page, 'why');
    const first = await entry(page, 'why');
    expect(first.on).toBe(true);
    expect(first.n).toBeGreaterThan(0);
    await expect(page.locator('[data-view="why"]')).not.toHaveClass(/\bb-anim\b/, { timeout: 8_000 });
    await view(page, 'estimate');
    await view(page, 'why');
    const again = await entry(page, 'why');
    expect(again.on).toBe(true);
    expect(again.early).toBeGreaterThan(0);   // restarted, not resumed
  });

  test('every entry animation on every view touches transform and opacity only', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(CBAM_URL);
    await priceLine(page);
    await page.click('#cbAdd');
    const seen = new Set<string>();
    let total = 0;
    for (const v of VIEW_NAMES) {
      await view(page, v);
      const r = await page.evaluate((name) => {
        const keys: string[] = [];
        const anims = document.querySelector(`[data-view="${name}"]`)!.getAnimations({ subtree: true }).filter((a) => 'animationName' in a);
        for (const a of anims) for (const kf of (a.effect as KeyframeEffect).getKeyframes()) keys.push(...Object.keys(kf));
        return { keys, n: anims.length };
      }, v);
      r.keys.forEach((k) => seen.add(k));
      total += r.n;
    }
    expect(total).toBeGreaterThan(0);
    const META = new Set(['offset', 'computedOffset', 'easing', 'composite']);
    for (const k of seen) if (!META.has(k)) expect(['opacity', 'transform'], `animated property ${k}`).toContain(k);
  });

  test('reduced motion switches every entry animation off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(CBAM_URL);
    await priceLine(page);
    for (const v of ['why', 'estimate'] as const) {
      await view(page, v);
      expect((await entry(page, v)).n, v).toBe(0);
    }
  });

  test('stagger indices are set on every render', async ({ page }) => {
    await page.goto(CBAM_URL);
    await priceLine(page);
    await view(page, 'why');
    const read = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-view="why"] .b-waffle > *'))
      .map((c) => ({ i: c.style.getPropertyValue('--i'), old: c.dataset.old === '1' })));
    const before = await read();
    expect(before.length).toBeGreaterThan(0);
    expect(before.map((c) => c.i)).toEqual(before.map((_, i) => String(i)));
    await page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-view="why"] .b-waffle > *').forEach((c) => { c.dataset.old = '1'; }));
    await view(page, 'estimate');
    // A mass does not change the waffle (it is a share of the emissions), so the trigger is another import year.
    await page.fill('#cbDate', '2027-03-15');
    await view(page, 'why');
    await expect.poll(async () => (await read()).some((c) => c.old), { timeout: 10_000 }).toBe(false);   // really re-rendered
    const after = await read();
    expect(after.length).toBeGreaterThan(0);
    expect(after.map((c) => c.i)).toEqual(after.map((_, i) => String(i)));
  });

  test('P5-M2: after a line change, Why is drawn once while hidden and is not replaced after it is shown', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(CBAM_URL);
    await priceLine(page);
    await page.click('#cbAdd');
    await view(page, 'why');
    await view(page, 'estimate');
    await expect(page.locator('[data-view="why"]')).toBeHidden();
    // From here every replacement of the Why cards is a childList record on #cbGraphs, stamped with
    // the time and whether the view was shown (width > 0) when it happened.
    await page.evaluate(() => {
      const w = window as unknown as { __rec: { t: number; shown: boolean }[]; __tShown: number };
      const g = document.querySelector<HTMLElement>('#cbGraphs')!;
      w.__rec = []; w.__tShown = -1;
      new MutationObserver((rs) => { for (const r of rs) if (r.target === g) w.__rec.push({ t: performance.now(), shown: g.clientWidth > 0 }); })
        .observe(g, { childList: true });
      const tick = () => { if (w.__tShown < 0 && g.clientWidth > 0) w.__tShown = performance.now(); else if (w.__tShown < 0) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await page.fill('#cbMass', '120');                 // a different line: the graphs are repainted while hidden
    await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
    await page.waitForTimeout(600);                    // the debounced recalculation has settled
    const hidden = await page.evaluate(() => (window as unknown as { __rec: { shown: boolean }[] }).__rec.length);
    expect(hidden, 'one drawing while hidden, not an estimate and a measure').toBe(1);
    await view(page, 'why');
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const w = window as unknown as { __rec: { t: number; shown: boolean }[]; __tShown: number };
      return { tShown: w.__tShown, after: w.__rec.filter((x) => x.shown || x.t >= w.__tShown).map((x) => Math.round(x.t - w.__tShown)) };
    });
    expect(r.tShown, 'the view was seen shown').toBeGreaterThan(0);
    // The drawing at the shown width (an estimate, then the measured widths) runs in the frame the view
    // appears, before paint. A second drawing a debounce later replaced every card mid entry animation
    // (a long task, and the animations restarted).
    expect(r.after.filter((ms) => ms > 80), `replacements more than 80 ms after the view appeared: ${JSON.stringify(r.after)}`).toEqual([]);
    expect(r.after.length, `drawings once shown: ${JSON.stringify(r.after)}`).toBeLessThanOrEqual(2);
  });

  test('spec §9: the shell paints while the pack is still loading', async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/*estimator-pack*.json', async (route) => { await held; await route.continue(); });
    await page.goto(CBAM_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.cbx-rail')).toBeVisible();
    await expect(page.locator('#cbxH-estimate')).toBeVisible();
    release();
  });
});
