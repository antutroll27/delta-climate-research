import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

/* THE SOLAR SCREEN ON THE REAL PAGE. The panel and the pane render from the ward
   file, so they are asserted directly; the card is reached through a ranked row,
   because no test can reliably click a building on the software renderer. The
   floor is asserted wherever the headline is: that is the one claim the design
   makes about itself. Under SwiftShader the 3D layer is skipped at boot and a
   selected building never projects, so the tests that need the card force the
   layer first, as a reader on a weak GPU can by pressing "3D Relief". */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';
const HEADER = 'idx,lat,lon,footprint_m2,kwp,kwh_yr,loss,loss_buildings,loss_trees,loss_strict,loss_raised,worth_per_yr,tariff_per_kwh,currency,basis';

async function boot(page: Page) {
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 30_000 });
}
async function withRelief(page: Page) {
  await page.locator('#modechip button[data-m="relief"]').click();
  await page.waitForTimeout(4_000);
}
async function openSolar(page: Page) {
  await page.locator('[data-rail="solar"]').click();
  await expect(page.locator('.pane[data-pane="solar"]')).toHaveClass(/is-on/);
  await expect(page.locator('#solList tr')).toHaveCount(10, { timeout: 15_000 });
}
const canvasBox = async (page: Page) => (await page.locator('#mlmap canvas').first().boundingBox())!;

test.describe('the solar screen', () => {
  /* THE DEFAULT 30s IS A WALL, NOT A BUDGET. Booting a ward, forcing the 3D layer
     the software renderer skips, and easing the camera twice is 46s measured — the
     ranked-row test failed on the clock, not on an assertion. Raised so the test
     can finish saying what it came to say. */
  test.setTimeout(120_000);
  test.beforeEach(async ({ page }) => { await boot(page); });

  test('the ward block lives in the Solar pane and the legend can show it on request', async ({ page }) => {
    await openSolar(page);
    await expect(page.locator('#solPaneKwp')).toHaveText(/\d+\.\d\s*MWp/, { timeout: 15_000 });
    await expect(page.locator('#solPaneConf')).toContainText('Screening');
    await expect(page.locator('#solPaneFloor')).toContainText('strict roof mask');
    await expect(page.locator('#solPaneFloor')).toContainText('GWh');
    await expect(page.locator('#solPaneBigK')).toContainText('3 kWp');
    /* The legend keeps its place: its header is inside the right rail's visible box,
       and the solar numbers appear over it only when asked. */
    const rail = (await page.locator('.rail-r').boundingBox())!;
    const head = (await page.locator('.legend .legend-head').first().boundingBox())!;
    expect(head.y).toBeLessThan(rail.y + rail.height);
    await expect(page.locator('#solOverlay')).toBeHidden();
    await page.locator('#solToggle').click();
    await expect(page.locator('#solOverlay')).toBeVisible();
    await expect(page.locator('#solKwp')).toHaveText(/\d+\.\d\s*MWp/);
    await expect(page.locator('#solFloor')).toContainText('strict roof mask');
    await page.locator('#solCollapse').click();
    await expect(page.locator('#solOverlay')).toBeHidden();
  });

  test('the Solar pane ranks ten roofs, remembers the tariff, and hands over every roof', async ({ page }) => {
    await openSolar(page);
    await expect(page.locator('#solPaneSum')).toContainText('MWp');
    await expect(page.locator('#solPaneSum')).toContainText('strict roof mask');
    await expect(page.locator('#solPaneSum')).toContainText('average roof');
    await expect(page.locator('#solCur')).not.toBeEmpty();
    await expect(page.locator('#solTariff')).toHaveValue('8.00');

    const before = await page.locator('#solPaneRs').innerText();
    await page.locator('#solTariff').fill('10');
    await expect(page.locator('#solPaneRs')).not.toHaveText(before);
    await expect(page.locator('#solPaneRs')).toContainText('10.00');
    await page.reload();
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 30_000 });
    await expect(page.locator('#solTariff')).toHaveValue('10.00');

    await openSolar(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#solCsv').click()]);
    expect(download.suggestedFilename()).toBe('solar-ballygunge.csv');
    const text = await readFile((await download.path()) as string, 'utf8');
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines.length).toBe(1 + 3527);           // one row per Ballygunge building
    const row = lines[1].split(',');
    expect(row[12]).toBe('10.00');                 // the tariff the reader set
    expect(row[13]).toBe('INR');                   // the scope's currency, never typed
    // the basis rides EVERY row, not just row 0 -- the join reassembles the one
    // quoted field, which carries commas of its own.
    expect(lines[2].split(',').slice(14).join(',')).toContain('screening');
  });

  test('a ranked row selects its building, brings the camera to it, and the card prints the floor inside the canvas', async ({ page }) => {
    await withRelief(page);
    await openSolar(page);
    const row = page.locator('#solList tr').first();
    const idx = await row.getAttribute('data-idx');
    await row.click();
    await page.waitForTimeout(1_500);
    await expect(page.locator('#bcId')).toHaveText(`#${idx}`);
    await expect(page.locator('#bcSol')).toBeVisible();
    await expect(page.locator('#bcSolFloor')).toContainText('strict roof mask');
    await expect(page.locator('#bcSolRs')).toContainText('assumed');
    await expect(page.locator('#bcard')).toHaveCSS('opacity', '1');
    const card = (await page.locator('#bcard').boundingBox())!;
    const canvas = await canvasBox(page);
    expect(card.y).toBeGreaterThanOrEqual(canvas.y + 11);
    expect(card.y + card.height).toBeLessThanOrEqual(canvas.y + canvas.height - 11);

    /* ZOOM AWAY, then click another row: the camera must come to the building, or
       the card is projected off the canvas and nobody sees it (nine of ten rows,
       measured, before the camera move existed). */
    await page.mouse.move(canvas.x + 40, canvas.y + 40);
    for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, -400); await page.waitForTimeout(150); }
    await page.waitForTimeout(800);
    await page.locator('#solList tr').nth(2).click();
    await page.waitForTimeout(1_800);
    await expect(page.locator('#bcard')).toHaveCSS('opacity', '1');
    const after = (await page.locator('#bcard').boundingBox())!;
    expect(after.x).toBeGreaterThanOrEqual(canvas.x);
    expect(after.x + after.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(after.y).toBeGreaterThanOrEqual(canvas.y + 11);
    expect(after.y + after.height).toBeLessThanOrEqual(canvas.y + canvas.height - 11);
  });
});
