// tests/e2e/obos-v2-onmap-card.spec.ts — OBOS v2 on-map building card (brainstorm 04, founder option C, 20 Oct): PLACEMENT and the right column.
/**
 * THE CARD ON THE MAP, MEASURED. v1 stood the building card beside the selected roof with a lead line to its apex; rc3 put it in the right column. Option C puts
 * it back on the map in v2 type: placed by a keep-out solver clear of every piece of chrome, following the roof by transform only, with the right column folded
 * away while a building is selected. The solver itself is pinned in tests/unit/obos-v2-place-card.test.mjs; this file measures the page (its content, keys, the two rc3
 * bugs and the phone are in obos-v2-onmap-behaviour.spec.ts, the other half of the same budget). Every test is headless. Placement needs a roof's apex, so the map is
 * put in 3-D relief (tier 0 opens flat, and a flat map has nothing to project from).
 */
import { expect, test } from '@playwright/test';
import { openV2, duplicateIds, stubWeather } from './obos-v2-helpers';
import { LAB, ROOT, pick, relief, placed, HUD, clash } from './obos-v2-onmap-helpers';

test.describe('@v2 on-map building card: placement', () => {
  test.setTimeout(300_000);
  for (const [w, h] of [[1440, 900], [1366, 768], [1280, 720], [1920, 1080]] as const) {
    test(`@v2 [H] at ${w} x ${h} the card stands beside the roof, clear of every piece of chrome, and the lead ends on the brackets`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await stubWeather(page, '2026-10-07T06:05:00Z');
      await openV2(page, LAB);
      await relief(page);
      await pick(page);
      await placed(page);
      await page.waitForTimeout(1500);   // the 700 ms camera move, and the app's 250 ms chrome read
      expect(await clash(page)).toEqual([]);
      const g = await page.evaluate(() => {
        const r = (id: string) => document.getElementById(id)!.getBoundingClientRect();
        const dot = document.querySelector('#bcard .lead-dot')!.getBoundingClientRect();
        const c = r('bcard'), s = r('bsel');
        return { card: { l: c.left, t: c.top, r: c.right, b: c.bottom }, sel: { l: s.left, t: s.top, r: s.right, b: s.bottom }, dot: { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 }, side: document.getElementById('bcard')!.dataset.side };
      });
      /* the lead's end (its dot) is on the bracket box's edge that faces the card, within 2 px */
      const edgeX = g.side === 'left' ? g.sel.l : g.sel.r, midY = (g.sel.t + g.sel.b) / 2;
      expect(Math.abs(g.dot.x - edgeX), `lead end x ${g.dot.x} vs the bracket edge ${edgeX}`).toBeLessThanOrEqual(2);
      expect(Math.abs(g.dot.y - midY), `lead end y ${g.dot.y} vs the bracket middle ${midY}`).toBeLessThanOrEqual(2);
      expect(g.side === 'left' ? g.card.r <= g.sel.l : g.card.l >= g.sel.r, 'the card is beside the brackets, not over them').toBe(true);
      /* the card is whole or scrolls inside its own height cap: never taller than the free canvas */
      expect(g.card.b - g.card.t).toBeLessThanOrEqual(h - 12 - 66 + 1);
    });
  }

  test('@v2 [H] a 30 s orbit: the card never touches the chrome, follows the roof by transform only, and keeps its side', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page, LAB);
    await relief(page);
    await pick(page);
    await placed(page);
    await page.waitForTimeout(3600);   // the app pauses the orbit for 2.5 s after a row pick, then resumes it
    const r = await page.evaluate(`new Promise((resolve) => {
      const hud = ${HUD};
      const card = document.getElementById('bcard'), map = window.__obosMap;
      const watch = [card, card.querySelector('.lead'), card.querySelector('.lead-dot')].filter(Boolean);
      const props = new Set();
      const mo = new MutationObserver((ms) => { for (const m of ms) for (const n of m.target.style) props.add(n); });
      for (const e of watch) mo.observe(e, { attributes: true, attributeFilter: ['style'] });
      const bearing0 = map.getBearing(), sides = new Set(), bad = [];
      let n = 0, nextAt = 0; const t0 = performance.now();
      const hit = (a, b) => a.left < b.r && a.right > b.l && a.top < b.b && a.bottom > b.t;
      const tick = (t) => {
        if (t >= nextAt) {
          nextAt = t + 250; n++;
          map.setBearing(bearing0 + (t - t0) / 1000 * 1.5);   // the app's own orbit is 1.4 deg/s and a software renderer paints only a few frames a second: sweep 45 deg regardless of the frame rate
          const c = card.getBoundingClientRect(), s = document.getElementById('bsel').getBoundingClientRect();
          sides.add(card.dataset.side);
          for (const h of hud()) if (hit(c, h)) bad.push(Math.round(t - t0) + 'ms: card on ' + h.n);
          if (c.top < 65.5 || c.left < 11.5 || c.right > innerWidth - 11.5 || c.bottom > innerHeight - 11.5) bad.push(Math.round(t - t0) + 'ms: outside ' + JSON.stringify(c));
          if (hit(c, { l: s.left, t: s.top, r: s.right, b: s.bottom })) bad.push(Math.round(t - t0) + 'ms: on the brackets');
        }
        if (t - t0 < 30000) requestAnimationFrame(tick);
        else { mo.disconnect(); resolve({ n, bad: bad.slice(0, 8), moved: Math.abs(map.getBearing() - bearing0), sides: [...sides], props: [...props] }); }
      };
      requestAnimationFrame(tick);
    })`) as { n: number; bad: string[]; moved: number; sides: string[]; props: string[] };
    expect(r.moved, 'the camera really turned').toBeGreaterThan(30);
    expect(r.n, 'sampled throughout').toBeGreaterThan(20);
    expect(r.bad).toEqual([]);
    expect(r.sides.length, `the card changed side during the orbit: ${r.sides}`).toBe(1);
    expect(r.props.filter((p) => !['transform', 'opacity', 'visibility'].includes(p)), 'every per-frame write is transform, opacity or visibility: no layout').toEqual([]);
  });

  test('@v2 [H] a flat map (no relief, so no apex): the card docks at the right and still clears the chrome; no lead line is drawn', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page, LAB);
    await page.locator('#modechip button[data-m="iso"]').dispatchEvent('click');
    await pick(page);
    await placed(page);
    const hud = await page.evaluate(`(${HUD})()`) as Array<{ n: string; l: number; t: number; r: number; b: number }>;
    const c = (await page.locator('#bcard').boundingBox())!;
    for (const h of hud) expect(c.x < h.r && c.x + c.width > h.l && c.y < h.b && c.y + c.height > h.t, `card on ${h.n}`).toBe(false);
    expect(c.x + c.width).toBeGreaterThan(1440 - 40);
    await expect(page.locator('#bcard .lead')).toBeHidden();
  });
});

test.describe('@v2 on-map building card: the right column', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@v2 [H] the column folds while a building is selected; "Ward readings" brings it back; deselecting restores it', async ({ page }) => {
    await openV2(page, LAB);
    await relief(page);
    const col = page.locator('#legend'), pill = page.locator('#v2ReadingsPill');
    await expect(col).toBeVisible();
    await expect(pill).toBeHidden();
    await pick(page);
    await placed(page);
    await expect(page.locator(ROOT)).toHaveAttribute('data-readings', 'folded');
    await expect(col, 'the folded column is out of sight').toBeHidden();
    expect(await col.evaluate((e) => (e as HTMLElement).inert), 'and inert').toBe(true);
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/Ward readings/);
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
    /* the pill brings the column back while the building stays selected, and the card moves to fit around it */
    await pill.click();
    await expect(col).toBeVisible();
    expect(await col.evaluate((e) => (e as HTMLElement).inert)).toBe(false);
    await expect(page.locator('#bcard')).toBeVisible();
    await expect(pill).toBeHidden();
    await page.waitForTimeout(1200);
    expect(await clash(page), 'with the column back, the card clears it too').toEqual([]);
    /* deselecting also restores it; the next selection folds it again */
    await page.keyboard.press('Escape');
    await expect(page.locator('#bcard')).toBeHidden();
    await expect(col).toBeVisible();
    await expect(page.locator(ROOT)).not.toHaveAttribute('data-readings', 'folded');
    await pick(page, 1);
    await placed(page);
    await expect(col).toBeHidden();
    await page.locator('#bcX').click();
    await expect(page.locator('#bcard')).toBeHidden();
    await expect(col).toBeVisible();
    await expect(pill).toBeHidden();
    expect(await duplicateIds(page), 'every v1 id exists once').toEqual([]);
  });
});

