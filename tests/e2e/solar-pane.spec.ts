import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

/* THE SOLAR SCREEN ON THE REAL PAGE. The panel and the pane render from the ward
   file, so they are asserted directly; the card is reached through a ranked row,
   because no test can reliably click a building on the software renderer. The
   floor is asserted wherever the headline is: that is the one claim the design
   makes about itself. Under SwiftShader the 3D layer is skipped at boot and a
   selected building never projects, so the tests that need the card force the
   layer first, as a reader on a weak GPU can by pressing "3D Relief". */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';
const HEADER = 'idx,lat,lon,footprint_m2,kwp,kwh_yr,kwh_low,kwh_high,kwp_high,loss,loss_buildings,loss_trees,loss_strict,loss_raised,worth_per_yr,tariff_per_kwh,currency,tier,basis';

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
  /* A test that must intercept a file BEFORE the page loads boots itself and is
     tagged @own-boot. Booting it here first cost a whole extra ward load, about
     15-20 s on a 2-CPU CI runner (measured 2026-09-14). */
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.tags.includes('@own-boot')) return;
    await boot(page);
  });

  test('the legend folds the ward block under the colour key, and lifts it above on the Solar screen', async ({ page }) => {
    /* Entering the console: the colour key first, the solar block folded under it. */
    await expect(page.locator('#solBlock')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#solBody')).toBeHidden();
    expect(await page.locator('#solBlock').evaluate((b) => b.nextElementSibling?.className)).toBe('attr');
    const rail = (await page.locator('.rail-r').boundingBox())!;
    const head = (await page.locator('.legend .legend-head').first().boundingBox())!;
    expect(head.y).toBeLessThan(rail.y + rail.height);
    await page.locator('#solToggle').click();
    await expect(page.locator('#solBody')).toBeVisible();
    await expect(page.locator('#solKwp')).toHaveText(/\d+\.\d\s*MWp/);
    await expect(page.locator('#solFloor')).toContainText('strict roof mask');
    await page.locator('#solToggle').click();
    await expect(page.locator('#solBody')).toBeHidden();
    /* On the Solar screen the block moves above the key and unfolds. */
    await openSolar(page);
    await expect(page.locator('#solPaneKwp')).toHaveText(/\d+\.\d\s*MWp/, { timeout: 15_000 });
    await expect(page.locator('#solPaneConf')).toContainText('Screening');
    await expect(page.locator('#solPaneFloor')).toContainText('strict roof mask');
    await expect(page.locator('#solPaneFloor')).toContainText('GWh');
    await expect(page.locator('#solPaneBigK')).toContainText('3 kWp');
    expect(await page.locator('#legend > :first-child').getAttribute('id')).toBe('solBlock');
    await expect(page.locator('#solBody')).toBeVisible();
  });

  test('the Solar pane ranks ten roofs, remembers the tariff, and hands over every roof', async ({ page }) => {
    await openSolar(page);
    await expect(page.locator('#solPaneSum')).toContainText('MWp');
    await expect(page.locator('#solPaneSum')).toContainText('strict roof mask');
    await expect(page.locator('#solPaneSum')).toContainText('average roof');
    await expect(page.locator('#solCur')).not.toBeEmpty();
    await expect(page.locator('#solTariff')).toHaveValue('8.00');

    /* THE RANGE COLUMN (spec 2026-09-07-solar-guide §5). Header and rows both --
       a table that names the column but never fills it is worse than no column. */
    await expect(page.locator('table.roofs thead th').nth(3)).toHaveText('range');
    const rangeCells = page.locator('#solList tr td.range');
    await expect(rangeCells).toHaveCount(10);
    for (const cell of await rangeCells.all()) {
      await expect(cell).toHaveText(/^\d[\d,]*–\d[\d,]*$/);
    }

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
    /* FIELD COUNT, WITHOUT A CSV PARSER. `basis` is the one quoted field and the
       only one that can carry a comma of its own, and it is always LAST -- so
       every field before it is comma-safe, and slicing there instead of counting
       delimiters over the whole line is what keeps this from breaking on a basis
       string that quotes a number. */
    const columns = HEADER.split(',');
    const headerFieldCount = columns.length;
    const row = lines[1].split(',');
    const fixed = row.slice(0, headerFieldCount - 1);
    const basisField = row.slice(headerFieldCount - 1).join(',');
    expect(basisField.startsWith('"')).toBe(true);
    expect(basisField.endsWith('"')).toBe(true);
    // BY NAME, not position -- a column inserted ahead of these three must not
    // silently start reading the wrong cell.
    expect(fixed[columns.indexOf('tariff_per_kwh')]).toBe('10.00');   // the tariff the reader set
    expect(fixed[columns.indexOf('currency')]).toBe('INR');           // the scope's currency, never typed
    expect(fixed[columns.indexOf('tier')]).toBe('screened');          // Ballygunge ships tiers.validated: null
    // the basis rides EVERY row, not just row 0 -- the join reassembles the one
    // quoted field, which carries commas of its own.
    expect(lines[2].split(',').slice(headerFieldCount - 1).join(',')).toContain('screening');
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
    /* THE INTERVAL LEADS. The headline is a range before it is a point, the chip
       says which rung of the ladder it stands on, and every rung offers its fix. */
    await expect(page.locator('#bcSolKwp')).toHaveText(/^\d+\.\d–\d+\.\d kWp/);
    await expect(page.locator('#bcSolTier')).toHaveText('screened');
    await expect(page.locator('#bcSure li')).toHaveCount(5);
    /* The mailto is asserted through `data-href` and never clicked: a mailto
       navigation leaves the browser, so there is nothing left to observe. */
    const ask = await page.locator('.bc-ask[data-limit="roof"]').getAttribute('data-href');
    expect(ask).toMatch(/^mailto:ant@deltaclimate\.earth\?subject=/);
    expect(ask).toContain(`%23${idx}`);
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

  /* THE RUNG THAT HAS NEVER FIRED. All three artefacts ship `tiers.validated: null`,
     so the validated half of the card is unreachable on real data and would have gone
     to production unexecuted. The ward's solar file is intercepted and given a
     result; then the ward is switched WITHOUT a reload, which is the only way to
     prove the swap reverses — the <li> and the note are innerHTML writes over the
     markup's own default, and a one-way swap would look identical until the second
     ward. */
  test('a validated ward wears the measured rung, and switching wards puts the screened one back', { tag: '@own-boot' }, async ({ page }) => {
    /* SLOW BY MEASUREMENT, NOT BY GUESS (2026-09-14). In a 2-CPU Linux container
       running Playwright's CI image, main and feat/bangalore-wards both ran past
       120 s: each eased click needs fresh frames, and a frame costs seconds on two
       software-rendering cores. test.slow() triples the describe's 120 s. */
    test.slow();
    const real = JSON.parse(await readFile(
      fileURLToPath(new URL('../../public/heat-map/data/pv-ballygunge.json', import.meta.url)), 'utf8',
    ));
    real.tiers.validated = { n: 31, months: 9, median_ratio: 0.97, within_15pct_share: 0.84, date: '2026-10-01' };
    await page.route('**/heat-map/data/pv-ballygunge.json', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify(real),
    }));
    /* The first navigation, made only after the route is in place, so the page never
       loads the real file (beforeEach skips @own-boot tests). */
    await page.addInitScript(() => { window.print = () => { (window as unknown as { __printed?: boolean }).__printed = true; }; });
    await boot(page);
    await withRelief(page);
    await openSolar(page);
    await page.locator('#solList tr').first().click();
    await page.waitForTimeout(1_500);
    await expect(page.locator('#bcSol')).toBeVisible();
    await expect(page.locator('#bcSolTier')).toHaveText('checked');
    /* The WARD BLOCK's own chip and summary (spec §5) -- painted independently of
       the card's, and open before any building is selected. */
    await expect(page.locator('#solPaneTier')).toHaveText('checked');
    await expect(page.locator('#solPaneSure')).toContainText('31 real rooftops');
    await expect(page.locator('#bcSureValid')).toContainText('31 real rooftops');
    await expect(page.locator('#bcSureValid')).toContainText('84% within 15%');
    await expect(page.locator('#bcSureValid .bc-ask')).toHaveCount(0);
    /* The prose note carries the tier too: a chip saying "validated" over a line
       that still opened "Screening estimate" is the card contradicting itself. */
    await expect(page.locator('#bcSolNote')).toContainText('Checked against 31 real rooftops');
    await expect(page.locator('#bcSolNote')).toContainText('still a screening estimate');
    /* A reworded default note could not silently double up "Screening estimate" --
       the validated line already says the checked-against sentence, and the
       original phrase must not survive alongside it. */
    await expect(page.locator('#bcSolNote')).not.toContainText('Screening estimate');
    /* The pane's headline under the chip, and the BRIEF's footer: a chip reading
       "checked" over a line that still opens "Screening", or over a footer that
       drops "not bankable", is the page contradicting itself (audit 2026-09-07). */
    await expect(page.locator('#solPaneConf')).toContainText('Checked');
    await page.locator('#bcBrief').click();
    await expect(page.locator('#brTier')).toHaveText('checked');
    await expect(page.locator('#brFoot')).toContainText('still a screening estimate');
    await expect(page.locator('#brFoot')).toContainText('not bankable');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#solBrief')).toBeHidden();

    /* Baruipur's file is NOT intercepted, so it arrives with `validated: null`.
       The strip switches the ward IN PLACE — no navigation — so the Solar pane is
       still open and `openSolar` would toggle it shut (console-shell.ts: a rail
       click on the showing pane closes the panel). The pane's own ward heading is
       the anchor instead; waiting on the row count alone would pass instantly
       against Ballygunge's ten rows. */
    await page.locator('#strip .ward[data-w="baruipur"]').click();
    await expect(page.locator('#solPaneArea')).toHaveText(/Baruipur/i, { timeout: 30_000 });
    await expect(page.locator('#solList tr')).toHaveCount(10, { timeout: 15_000 });
    await expect(page.locator('#solPaneTier')).toHaveText('screened');
    await expect(page.locator('#solPaneSure')).toContainText('Screened from satellites');
    await page.locator('#solList tr').first().click();
    await page.waitForTimeout(1_500);
    await expect(page.locator('#bcSolTier')).toHaveText('screened');
    await expect(page.locator('#bcSureValid .bc-ask')).toHaveCount(1);
    await expect(page.locator('#bcSolNote')).toContainText('Screening estimate');
    await expect(page.locator('#bcSolNote')).not.toContainText('Checked against');
  });

  /* THE SHEET THAT LEAVES THE SCREEN (spec 2026-09-07-solar-guide §6). Everything
     about the brief happens AROUND a native modal: window.print() blocks in a real
     browser and does nothing at all in headless Chromium, so it is replaced before
     the page loads with a stub that records the call and fires the `afterprint` the
     browser would have fired. What is then asserted is the contract either side of
     it -- the sheet was rendered for THIS roof, it carries the ladder and the six
     questions, and under print media it is the only thing on the paper and fits on
     one page of it. */
  test('the card prints a one-page installer brief, and nothing else goes on the paper', async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => { (window as unknown as { __printed?: boolean }).__printed = true; };
    });
    /* Re-navigated: beforeEach has already booted this page with the real print. */
    await boot(page);
    await withRelief(page);
    await openSolar(page);
    const row = page.locator('#solList tr').first();
    const idx = await row.getAttribute('data-idx');
    await row.click();
    await page.waitForTimeout(1_500);
    await expect(page.locator('#bcSol')).toBeVisible();

    await page.locator('#bcBrief').click();
    expect(await page.evaluate(() => (window as unknown as { __printed?: boolean }).__printed)).toBe(true);
    /* THIS roof, not the last one rendered: the sheet is printed away from the
       screen, so a stale index is a mistake nobody would catch by eye. */
    await expect(page.locator('#brIdx')).toHaveText(`#${idx}`);
    await expect(page.locator('#brSure li')).toHaveCount(5);
    /* THE LADDER'S SENTENCES, NOT ITS BUTTONS. "Ask about this" is an offer to
       email us; printed on paper it is a phrase with nothing behind it. */
    await expect(page.locator('#brSure')).not.toContainText('Ask about this');
    await expect(page.locator('.br-ask li')).toHaveCount(6);
    await expect(page.locator('#brOutline polygon')).toHaveCount(1);

    /* ONE PAGE, MEASURED RATHER THAN HOPED FOR. A4 at 96 dpi is 1123 px tall and
       the sheet takes 16 mm off the top and the bottom, leaving 1002 px; anything
       past that silently becomes a second sheet of paper.

       ASSERTED WHILE THE SHEET IS OPEN, which is the only state the printer ever
       sees it in -- `afterprint` is dispatched by hand below, as the real event
       would be when the dialogue closes. The stub does not fire it inside print()
       because the sheet is `hidden` again the instant it does, and `hidden` cannot
       be overridden from here: the site's reset declares it
       `display:none!important` inside Tailwind's `base` layer, and a layered
       important beats an unlayered one whatever its specificity. */
    /* MEASURED AT A4's WIDTH, not the browser's. Desktop Chrome is 1280 px wide and
       an A4 page inside 16 mm margins is ~673 CSS px: at the wider viewport every
       wrapped line is half the height it will be on paper, so a two-page sheet
       could pass this check comfortably. The viewport is narrowed here and stays
       narrow for the two assertions that follow it; neither reads a size, so
       nothing after this line depends on the width either way. */
    await page.setViewportSize({ width: 673, height: 1000 });
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#solBrief')).toBeVisible();
    const sheet = (await page.locator('#solBrief').boundingBox())!;
    expect(sheet.height).toBeLessThanOrEqual(1000);
    /* And the console is NOT on the paper -- the print rule hides every sibling,
       so the card the brief was opened from goes with them. */
    await expect(page.locator('#bcard')).toBeHidden();

    /* The dialogue closes and the sheet leaves the screen again. Without this the
       brief would sit over the console for the rest of the visit. */
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#solBrief')).toBeHidden();
  });
});
