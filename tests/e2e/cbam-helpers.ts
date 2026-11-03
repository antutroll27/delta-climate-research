// tests/e2e/cbam-helpers.ts — shared by the CBAM specs (phase 5).
import { expect, type Page } from '@playwright/test';

export const CBAM_URL = '/cbam/cbam-calculator/';
export const VIEW_NAMES = ['estimate', 'three-years', 'why', 'list', 'export', 'rules'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

/** By the rail on desktop; by the tab bar (and More) on a phone, as a reader would. */
export async function view(page: Page, name: ViewName): Promise<void> {
  const phone = (page.viewportSize()?.width ?? 1440) < 900;
  if (!phone) {
    await page.locator(`.cbx-rail [data-goto="${name}"]`).click();
  } else if (name === 'export' || name === 'rules') {
    await page.locator('.cbx-more > summary').click();
    await page.locator(`.cbx-more [data-goto="${name}"]`).click();
  } else {
    await page.locator(`.cbx-tabs [data-goto="${name}"]`).click();
  }
  await expect(page.locator(`[data-view="${name}"]`)).toBeVisible();
}

/**
 * Fill the mass and wait until #cbOut shows the figure for IT. The page re-prices on a 250 ms debounce after a mass
 * keystroke, so "the cost is visible" alone is satisfied by the PREVIOUS line's result (a 40 t figure shot beside a
 * 100 t mass). When the mass changes, the cost text must change before the helper returns; an unchanged mass has
 * nothing pending (the other inputs refresh at once).
 */
async function fillMassAndSettle(page: Page, mass: string): Promise<void> {
  const cost = page.locator('#cbOut .cb-cost');
  const massChanged = (await page.inputValue('#cbMass')) !== mass;
  const before = massChanged && await cost.count() ? await cost.first().textContent() : null;
  await page.fill('#cbMass', mass);
  await expect(cost).toBeVisible();
  if (massChanged && before !== null) await expect.poll(async () => cost.first().textContent()).not.toBe(before);
}

/** Cement, Algeria, route (A), 100 t: priced on Commission defaults, and above the 50 t threshold. */
export async function priceLine(page: Page): Promise<void> {
  await page.fill('#cbCn', '2523100090');
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', '2026-03-15');
  await expect(page.locator('#cbCountry option[value="DZ"]')).toBeAttached();
  await page.selectOption('#cbCountry', 'DZ');
  await expect(page.locator('#cbRoute option[value="(A)"]')).toBeAttached();
  await page.selectOption('#cbRoute', '(A)');
  await fillMassAndSettle(page, '100');
}

export interface RefLine { cn: string; country: string; route: string | null; mass: string; date: string }

/** The reference screens' INPUTS (preview NOTES.md), so shots compare like with like. No figure is asserted. */
export const REFERENCE_LINES: readonly RefLine[] = [
  { cn: '73063077', country: 'IN', route: '(C)', mass: '100', date: '2026-03-15' },
  { cn: '25232900', country: 'IN', route: null, mass: '120', date: '2026-05-12' },
  { cn: '76011010', country: 'IN', route: '(K)', mass: '40', date: '2026-08-03' },
];

/** route null: the first route the pack offers (cement prints "default" in the reference). */
export async function priceWith(page: Page, l: RefLine): Promise<void> {
  await page.fill('#cbCn', l.cn);
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', l.date);
  await expect(page.locator(`#cbCountry option[value="${l.country}"]`)).toBeAttached();
  await page.selectOption('#cbCountry', l.country);
  const route = l.route ?? await page.locator('#cbRoute option:not([value=""])').first().getAttribute('value');
  if (route) {
    await expect(page.locator(`#cbRoute option[value="${route}"]`)).toBeAttached();
    await page.selectOption('#cbRoute', route);
  }
  await fillMassAndSettle(page, l.mass);
}
