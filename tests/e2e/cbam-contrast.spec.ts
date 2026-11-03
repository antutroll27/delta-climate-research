// tests/e2e/cbam-contrast.spec.ts
// Spec §4.3 / §6.5: the theme follows the OS, and every view meets WCAG AA contrast in both
// themes, populated (lines in the list, an attested year, a refused line) — headless.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const URL = '/cbam/cbam-calculator/';
const VIEWS = ['estimate', 'three-years', 'why', 'list', 'export', 'rules'] as const;

async function addLine(page: Page, cn: string, country: string, route: string, mass: string, date = '2026-03-15'): Promise<void> {
  await page.fill('#cbCn', cn);
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', date);
  await expect(page.locator(`#cbCountry option[value="${country}"]`)).toBeAttached();
  await page.selectOption('#cbCountry', country);
  await expect(page.locator(`#cbRoute option[value="${route}"]`)).toBeAttached();
  await page.selectOption('#cbRoute', route);
  await page.fill('#cbMass', mass);
  const before = await page.locator('#cbList .cb-line').count();
  await page.click('#cbAdd');
  await expect(page.locator('#cbList .cb-line')).toHaveCount(before + 1);
}

async function go(page: Page, view: string): Promise<void> {
  await page.locator(`.cbx-rail [data-goto="${view}"]`).click();
  await expect(page.locator(`[data-view="${view}"]`)).toBeVisible();
}

/** sRGB channels (0-255) of a computed colour: rgb()/rgba(), or the color(srgb r g b) form color-mix() resolves to. */
function channels(css: string): [number, number, number] {
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css);
  if (!m) throw new Error(`unreadable colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(channels(a)), luminance(channels(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test.describe('CBAM contrast', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const scheme of ['light', 'dark'] as const) {
    test(`with no ?theme, the page follows the OS (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL);
      await expect(page.locator('#cbx')).not.toHaveAttribute('data-theme', /.*/);
      const bg = await page.locator('#cbx').evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(scheme === 'light' ? 'rgb(239, 236, 230)' : 'rgb(3, 20, 22)');
    });

    // Estimate, verified tier, attested: the attestation sentence sits in the inverted hero. A generic
    // `.b-t .cb-attested{color:var(--ink)}` once painted it the hero's own background (1:1, invisible).
    test(`the attestation sentence on the verified Estimate hero is legible (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL);
      await page.fill('#cbCn', '72061000');
      await page.dispatchEvent('#cbCn', 'change');
      await page.fill('#cbDate', '2026-03-15');
      await expect(page.locator('#cbCountry option[value="IN"]')).toBeAttached();
      await page.selectOption('#cbCountry', 'IN');
      await expect(page.locator('#cbRoute option[value="(C)"]')).toBeAttached();
      await page.selectOption('#cbRoute', '(C)');
      await page.fill('#cbMass', '100');
      await page.selectOption('#cbTier', 'actual-verified');
      await page.fill('#cbSeeDirect', '2.31');
      await page.check('#cbAttest');
      const att = page.locator('[data-view="estimate"] #cbOut .cb-attested');
      await expect(att).toBeVisible();
      const [fg, bg] = await att.evaluate((el) => {
        const tile = el.closest('.b-t') as HTMLElement;
        return [getComputedStyle(el).color, getComputedStyle(tile).backgroundColor];
      });
      expect(fg).not.toBe(bg);
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      const r = await new AxeBuilder({ page }).include('[data-view="estimate"]').withRules(['color-contrast']).analyze();
      expect(r.violations.map((x) => x.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
    });

    // Nothing added: every view's idle tiles (the Export document placeholder was 1.25:1 in dark).
    test(`every view meets AA colour contrast, idle (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL);
      for (const v of VIEWS) {
        await go(page, v);
        const r = await new AxeBuilder({ page }).include(`[data-view="${v}"]`).include('.cbx-rail').withRules(['color-contrast']).analyze();
        expect(r.violations.map((x) => `${v}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      }
    });

    test(`every view meets AA colour contrast, populated (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL);
      // Tile states on the List: 2026 (attested → below threshold, the cb-tag ok tone) and 2027
      // (indeterminate, the cb-tag pending tone; a line with certificates and no published price).
      await addLine(page, '2523100090', 'DZ', '(A)', '30');
      await addLine(page, '2523100090', 'DZ', '(A)', '30', '2027-03-15');
      await go(page, 'list');
      await page.locator('#cbList [data-attest="2026"]').check();
      await expect(page.locator('#cbList .cb-thresh').first()).toContainText('Below threshold');
      await go(page, 'rules');
      // Adding the lines loaded the pack, which replaced the button; click it only if it is still there
      // (an un-timed click on a node that is gone would wait for the whole test timeout).
      if (await page.locator('#cbSources [data-load-pack]').count()) await page.locator('#cbSources [data-load-pack]').click();
      await expect(page.locator('#cbSources li').first()).toBeVisible();
      for (const v of VIEWS) {
        await go(page, v);
        const r = await new AxeBuilder({ page }).include(`[data-view="${v}"]`).include('.cbx-rail').withRules(['color-contrast']).analyze();
        expect(r.violations.map((x) => `${v}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      }
    });
  }
});
