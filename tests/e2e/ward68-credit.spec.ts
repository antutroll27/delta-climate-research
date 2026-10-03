import { devices, expect, test, type Page } from '@playwright/test';

/**
 * THE WARD 68 BOUNDARY'S CREDIT IS ON SCREEN WHEREVER THE BOUNDARY IS DRAWN.
 *
 * The polygon is DataMeet's, CC BY-SA 2.5 India, so attribution is a licence term,
 * not a courtesy. Until the pre-ship audit (2026-10-03) the only credit was a line
 * in the legend — below the fold on a desktop and `display:none` on a phone — so it
 * was present in the DOM and seen by nobody. Asserted here as a reader would meet
 * it: visible, inside the viewport, at desktop and phone sizes, and absent where no
 * boundary is drawn.
 */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';

async function settled(page: Page): Promise<void> {
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
}

/** The element's box lies inside the viewport (not merely in the DOM). */
async function onScreen(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector).first();
  await expect(el).toBeVisible();
  const box = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.width).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
}

test.describe('the DataMeet credit', () => {
  test.setTimeout(120_000);

  test('desktop: under the mean and in the map attribution, linked to the licence', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BALLYGUNGE);
    await settled(page);
    const credit = page.locator('#wardScope .ward-credit');
    await expect(credit).toContainText('DataMeet');
    await expect(credit.locator('a')).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/2.5/in/');
    await onScreen(page, '#wardScope .ward-credit');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('DataMeet');
    await onScreen(page, '.maplibregl-ctrl-attrib');
  });

  test('phone 390 × 844: the scope line carries it, on screen', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, baseURL });
    const page = await ctx.newPage();
    await page.goto(BALLYGUNGE);
    await page.getByRole('button', { name: /continue anyway/i }).click({ timeout: 10_000 }).catch(() => {});
    await settled(page);
    await expect(page.locator('#wardScope .ward-credit')).toContainText('DataMeet');
    await onScreen(page, '#wardScope .ward-credit');
    await ctx.close();
  });

  test('an area with no boundary credits none', async ({ page }) => {
    await page.goto('/heat-map/in/kolkata/baruipur/');
    await settled(page);
    await expect(page.locator('#wardScope')).toBeHidden();
    await expect(page.locator('.maplibregl-ctrl-attrib')).not.toContainText('DataMeet');
  });
});
