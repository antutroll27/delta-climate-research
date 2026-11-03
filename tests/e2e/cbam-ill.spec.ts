// tests/e2e/cbam-ill.spec.ts — spec §8.1-8.2: each illustration on its tile; none over a word.
import { expect, test, type Page } from '@playwright/test';
import { CBAM_URL, priceLine, view, type ViewName } from './cbam-helpers';

/** The table settled in plan 05 (P5-1). priceLine prices cement, so step 1 shows the bag. The titles are the DOM's:
 *  the mass label carries its visually hidden unit, and the de minimis heading carries its year (L6). */
const EXPECT: ReadonlyArray<readonly [ViewName, string, string]> = [
  ['estimate', 'good-bag', 'Good.'], ['estimate', 'origin', 'Origin & route.'], ['estimate', 'date', 'Import date.'],
  ['estimate', 'mass', 'Net mass. In tonnes.'], ['estimate', 'fac', 'Chargeable.'], ['estimate', 'vou', 'Chargeable.'],
  ['why', 'steps', 'Mark-up share.'], ['why', 'scale', 'Charged.'],
  ['list', 'box', 'Total.'], ['list', 'gauge', 'Annual de minimis, 2026.'],
  ['rules', 'shield', 'Framing.'],
];

/** Every illustration in the visible view, as "view|name|its tile's title". */
const present = (page: Page, v: ViewName) => page.evaluate((name) =>
  Array.from(document.querySelectorAll<SVGSVGElement>(`[data-view="${name}"] svg.b-ill, [data-view="${name}"] svg[data-ill="shield"]`))
    .map((s) => `${name}|${s.dataset.ill}|${s.closest('.b-t')?.querySelector('.b-t-ti')?.textContent?.trim() ?? '(no tile)'}`), v);

/** Each drawn shape of each illustration against every word and control in its tile. */
const overlaps = (page: Page, v: ViewName) => page.evaluate((name) => {
  const out: string[] = [];
  const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  for (const svg of Array.from(document.querySelectorAll<SVGSVGElement>(`[data-view="${name}"] svg.b-ill`))) {
    const tile = svg.closest('.b-t');
    if (!tile) { out.push(`${svg.dataset.ill}: not inside a tile`); continue; }
    const shapes = Array.from(svg.children).map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
    const marks: { what: string; r: DOMRect }[] = [];
    const walk = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent?.trim();
      if (!t || n.parentElement?.closest('svg')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) if (r.width && r.height) marks.push({ what: `"${t.slice(0, 40)}"`, r });
    }
    for (const el of Array.from(tile.querySelectorAll<HTMLElement>('button, input, select, .b-thr, .b-share, .b-waffle, .b-fp'))) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) marks.push({ what: `<${el.tagName.toLowerCase()} ${el.className}>`, r });
    }
    for (const m of marks) if (shapes.some((s) => hit(s, m.r))) out.push(`${svg.dataset.ill} overlaps ${m.what}`);
  }
  return out;
}, v);

for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]] as const) {
  test(`illustrations sit on their tiles and never overlap a word at ${w} px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ reducedMotion: 'reduce' });   // final positions, not mid-rise
    await page.goto(CBAM_URL);
    await priceLine(page);
    await page.click('#cbAdd');
    const found: string[] = [];
    const problems: string[] = [];
    for (const v of ['estimate', 'why', 'list', 'export', 'rules'] as const) {
      await view(page, v);
      found.push(...await present(page, v));
      problems.push(...(await overlaps(page, v)).map((p) => `${v} @${w}: ${p}`));
    }
    expect(found.sort()).toEqual(EXPECT.map(([v, n, t]) => `${v}|${n}|${t}`).sort());
    expect(problems).toEqual([]);
  });
}
