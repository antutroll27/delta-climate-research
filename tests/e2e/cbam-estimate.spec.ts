// tests/e2e/cbam-estimate.spec.ts
// Phase 2 of the rail redesign (spec §5.1, §6.5, §9): the Estimate view's inputs and tiles. The
// hidden #cbRoute / #cbTier stay the source of truth; this spec proves the visible radio groups
// mirror them in both directions, which cbam-lines.spec.ts (driving the selects) cannot see.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const URL = '/cbam/cbam-calculator/';
const IDLE = 'Choose a good, origin, route, mass and import date to see the provisional exposure.';

async function pick(page: Page, cn: string, country: string, date = '2026-03-15'): Promise<void> {
  await page.fill('#cbCn', cn);
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', date);
  await page.dispatchEvent('#cbDate', 'change');
  await expect(page.locator(`#cbCountry option[value="${country}"]`)).toBeAttached();
  await page.selectOption('#cbCountry', country);
}

const inert = (page: Page) => page.locator('.cbx-main').evaluate((el) => el.hasAttribute('inert'));

test.describe('CBAM Estimate view', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('idle: the hero carries the prompt and no tile claims a figure', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('#cbOut .b-hero .cb-idle')).toHaveText(IDLE);
    await expect(page.locator('#cbOut .cb-fig')).toHaveCount(0);
    await expect(page.locator('#cbOut')).not.toContainText('tCO');
    await expect(page.locator('#cbRouteSeg')).toContainText('Choose a good and origin first');
  });

  test('route segments mirror #cbRoute both ways, and mark verified-only routes', async ({ page }) => {
    await page.goto(URL);
    await pick(page, '73063077', 'IN');
    const seg = page.locator('#cbRouteSeg [role="radio"]');
    await expect(seg).toHaveText(['(C)', '(D)', '(E)']);
    await expect(page.locator('#cbRouteSeg .b-vo')).toHaveText(['(D)', '(E)']);
    await expect(page.locator('#cbRouteVo')).toHaveText(
      '(D) and (E) price from verified figures only: no Commission default from India.');
    await expect(page.locator('#cbRoute')).toHaveValue('');
    await expect(page.locator('#cbRouteSeg [aria-checked="true"]')).toHaveCount(0);

    await seg.nth(0).click();
    await expect(page.locator('#cbRoute')).toHaveValue('(C)');
    await expect(seg.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#cbOut .cb-n')).toHaveText('329.828');
    await expect(page.locator('#cbOut .cb-cost')).toHaveText('€24,855.80');

    // WAI-ARIA radio group: the arrow moves focus AND selects.
    await seg.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(seg.nth(1)).toBeFocused();
    await expect(page.locator('#cbRoute')).toHaveValue('(D)');
    await expect(page.locator('#cbOut .cb-reason')).toContainText('The Commission publishes no applicable direct default value');
    await expect(page.locator('#cbOut .cb-fig')).toHaveCount(0);
    await expect(page.locator('#cbOut .cb-cost')).toHaveCount(0);
    await expect(page.locator('#cbOut .b-prov')).toContainText('Origin basis');

    // …and the select still drives the radios: the lines spec sets routes this way.
    await page.selectOption('#cbRoute', '(E)');
    await expect(seg.nth(2)).toHaveAttribute('aria-checked', 'true');
    await expect(seg.nth(1)).toHaveAttribute('aria-checked', 'false');
  });

  test('the emissions-data cards mirror #cbTier and open the verified panel', async ({ page }) => {
    await page.goto(URL);
    const cards = page.locator('#cbTierCards [role="radio"]');
    await expect(cards.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#cbVerifiedRow')).toBeHidden();
    await cards.nth(1).click();
    await expect(page.locator('#cbTier')).toHaveValue('actual-verified');
    await expect(page.locator('#cbVerifiedRow')).toBeVisible();
    await cards.nth(1).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#cbTier')).toHaveValue('default+markup');
    await expect(page.locator('#cbVerifiedRow')).toBeHidden();
    await page.selectOption('#cbTier', 'actual-verified');
    await expect(cards.nth(1)).toHaveAttribute('aria-checked', 'true');
  });

  test('a priced line fills Chargeable, the deck and Provenance; ↗ opens Three years', async ({ page }) => {
    await page.goto(URL);
    await pick(page, '73063077', 'IN');
    await page.locator('#cbRouteSeg [data-value="(C)"]').click();
    await expect(page.locator('#cbOut .b-fill')).toContainText('69.4');
    await expect(page.locator('#cbOut .b-fill')).toContainText('30.6');
    const deck = page.locator('#cbOut .b-yrs');
    await expect(deck.locator('.b-st b')).toHaveText(['329.8', '376.8', '427.4']);
    await expect(deck).toContainText('+29.6% by 2028');
    await expect(deck).not.toContainText('€');
    await expect(page.locator('#cbOut .b-prov .b-fp i')).toHaveCount(64);
    await deck.locator('[data-goto="three-years"]').click();
    await expect(page.locator('[data-view="three-years"]')).toBeVisible();
  });

  test('the good sheet: keyboard in, search, sector, pick, focus back', async ({ page }) => {
    await page.goto(URL);
    const open = page.locator('[data-good-open]');
    const sheet = page.locator('#cbGoodSheet');
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-good-search]')).toBeFocused();
    expect(await inert(page)).toBe(true);
    await expect(sheet.locator('.b-res').first()).toBeVisible();
    await page.keyboard.type('welded tube');
    await sheet.locator('[data-sector="iron_and_steel"]').click();
    await expect(sheet.locator('[data-sector="iron_and_steel"]')).toHaveAttribute('aria-pressed', 'true');
    const hit = sheet.locator('.b-res[data-code="73063077"]');
    await hit.focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeHidden();
    await expect(page.locator('#cbCn')).toHaveValue('73063077');
    await expect(open).toBeFocused();
    expect(await inert(page)).toBe(false);
    await expect(page.locator('#cbCnName')).toContainText('welded');
    // The pick reached cbam-app.ts: the routes follow the good once an origin is chosen.
    await page.selectOption('#cbCountry', 'IN');
    await expect(page.locator('#cbRouteSeg [role="radio"]')).toHaveCount(3);
  });

  test('the good sheet closes on Escape and on the scrim', async ({ page }) => {
    await page.goto(URL);
    const open = page.locator('[data-good-open]');
    await open.click();
    await expect(page.locator('#cbGoodSheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#cbGoodSheet')).toBeHidden();
    await expect(open).toBeFocused();
    await open.click();
    await page.locator('#cbGoodScrim').click({ position: { x: 1300, y: 400 } });
    await expect(page.locator('#cbGoodSheet')).toBeHidden();
  });

  test('the mass ruler and the date caption read the pack', async ({ page }) => {
    await page.goto(URL);
    await pick(page, '2523100090', 'DZ');
    await page.selectOption('#cbRoute', '(A)');
    await page.fill('#cbMass', '100');
    await expect(page.locator('#cbMassRuler')).toContainText('50 t de minimis · 2026');
    await expect(page.locator('#cbDatePeriod')).toContainText('Certificate price · imports in 2026-Q1: €75.36');
    await page.fill('#cbDate', '2027-03-15');
    await page.dispatchEvent('#cbDate', 'change');
    await expect(page.locator('#cbDatePeriod')).toContainText('Certificate price · imports in 2027-Q1: none published');
    await expect(page.locator('#cbDateNote')).toHaveText('');
    await expect(page.locator('#cbMassRuler')).toBeEmpty();
    await pick(page, '28041000', 'DZ');
    await expect(page.locator('#cbMassRuler')).toBeEmpty();
  });

  test('phone: the inputs stack above the tiles, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    await pick(page, '73063077', 'IN');
    await page.locator('#cbRouteSeg [data-value="(C)"]').click();
    await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
    const inputs = await page.locator('.b-inputs').boundingBox();
    const hero = await page.locator('#cbOut .b-hero').boundingBox();
    expect(hero!.y).toBeGreaterThan(inputs!.y + inputs!.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    expect(await page.locator('.cbx-main').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`axe: Estimate with a priced verified line passes in the ${theme} theme`, async ({ page }) => {
      await page.goto(`${URL}?theme=${theme}`);
      await pick(page, '73063077', 'IN');
      await page.locator('#cbRouteSeg [data-value="(C)"]').click();
      await page.locator('#cbTierCards [data-value="actual-verified"]').click();
      await page.fill('#cbSeeDirect', '1.2');
      await page.check('#cbAttest');
      await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
      const r = await new AxeBuilder({ page }).include('[data-view="estimate"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(r.violations).toEqual([]);
    });
  }
});
