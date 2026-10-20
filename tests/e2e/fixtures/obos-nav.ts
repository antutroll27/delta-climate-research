// tests/e2e/fixtures/obos-nav.ts — the v1 console's navigation, spoken in v2's controls (flip plan B.2.1, brainstorm 03 §3a).
/**
 * v1's rail buttons (`[data-rail=X]`), the map-look chip (`#envchip`) and the view chip (`#modechip`) are v2's menu items, and its Layers popover. The ids inside the popover were kept, so a
 * spec that only needs the CONTROL says what it wants here and the v2 path is in one place.
 */
import { expect, type Page } from '@playwright/test';

/** v1 rail id -> v2 menu section. `map` is Overview, `reports` is Data & methods; `layers` is not a section (see openLayers). */
const SECTION: Readonly<Record<string, string>> = { map: 'overview', air: 'air', solar: 'solar', reports: 'methods', scenarios: 'scenarios' };

/** Open a menu section by its v1 name. Clicks the item's ICON: in icons mode the item's centre is clipped away (S2 audit F10, obos-v2-shell.spec.ts). */
export async function openSection(page: Page, v1Name: keyof typeof SECTION | string): Promise<void> {
  const id = SECTION[v1Name] ?? v1Name;
  await page.locator(`.nav-item[data-section="${id}"]`).click({ position: { x: 30, y: 22 } });
}

/** Open the Layers popover (v1's Layers rail item / pane) and leave it open. */
export async function openLayers(page: Page): Promise<void> {
  if (await page.locator('#v2Layers').isVisible()) return;
  await page.locator('[data-pop-open="layers"]').click();
  await expect(page.locator('#v2Layers')).toBeVisible();
}

/** Run a control that lives in the Layers popover, then close the popover with Esc (it closes only itself) so the map is clickable again. */
async function inLayers(page: Page, act: () => Promise<void>): Promise<void> {
  await openLayers(page);
  await act();
  await page.keyboard.press('Escape');
  await expect(page.locator('#v2Layers')).toBeHidden();
}

/** v1's `#modechip button[data-m]`: 3D Relief / 2D Isotherm. */
export const setViewMode = (page: Page, mode: 'relief' | 'iso'): Promise<void> =>
  inLayers(page, async () => { await page.locator(`#v2Layers #modechip button[data-m="${mode}"]`).click(); });

/** v1's `#envchip button[data-e]`: Dark map / Clay studio. */
export const setMapLook = (page: Page, look: 'dark' | 'studio'): Promise<void> =>
  inLayers(page, async () => { await page.locator(`#v2Layers #envchip button[data-e="${look}"]`).click(); });

/**
 * v1's ward strip (`#strip .ward[data-w]`) is v2's place chips in the dock, which show only while the side panel is closed (obos-v2-keyboard.spec.ts reaches them that way and owns their
 * visibility). A spec that is about WHAT SWITCHING A WARD DOES (the route, the receipts, the prefetch, the rollback) fires the chip's own click handler instead, so it does not depend on the panel's state.
 */
export const clickWard = (page: Page, w: string): Promise<void> =>
  page.locator(`#strip .ward[data-w="${w}"]`).evaluate((e) => (e as HTMLElement).click());
