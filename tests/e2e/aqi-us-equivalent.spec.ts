import { devices, expect, test, type Page } from '@playwright/test';
import { stubAir } from './aqi-cpcb-stub.ts';

/**
 * THE US EPA EQUIVALENT under the official CPCB number (air-panel.ts usLine), on the
 * built page with a stubbed CPCB answer: CPCB 107 stays the headline, and the small
 * line beneath it reads ≈ US AQI 142, Unhealthy for Sensitive Groups (PM2.5 avg
 * sub-index 87 → 52.2 µg/m³ → 142 on the 2024 EPA scale).
 *
 * US_AQI_SHOTS=<dir> also saves the card and the pane in Dark and Clay.
 */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';
const SHOTS = process.env['US_AQI_SHOTS'];
const LINE = '≈ US AQI 142 · Unhealthy for Sensitive Groups';

async function toClay(page: Page): Promise<void> {
  /* On a phone the env chip can sit under the HUD; the click is the same control either way. */
  await page.evaluate(() => (document.querySelector('#envchip button[data-e="studio"]') as HTMLButtonElement | null)?.click());
  await page.waitForTimeout(2_500);
}

async function openAirPane(page: Page): Promise<void> {
  await page.locator('[data-rail="air"]').first().click();
  await expect(page.locator('#airPane .aq-us summary')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800);
}

test.describe('US AQI equivalent', () => {
  test.setTimeout(120_000);

  test('desktop: under the CPCB headline on the card and in the pane, note on click', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-tier0', 'a DOM check: one tier is enough');
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubAir(page);
    await page.goto(BALLYGUNGE);
    const card = page.locator('#aqiBlock');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('.num')).toHaveText('107');
    const us = card.locator('.aq-us summary');
    await expect(us).toContainText(LINE, { ignoreCase: true });
    /* Under the official number, never above it. */
    const [h, u] = await Promise.all([card.locator('.hero').boundingBox(), us.boundingBox()]);
    expect(u!.y).toBeGreaterThan(h!.y + h!.height - 1);
    await expect(us).toHaveAttribute('title', /legal standard/);
    await expect(card.locator('.aq-us p')).toBeHidden();
    await us.click();
    await expect(card.locator('.aq-us p')).toContainText("converted from CPCB's 24-hour PM2.5/PM10");
    await us.click();
    for (const env of ['dark', 'clay'] as const) {
      if (env === 'clay') await toClay(page);
      if (SHOTS) await card.screenshot({ path: `${SHOTS}/card-${env}-desktop.png` });
      await openAirPane(page);
      await expect(page.locator('#airPane .aq-us summary')).toContainText(LINE, { ignoreCase: true });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/pane-${env}-desktop.png` });
      await page.locator('[data-rail="air"]').first().click();
    }
  });

  test('narrow window (1000 px, the narrowest that shows the card): the line still fits the card, Dark and Clay', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-tier0', 'a DOM check: one tier is enough');
    await page.setViewportSize({ width: 1000, height: 800 });
    await stubAir(page);
    await page.goto(BALLYGUNGE);
    const card = page.locator('#aqiBlock');
    const us = card.locator('.aq-us summary');
    await expect(us).toBeVisible({ timeout: 60_000 });
    await expect(us).toContainText(LINE, { ignoreCase: true });
    for (const env of ['dark', 'clay'] as const) {
      if (env === 'clay') await toClay(page);
      /* Inside the card, never clipped by it. */
      const [c, u] = await Promise.all([card.boundingBox(), us.boundingBox()]);
      expect(u!.x + u!.width).toBeLessThanOrEqual(c!.x + c!.width + 1);
      await us.click();
      await expect(card.locator('.aq-us p')).toBeVisible();
      if (SHOTS) await card.screenshot({ path: `${SHOTS}/card-${env}-narrow.png` });
      await us.click();
    }
  });

  /* PHONES DO NOT SHOW THE AIR CARD TODAY, and this change does not alter that: below
     the coarse-pointer breakpoints the legend that holds the card is display:none (it goes below 981 px), and
     the landscape sheet's pane area collapses to 0 px. The line is still painted into
     the card, so it is there the moment the phone layout shows the card. */
  test.describe('phone', () => {
    const { defaultBrowserType: _b, ...pixel } = devices['Pixel 7'];
    test.use(pixel);
    test('phone: the card carries the line (the phone layout hides the card itself)', async ({ page }, info) => {
      test.skip(info.project.name !== 'chromium-tier0', 'a DOM check: one tier is enough');
      await stubAir(page);
      await page.goto(BALLYGUNGE);
      await expect(page.locator('#aqiBlock .aq-us summary')).toContainText(LINE, { ignoreCase: true, timeout: 60_000 });
      await expect(page.locator('#airPane .aq-us summary')).toContainText(LINE, { ignoreCase: true });
    });
  });
});
