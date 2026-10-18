// tests/e2e/obos-v2-a11y.spec.ts — OBOS v2 spec §7.10 (S8): axe over Overview, Air and the building card in both themes, and the phone's drawer and sheet.
/**
 * Zero violations at ANY impact (the spec asks for none serious or critical; a moderate one, landmark-unique on the Location region, was found and fixed). One page load per theme:
 * the three desktop views, then the window is narrowed to a phone (which also proves the drawer and the sheet appear when the band is entered by RESIZING, with the nodes moved
 * and nothing duplicated), then the drawer is opened, as a modal dialog, and read.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { stubAir } from './aqi-cpcb-stub.ts';
import { duplicateIds, openV2 } from './obos-v2-helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const go = (page: Page, section: string) => page.locator(`.nav-item[data-section="${section}"]`).click({ position: { x: 30, y: 22 } });
const axe = async (page: Page, what: string): Promise<string[]> => {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations.map((v) => `${what}: ${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
};

for (const theme of ['dark', 'light'] as const) {
  test(`@v2 a11y: axe finds nothing on Overview, Air, the building card, and the phone's sheet and drawer · ${theme}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubAir(page, { nowcast: true });
    await page.addInitScript((t) => { try { localStorage.setItem('obos:v2:theme', t); sessionStorage.setItem('obos:entry-note-seen', '1'); sessionStorage.setItem('obos:rotate-nudge-dismissed', '1'); } catch { /* none */ } }, theme);
    await openV2(page);
    await page.waitForTimeout(1500);
    const found: string[] = [];
    found.push(...(await axe(page, `${theme} overview`)));
    await go(page, 'air'); await expect(page.locator('#aqiBlock')).toBeVisible({ timeout: 30_000 }); await page.waitForTimeout(800);
    found.push(...(await axe(page, `${theme} air`)));
    await go(page, 'solar');
    await expect(page.locator('#solList tr[data-idx]').first()).toBeAttached({ timeout: 60_000 });
    await page.locator('#solList tr[data-idx]').first().dispatchEvent('click');
    await expect(page.locator('#bcard')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    found.push(...(await axe(page, `${theme} building card`)));
    /* narrow the window: the phone band is entered by resizing, and the same page becomes the drawer + sheet */
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-phone', '1');
    expect(await duplicateIds(page), 'moving the nodes into the drawer and the sheet duplicates nothing').toEqual([]);
    await page.waitForTimeout(800);
    found.push(...(await axe(page, `${theme} phone sheet`)));
    await page.locator('[data-v2-menu]').click();
    await expect(page.locator('#v2Drawer')).toBeVisible();
    await page.waitForTimeout(500);
    found.push(...(await axe(page, `${theme} phone drawer (modal)`)));
    await page.keyboard.press('Escape');
    /* and back: leaving the band puts every node exactly where it was */
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('main.obos-v2')).not.toHaveAttribute('data-phone', '1');
    expect(await page.evaluate(() => [...document.querySelector('main.obos-v2')!.children].map((c) => c.id || c.className.split(' ')[0]).filter((x) => /^(v2Rail|v2Side|legend|v2MapStack|v2Dock|st-attrib)$/.test(x))), 'the rail, side panel, column, map stack, dock and credits chip are root children again')
      .toEqual(['v2Rail', 'v2Side', 'v2MapStack', 'v2Dock', 'legend', 'st-attrib']);
    expect(found, found.join('\n')).toEqual([]);
  });
}
