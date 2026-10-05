import { expect, test, type Page } from '@playwright/test';
import { stubAirIndiranagar, stubAirWhitefieldFallback } from './aqi-cpcb-stub.ts';

/**
 * BENGALURU'S AIR CARD renders as Kolkata's does (founder, 2026-10-05), on the built page
 * with a stubbed answer: the ward figure from its nearest monitor, labelled as that with
 * its distance, the Bengaluru city line under it, and the Air pane open for the city.
 *
 * BLR_AIR_SHOTS=<dir> also saves the card in Dark and Clay.
 */
const INDIRANAGAR = '/heat-map/in/bengaluru/indiranagar/';
const SHOTS = process.env['BLR_AIR_SHOTS'];

async function toClay(page: Page): Promise<void> {
  await page.evaluate(() => (document.querySelector('#envchip button[data-e="studio"]') as HTMLButtonElement | null)?.click());
  await page.waitForTimeout(2_500);
}

test.use({ deviceScaleFactor: 2 });

test('desktop: Indiranagar shows the Air card with its nearest monitor, distance and the Bengaluru city line', async ({ page }, info) => {
  test.setTimeout(120_000);
  test.skip(info.project.name !== 'chromium-tier0', 'a DOM check: one tier is enough');
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubAirIndiranagar(page);
  const asked: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/air-quality')) asked.push(new URL(r.url()).searchParams.get('area') ?? ''); });
  await page.goto(INDIRANAGAR);
  const card = page.locator('#aqiBlock');
  await expect(card).toBeVisible({ timeout: 60_000 });
  expect(asked).toContain('in/bengaluru/indiranagar');
  await expect(card.locator('.num')).toHaveText('68');
  await expect(card).toContainText('Satisfactory');
  await expect(card).toContainText('nearest official KSPCB monitor · 3.8 km from the Indiranagar centre, in Kasturi Nagar, north-east of Indiranagar');
  await expect(card.locator('.aq-city summary')).toContainText('Bengaluru (entire city) · 87 Satisfactory · 7 stations', { ignoreCase: true });
  await expect(page.locator('#airPane')).not.toContainText('not yet covered');
  await expect(page.locator('#airPane')).toContainText('No 30-day history for this station');
  for (const env of ['dark', 'clay'] as const) {
    if (env === 'clay') await toClay(page);
    if (!SHOTS) continue;
    await page.mouse.move(5, 5);
    await card.screenshot({ path: `${SHOTS}/indiranagar-card-${env}.png` });
  }
});

/* THE FALLBACK LADDER (stations.ts FALLBACKS): when the nearest monitor is not in the feed, the
   card names the station actually served, says it is the nearest REPORTING one, and prints ITS
   distance from the payload (15.0 km for Silk Board), never the absent nearest monitor's 10.0 km. */
test('desktop: Whitefield on a fallback shows the served station, "nearest reporting", and its own distance', async ({ page }, info) => {
  test.setTimeout(120_000);
  test.skip(info.project.name !== 'chromium-tier0', 'a DOM check: one tier is enough');
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubAirWhitefieldFallback(page);
  await page.goto('/heat-map/in/bengaluru/whitefield/');
  const card = page.locator('#aqiBlock');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('.num')).toHaveText('119');
  await expect(card).toContainText('Silk Board, Bengaluru · nearest reporting KSPCB monitor · 15.0 km from the Whitefield centre, at Silk Board, west-south-west of Whitefield');
  await expect(card).not.toContainText('nearest official');
  await expect(card).not.toContainText('10.0 km');
});
