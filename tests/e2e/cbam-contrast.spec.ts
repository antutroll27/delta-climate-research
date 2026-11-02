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

    test(`every view meets AA colour contrast, populated (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL);
      // Tile states on the List: 2026 (attested → below threshold, the cb-tag ok tone) and 2027
      // (no published rule; a line with certificates and no published price).
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
