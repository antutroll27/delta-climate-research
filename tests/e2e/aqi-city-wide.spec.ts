import { expect, test, type Page } from '@playwright/test';
import { stubAir } from './aqi-cpcb-stub.ts';

/**
 * THE CITY-WIDE AQI under the ward's CPCB number (air-panel.ts cityLine), on the built
 * page with a stubbed answer: the ward's 107 stays the headline; under the US line a
 * smaller line reads Kolkata (entire city) · 108 Moderate · 7 stations, and its note
 * lists the seven stations averaged.
 *
 * CITY_AQI_SHOTS=<dir> also saves the card in Dark and Clay with the note open.
 */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';
const SHOTS = process.env['CITY_AQI_SHOTS'];

async function toClay(page: Page): Promise<void> {
  await page.evaluate(() => (document.querySelector('#envchip button[data-e="studio"]') as HTMLButtonElement | null)?.click());
  await page.waitForTimeout(2_500);
}

test.use({ deviceScaleFactor: 2 });

test('desktop: the city line sits under the US line, smaller than the ward figure, note lists the stations', async ({ page }, info) => {
  test.setTimeout(120_000);
  test.skip(info.project.name !== 'chromium-tier0', 'a DOM check: one tier is enough');
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubAir(page);
  await page.goto(BALLYGUNGE);
  const card = page.locator('#aqiBlock');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('.num')).toHaveText('107');
  const city = card.locator('.aq-city summary');
  await expect(city).toContainText('Kolkata (entire city) · 108 Moderate · 7 stations', { ignoreCase: true });
  const [us, c] = await Promise.all([card.locator('.aq-us summary').boundingBox(), city.boundingBox()]);
  expect(c!.y).toBeGreaterThan(us!.y + us!.height - 1);
  const size = (sel: string): Promise<number> => card.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const [numPx, usPx, cityPx] = await Promise.all([size('.num'), size('.aq-us summary'), size('.aq-city summary')]);
  expect(cityPx).toBeLessThanOrEqual(usPx);
  expect(cityPx * 3).toBeLessThan(numPx);
  await expect(card.locator('.aq-city p')).toBeHidden();
  await city.click();
  await expect(card.locator('.aq-city p')).toContainText('Average of all 7 CPCB stations reporting in Kolkata right now');
  await expect(card.locator('.aq-city li')).toHaveCount(7);
  await expect(card.locator('.aq-city li').first()).toContainText('Rabindra Bharati University');
  await city.click();
  for (const env of ['dark', 'clay'] as const) {
    if (env === 'clay') await toClay(page);
    if (!SHOTS) continue;
    await page.mouse.move(5, 5);
    await card.screenshot({ path: `${SHOTS}/card-${env}-closed.png` });
    await city.click();
    await page.mouse.move(5, 5);
    await card.screenshot({ path: `${SHOTS}/card-${env}-note-open.png` });
    await city.click();
  }
});
