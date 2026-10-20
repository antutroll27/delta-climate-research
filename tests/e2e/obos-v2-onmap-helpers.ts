// tests/e2e/obos-v2-onmap-helpers.ts — the shared reads of the on-map building card specs (obos-v2-onmap-card, obos-v2-onmap-behaviour).
import { expect, type Page } from '@playwright/test';

export const LAB = '/heat-map/in/kolkata/ballygunge/?lab=1';
export const ROOT = 'main.obos-v2';

/** a roof from the Solar list: the same code path as a map click, minus the pixel hunt */
export async function pick(page: Page, row = 0): Promise<void> {
  await expect(page.locator('#solList tr[data-idx]').nth(row)).toBeAttached({ timeout: 60_000 });
  await page.locator('#solList tr[data-idx]').nth(row).dispatchEvent('click');
}
/** tier 0 opens on the flat map; the apex only exists in 3-D */
export async function relief(page: Page): Promise<void> {
  await page.locator('#modechip button[data-m="relief"]').dispatchEvent('click');
  await expect(page.locator('#modechip button[data-m="relief"]')).toHaveClass(/on/);
}
/** the card has been placed on the map: it is visible and its transform is written */
export async function placed(page: Page): Promise<void> {
  await expect(page.locator('#bcard')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => { const c = document.getElementById('bcard'); return !!c && c.style.transform.includes('translate3d') && getComputedStyle(c).visibility !== 'hidden' && getComputedStyle(c).opacity === '1'; }), { timeout: 60_000 }).toBe(true);
}

/** every visible piece of chrome, as the card must clear it: [data-hud] minus the toasts (the card stays under their row instead) */
export const HUD = `() => [...document.querySelectorAll('[data-hud]')]
  .filter((e) => e.id !== 'v2Toasts' && e.id !== 'bcard' && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]'))
  .map((e) => { const r = e.getBoundingClientRect(); return { n: e.id || e.className, l: r.left, t: r.top, r: r.right, b: r.bottom }; })
  .filter((b) => b.r - b.l > 0 && b.b - b.t > 0)`;

/** the card against the chrome, the brackets and the canvas: an empty array is a clean frame */
export const clash = (page: Page): Promise<string[]> => page.evaluate(`(() => {
  const hud = (${HUD})();
  const card = document.getElementById('bcard').getBoundingClientRect();
  const sel = document.getElementById('bsel').getBoundingClientRect();
  const out = [];
  const hit = (a, b) => a.left < b.r && a.right > b.l && a.top < b.b && a.bottom > b.t;
  for (const h of hud) if (hit(card, h)) out.push('card on ' + h.n);
  if (card.top < 66 - 0.5) out.push('card above the top row: ' + card.top);
  if (card.left < 12 - 0.5 || card.right > innerWidth - 12 + 0.5 || card.bottom > innerHeight - 12 + 0.5) out.push('card outside the margin ' + JSON.stringify(card));
  if (hit(card, { l: sel.left, t: sel.top, r: sel.right, b: sel.bottom })) out.push('card on the brackets');
  return out;
})()`);


/** the picked roof is carried by the map: pan the camera so the SAME roof stands at screen (x, y). It stashes the roof's lng/lat on first use, so a roof panned off screen can be panned back. */
export async function panRoofTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(`(() => {
    const map = window.__obosMap;
    map.setMaxBounds(null);   // the ward's bounds would stop a roof from being panned off the top or bottom
    if (!window.__roofLL) { const s = document.getElementById('bsel').getBoundingClientRect(); window.__roofLL = map.unproject([s.left + s.width / 2, s.top + s.height / 2]); }
    /* the camera is pitched, so one translation undershoots: walk the centre until the roof is within 1.5 px */
    for (let i = 0; i < 25; i++) {
      const now = map.project(window.__roofLL), at = map.project(map.getCenter());
      if (Math.hypot(now.x - ${x}, now.y - ${y}) < 1.5) break;
      map.jumpTo({ center: map.unproject([at.x + (now.x - ${x}), at.y + (now.y - ${y})]) });
    }
  })()`);
  await page.waitForTimeout(700);   // a map render, the app's 250 ms chrome read, the card's own write
}
/** the card's state after a pan: hidden, or its size and side (the lead is hidden with data-side="dock") */
export const cardState = (page: Page): Promise<{ visible: boolean; side: string | undefined; h: number; apex: { x: number; y: number } }> => page.evaluate(() => {
  const c = document.getElementById('bcard')!;
  const s = document.getElementById('bsel')!.getBoundingClientRect();
  return { visible: getComputedStyle(c).visibility !== 'hidden', side: c.dataset.side, h: c.getBoundingClientRect().height, apex: { x: Math.round(s.left + s.width / 2), y: Math.round(s.top + s.height / 2) } };
});
