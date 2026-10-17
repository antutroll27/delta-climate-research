// tests/e2e/obos-v2-solar.spec.ts — OBOS v2 spec §4.6, §3.10 [H] (Track B, plan S6.1 and S6.2)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openV2 } from './obos-v2-helpers';

const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';
/** The icon, not the item's centre: in icons mode the centre is clipped away (S2 audit F10, as obos-v2-shell.spec.ts does). */
const openSolar = (page: Page): Promise<void> => page.locator('.nav-item[data-section="solar"]').click({ position: { x: 30, y: 22 } });
const read = async (dl: { path(): Promise<string | null> }): Promise<string> => readFile((await dl.path()) as string, 'utf8');

/** Click the ranked roofs in turn until one opens the card with a payback door (a roof under 1 kW has none). */
async function selectRoofWithPayback(page: Page): Promise<string> {
  for (const row of await page.locator('#solList tr[data-idx]').all()) {
    await row.click();
    if (await page.locator('#bcPay').isVisible()) return (await row.getAttribute('data-idx')) as string;
  }
  throw new Error('no ranked roof offers a payback');
}

test.describe('@v2 solar', () => {
  test.setTimeout(180_000);
  /* an action that cannot be performed fails in 30 s with its call log, not after the whole test budget */
  test.beforeEach(({ page }) => { page.setDefaultTimeout(30_000); });

  test('@v2 [H] Solar section: list in the side panel, headline with its floor, tariff persists, roof CSV downloads, Enter and Space select a roof', async ({ page }) => {
    await openV2(page);
    await openSolar(page);
    await expect(page.locator('[data-side-pane="solar"] #solList tr[data-idx]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#solList tr[data-idx]')).toHaveCount(10);
    await expect(page.locator('#solPaneKwp')).toContainText('MWp');
    await expect(page.locator('#solPaneFloor')).not.toBeEmpty();
    /* H13: the floor is beside the headline, not under a fold: same card, same .interval row, within a headline's height */
    const k = await page.locator('#solPaneKwp').boundingBox(), f = await page.locator('#solPaneFloor').boundingBox();
    /* B-S6 audit F3 (H13): the floor's top within 8 px of the headline's bottom, and nothing between them */
    expect(f!.y - (k!.y + k!.height), 'the floor touches the headline').toBeLessThanOrEqual(8);
    expect(f!.y - (k!.y + k!.height), 'the floor is below the headline, not behind it').toBeGreaterThanOrEqual(-2);
    expect((await page.locator('#solPaneConf').boundingBox())!.y, 'nothing sits between the headline and its floor').toBeGreaterThan(f!.y);
    expect(await page.locator('#solPaneKwp').evaluate((e) => e.parentElement === document.querySelector('#solPaneFloor')!.parentElement
      && e.parentElement!.classList.contains('interval'))).toBe(true);
    await expect(page.locator('#solPaneFloor')).toContainText('strict roof mask');
    await expect(page.locator('#solPaneConf')).toContainText('Screening');
    await expect(page.locator('#solPaneConf')).toContainText('not bankable');
    /* H14: the tier word on screen is "screened" here, and the page never says "validated" */
    await expect(page.locator('#solPaneTier')).toHaveText('screened');
    expect(await page.locator('main.obos-v2').evaluate((e) => /\bvalidated\b/i.test((e as HTMLElement).innerText))).toBe(false);
    /* H15: the ward estimate carries its words, its price date and the tag */
    await expect(page.locator('#solPanePay')).toBeVisible();
    await expect(page.locator('#solPanePay')).toContainText('estimate, not a quote');
    await expect(page.locator('#solPanePay')).toContainText('reference defaults as of');
    /* the tariff: the app's own box, the country's currency mark, persisted under v1's key */
    await expect(page.locator('#solCur')).not.toBeEmpty();
    await page.locator('#solTariff').fill('9.25');
    await page.locator('#solTariff').blur();
    expect(await page.evaluate(() => localStorage.getItem('delta:hm-tariff'))).toBe('9.25');
    await expect(page.locator('#solPaneRs')).toContainText('9.25');
    /* the ten best roofs select their building with Enter and with Space */
    const rows = page.locator('#solList tr[data-idx]');
    for (const [n, key] of [[1, 'Enter'], [2, ' ']] as const) {
      const idx = await rows.nth(n).getAttribute('data-idx');
      await rows.nth(n).focus();
      await page.keyboard.press(key);
      await expect(page.locator('#bcId')).toHaveText(`#${idx}`);
      await expect(page.locator('#bcard')).not.toHaveAttribute('hidden', '');
      /* B-S6 audit F6: the selected roof's row is marked, and only that row */
      await expect(page.locator(`#solList tr[data-idx="${idx}"]`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#solList tr[aria-selected="true"]')).toHaveCount(1);
    }
    const dl = page.waitForEvent('download');
    await page.locator('#solCsv').click();
    const roofs = await dl;
    expect(roofs.suggestedFilename()).toBe('solar-ballygunge.csv');
    const lines = (await read(roofs)).trim().split('\n');
    expect(lines[0]).toContain('tariff_per_kwh');
    expect(lines.length).toBe(1 + 7931);
  });

  test('@v2 [H] payback: Use my bill sizes the system; the year CSV carries the tag; the brief prints alone; Esc closes only the sheet', async ({ page }) => {
    await page.addInitScript(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed += 1; }; });
    await openV2(page);
    await openSolar(page);
    await expect(page.locator('#solList tr[data-idx]').first()).toBeVisible({ timeout: 60_000 });
    const idx = await selectRoofWithPayback(page);
    await page.locator('#bcPay').click();
    await expect(page.locator('#solPay')).toBeVisible();
    /* B-S6 audit F1: the sheet opens at its top (the app focuses the last control, Close), so the size and owner are in view and Close is reachable without scrolling */
    await expect.poll(() => page.locator('#solPay').evaluate((e) => e.scrollTop), { message: 'the sheet opens scrolled' }).toBe(0);
    const inSheet = async (sel: string): Promise<boolean> => page.evaluate((q) => {
      const s = document.querySelector('#solPay')!.getBoundingClientRect(), r = document.querySelector(q)!.getBoundingClientRect();
      return r.top >= s.top && r.bottom <= s.bottom;
    }, sel);
    expect(await inSheet('#spSize'), 'the size slider is in view on open').toBe(true);
    expect(await inSheet('input[name="spOwner"][value="home"]'), 'the owner choice is in view on open').toBe(true);
    expect(await inSheet('#spClose'), 'Close is in view without scrolling').toBe(true);
    expect(await page.locator('#solPay').evaluate((e) => getComputedStyle(e).scrollbarWidth), 'a scrollbar cue remains').not.toBe('none');
    await expect(page.locator('#spTag')).toHaveText('screened · estimate, not a quote');
    await expect(page.locator('#spAssume')).toContainText('reference defaults as of');
    /* the v1/preview mismatch: the warning points at "Use my bill", so that field is on the sheet, labelled, visible, and it works */
    await expect(page.locator('#spFlat')).toBeVisible();
    await expect(page.locator('#spFlat')).toContainText('Use my bill');
    await expect(page.locator('label[for="spUnits"]')).toContainText('Use my bill');
    await expect(page.locator('#spUnits')).toBeVisible();
    await expect(page.locator('#spSizing')).toBeHidden();
    await page.locator('#spUnits').fill('300');
    await page.locator('#spUnits').dispatchEvent('input');
    await expect(page.locator('#spSizing')).toBeVisible();
    await expect(page.locator('#spSizing')).toContainText('PM Surya Ghar suggests');
    await expect(page.locator('#spAssume')).toContainText('300 units a month');
    await expect(page.locator('#spFlat')).toBeHidden();
    /* the year-by-year CSV: the assumptions and the tag ride every row */
    const dl = page.waitForEvent('download');
    await page.locator('#spCsv').click();
    const year = await dl;
    expect(year.suggestedFilename()).toBe(`solar-payback-ballygunge-${idx}.csv`);
    const rows = (await read(year)).trim().split('\n');
    expect(rows[0]).toMatch(/^year,kwh_slow,/);
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows.slice(1)) expect(r).toContain('screened · estimate, not a quote');
    /* the brief, opened from the sheet */
    await page.locator('#spPrint').click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
    await expect(page.locator('#solPay')).toBeHidden();
    await expect(page.locator('#solBrief')).toBeVisible();
    await expect(page.locator('#brIdx')).toHaveText(`#${idx}`);
    await expect(page.locator('#brTier')).toHaveText('screened');
    await expect(page.locator('#brFoot')).toContainText('not bankable');
    await expect(page.locator('#brPayAssume')).toContainText('estimate, not a quote');
    await expect(page.locator('#brOutline polygon')).toHaveCount(1);
    await expect(page.locator('#solBrief')).toContainText('Questions to ask your installer');
    await expect(page.locator('.br-ask li')).toHaveCount(6);
    /* on paper: v2 chrome hidden, the brief alone, no close button */
    await page.emulateMedia({ media: 'print' });
    expect(await page.locator('#v2Rail').isVisible()).toBe(false);
    expect(await page.locator('#legend').isVisible()).toBe(false);
    await expect(page.locator('#solBrief')).toBeVisible();
    await expect(page.locator('#brClose')).toBeHidden();
    await expect(page.locator('#solBrief')).toContainText('Questions to ask your installer');
    await expect(page.locator('#brFoot')).toContainText('not bankable');
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#solBrief')).toBeHidden();
    /* Esc closes the sheet and stops there: the roof stays selected, the focus returns to the door */
    await page.locator('#bcPay').click();
    await expect(page.locator('#solPay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#solPay')).toBeHidden();
    await expect(page.locator('#bcard')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#bcId')).toHaveText(`#${idx}`);
    await expect(page.locator('#bcPay')).toBeFocused();
    /* and the card's own door to the brief works too */
    await page.locator('#bcBrief').click();
    await expect(page.locator('#solBrief')).toBeVisible();
    await expect(page.locator('#brClose')).toBeVisible();
    await page.locator('#brClose').click();
    await expect(page.locator('#solBrief')).toBeHidden();
  });

  test('@v2 [H] a checked ward says "checked", never "validated", on every solar surface', async ({ page }) => {
    /* B-S6 audit F2: the checked tier is unreachable on shipped data (tiers.validated is null), so the ward file is given a result, as solar-pane.spec.ts does */
    const real = JSON.parse(await readFile(fileURLToPath(new URL('../../public/heat-map/data/pv-ballygunge.json', import.meta.url)), 'utf8'));
    real.tiers.validated = { n: 31, months: 9, median_ratio: 0.97, within_15pct_share: 0.84, date: '2026-10-01' };
    await page.route('**/heat-map/data/pv-ballygunge.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(real) }));
    await page.addInitScript(() => { window.print = () => undefined; });
    await openV2(page);
    await openSolar(page);
    await expect(page.locator('#solList tr[data-idx]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#solPaneTier')).toHaveText('checked');
    await expect(page.locator('#solPaneConf')).toHaveText(/^Checked · /);
    await expect(page.locator('#solPaneSure')).toContainText('Checked against 31 real rooftops');
    await selectRoofWithPayback(page);
    await expect(page.locator('#bcSolTier')).toHaveText('checked');
    await page.locator('#bcBrief').click();
    await expect(page.locator('#brTier')).toHaveText('checked');
    await expect(page.locator('#brFoot')).toContainText('Checked against');
    await expect(page.locator('#brFoot')).toContainText('not bankable');
    for (const sel of ['.sl-ward', '[data-v2-card="ward-payback"]', '#solPay', '#solBrief', '#bcSol', '[data-side-pane="solar"]']) {
      const text = await page.locator(sel).evaluate((e) => (e as HTMLElement).textContent ?? '');
      expect(text, `${sel} must never say "validated"`).not.toMatch(/\bvalidated\b/i);
    }
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  });

  test('@v2 a ward with no solar screen shows the empty note alone, not an empty tariff tool', async ({ page }) => {
    /* B-S6 audit F7 */
    await openV2(page, '/heat-map/in/bengaluru/mg-road/');
    await openSolar(page);
    await expect(page.locator('#solPaneSum')).toContainText('No solar screen ships for');
    for (const sel of ['.sl-tariff', '#solTariffNote', '.sl-listh', '.roofs-scroll', '#solCsv']) await expect(page.locator(sel), `${sel} stays hidden`).toBeHidden();
  });

  test('@v2 [H] the roof CSV and the year CSV are byte-identical to v1\'s for the same inputs', async ({ page }) => {
    test.slow();
    await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } window.print = () => undefined; });
    /* v1: the sticky flag is cleared by ?ui=v1 (spec D3). In-page clicks, as solar-roi.spec.ts does: a frame is slow on the software renderer. */
    const tap = (sel: string) => page.locator(sel).evaluate((e) => (e as HTMLElement).click());
    await page.goto(`${BALLYGUNGE}?ui=v1`);
    await expect(page.locator('html')).not.toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
    await tap('[data-rail="solar"]');
    await expect(page.locator('#solList tr')).toHaveCount(10, { timeout: 30_000 });
    const v1Roofs = page.waitForEvent('download');
    await tap('#solCsv');
    const v1RoofCsv = await read(await v1Roofs);
    await page.locator('#solList tr').first().evaluate((e) => (e as HTMLElement).click());
    await expect(page.locator('#bcPay')).toBeVisible({ timeout: 15_000 });
    const idx = await page.locator('#bcId').textContent();
    await tap('#bcPay');
    await expect(page.locator('#solPay')).toBeVisible();
    const v1Year = page.waitForEvent('download');
    await tap('#spCsv');
    const v1YearDl = await v1Year;
    const v1YearCsv = await read(v1YearDl);
    /* B-S6 audit F8: the bill-mode year CSV, the most money-sensitive path */
    await page.locator('#spUnits').evaluate((e, v) => { (e as HTMLInputElement).value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, '300');
    const v1Bill = page.waitForEvent('download');
    await tap('#spCsv');
    const v1BillCsv = await read(await v1Bill);
    /* v2: the same ward, the same first roof, the same defaults */
    await openV2(page, `${BALLYGUNGE}?ui=v2`);
    await openSolar(page);
    await expect(page.locator('#solList tr[data-idx]').first()).toBeVisible({ timeout: 60_000 });
    const v2Roofs = page.waitForEvent('download');
    await page.locator('#solCsv').click();
    const v2RoofCsv = await read(await v2Roofs);
    await page.locator('#solList tr[data-idx]').first().click();
    await expect(page.locator('#bcPay')).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('#bcId').textContent(), 'the same roof was selected in both').toBe(idx);
    await page.locator('#bcPay').click();
    const v2Year = page.waitForEvent('download');
    await page.locator('#spCsv').click();
    const v2YearDl = await v2Year;
    const v2YearCsv = await read(v2YearDl);
    await page.locator('#spUnits').fill('300');
    await page.locator('#spUnits').dispatchEvent('input');
    const v2Bill = page.waitForEvent('download');
    await page.locator('#spCsv').click();
    const v2BillCsv = await read(await v2Bill);
    expect(v1RoofCsv.length).toBeGreaterThan(100_000);
    expect(v2RoofCsv === v1RoofCsv, 'the roof CSV differs from v1').toBe(true);
    expect(v1YearCsv.length).toBeGreaterThan(500);
    expect(v2YearCsv === v1YearCsv, 'the year CSV differs from v1').toBe(true);
    expect(v2YearDl.suggestedFilename()).toBe(v1YearDl.suggestedFilename());
    expect(v1BillCsv).not.toBe(v1YearCsv);
    expect(v2BillCsv === v1BillCsv, 'the bill-mode year CSV differs from v1').toBe(true);
  });
});
