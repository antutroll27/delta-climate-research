import { expect, test } from '@playwright/test';
import { stubAir } from './aqi-cpcb-stub.ts';

/**
 * THE PM2.5 LINE AND "WHY DO OTHER APPS SHOW A DIFFERENT NUMBER?" (air-panel.ts pmLine, why),
 * on the built page with the stubbed CPCB answer: PM2.5 hourly sub-index 90, which is
 * 30 + (90 - 50) × 30 / 50 = 54 µg/m³ on CPCB's own scale.
 *
 * Both are closed until asked, by click and by keyboard, and neither pushes the card sideways.
 * The answer names other apps and never says one is wrong; the unit tests pin its exact words.
 */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';

test.describe('Air card: PM2.5 and the other-apps question', () => {
  test.setTimeout(120_000);

  /* The widths aqi-us-equivalent.spec.ts uses: a desktop, and 1000 px, the narrowest that shows the card. */
  for (const width of [1440, 1000]) {
    test(`${width} px: the line sits between the headline and the US line; both notes open on demand`, async ({ page }, info) => {
      test.skip(info.project.name !== 'chromium-tier0', 'a DOM check: one tier is enough');
      await page.setViewportSize({ width, height: width === 1000 ? 800 : 900 });
      await stubAir(page);
      await page.goto(BALLYGUNGE);
      const card = page.locator('#aqiBlock');
      await expect(card).toBeVisible({ timeout: 60_000 });

      const pm = card.locator('.aq-pm summary');
      await expect(pm).toContainText('Fine particles (PM2.5) · about 54 µg/m³ in the latest hour');
      const [hero, line, us] = await Promise.all([card.locator('.hero').boundingBox(), pm.boundingBox(), card.locator('.aq-us summary').boundingBox()]);
      expect(line!.y).toBeGreaterThan(hero!.y + hero!.height - 1);
      expect(us!.y).toBeGreaterThan(line!.y + line!.height - 1);

      /* The derivation note: hidden, then opened by click. */
      await expect(card.locator('.aq-pm p')).toBeHidden();
      await pm.click();
      await expect(card.locator('.aq-pm p')).toContainText("Worked back from CPCB's latest hourly PM2.5 sub-index (90)");
      await pm.click();
      await expect(card.locator('.aq-pm p')).toBeHidden();

      /* The question: last in the block, hidden answer, opened from the keyboard. */
      const why = card.locator('.aq-why');
      const ask = why.locator('summary');
      await expect(ask).toHaveText('Why do other apps show a different number?');
      await expect(why.locator('p')).toBeHidden();
      await ask.focus();
      await page.keyboard.press('Enter');
      await expect(why.locator('p')).toContainText('Apps such as IQAir and aqi.in show the American scale');
      await expect(why.locator('p')).toContainText('The PM2.5 figure above is in µg/m³, a unit that means the same on every scale.');
      await expect(why.locator('p')).not.toContainText(/wrong|incorrect|inaccurate|higher|official monitor/i);
      const [c, w, last] = await Promise.all([card.boundingBox(), why.boundingBox(), card.locator('> :last-child').evaluate((el) => el.className)]);
      expect(last).toBe('aq-why');

      /* Open, it stays inside the card and the page does not scroll sideways. */
      expect(w!.x + w!.width).toBeLessThanOrEqual(c!.x + c!.width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
