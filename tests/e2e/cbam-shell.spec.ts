// The rail shell (spec §4) and the one behaviour change (spec §6.3): the draft always previews.
import { expect, test } from '@playwright/test';

import { CBAM_URL as URL, priceLine, view } from './cbam-helpers';

test.describe('CBAM shell', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens on Estimate, and only one view is visible', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('[data-view="estimate"]')).toBeVisible();
    await expect(page.locator('[data-view]:visible')).toHaveCount(1);
    await expect(page.locator('.cbx-rail [data-goto="estimate"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.cbx-app').first()).toHaveText(/CBAM Calculator/i);
  });

  test('the rail switches views, writes the hash, and focuses the heading', async ({ page }) => {
    await page.goto(URL);
    await view(page, 'rules');
    expect(new globalThis.URL(page.url()).hash).toBe('#rules');
    await expect(page.locator('#cbxH-rules')).toBeFocused();
    await expect(page.locator('[data-view="estimate"]')).toBeHidden();
  });

  test('a hash opens its view; an unknown one falls back to Estimate', async ({ page }) => {
    await page.goto(`${URL}#why`);
    await expect(page.locator('[data-view="why"]')).toBeVisible();
    await page.goto(`${URL}#nope`);
    await expect(page.locator('[data-view="estimate"]')).toBeVisible();
  });

  test('empty views say what to do', async ({ page }) => {
    await page.goto(`${URL}#three-years`);
    await expect(page.locator('[data-view="three-years"] .cbx-empty')).toBeVisible();
    await expect(page.locator('[data-view="three-years"] .cbx-empty')).toContainText('Price a line first.');
    await expect(page.locator('[data-view="three-years"] .cbx-empty')).toContainText('The three-year view appears once a line is priced on Estimate.');
    await page.goto(`${URL}#why`);
    await expect(page.locator('[data-view="why"] .cbx-empty')).toContainText('The cause split and the working appear once a line is priced on Estimate.');
    await page.goto(`${URL}#list`);
    await expect(page.locator('[data-view="list"] .cbx-empty')).toBeVisible();
    await expect(page.locator('[data-view="list"] .cbx-empty')).toContainText('No lines yet.');
    await expect(page.locator('[data-view="list"] .cbx-empty')).toContainText('Price a line on Estimate, then add it to the list.');
    // The empty-state button is the sans pill, not the old mono-uppercase cb-btn.
    const goto = page.locator('[data-view="list"] .cbx-empty button[data-goto="estimate"]');
    await expect(goto).toHaveCSS('text-transform', 'none');
  });

  test('the title card follows the draft', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('#cbTitle')).toContainText('No line yet');
    await priceLine(page);
    await expect(page.locator('#cbTitle .cbx-tc-code')).toHaveText('2523100090');
    await expect(page.locator('#cbTitle')).toContainText('(A)');
  });

  test('spec §6.3: with lines in the list, the draft still previews', async ({ page }) => {
    await page.goto(URL);
    await priceLine(page);
    await page.click('#cbAdd');
    await expect(page.locator('#cbList .cb-line')).toHaveCount(1);
    await expect(page.locator('.cbx-rail [data-list-badge]')).toHaveText('1');
    // The list did NOT replace the preview…
    await expect(page.locator('#cbOut .cb-line')).toHaveCount(0);
    await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
    // …and editing the next line still previews it.
    await page.fill('#cbMass', '200');
    await expect(page.locator('#cbTitle')).toContainText('200 t');
    await view(page, 'three-years');
    await expect(page.locator('#cbOutlook .cb-ol')).toBeVisible();
  });

  test('remove and attest work on the List view and are announced', async ({ page }) => {
    await page.goto(URL);
    await priceLine(page);
    // Under 50 t, so the year is below the de minimis threshold and offers the completeness box to tick.
    await page.fill('#cbMass', '40');
    await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
    await page.click('#cbAdd');
    await view(page, 'list');
    await expect(page.locator('#cbStatus')).toBeVisible();
    await expect(page.locator('#cbStatus')).toContainText('1 line in this estimate');
    // Audit F-13: the test was titled "attest" and never ticked the box. Ticking it announces what the tick
    // DID to the year's verdict (the checkbox's own state is announced natively, the verdict is not), and the
    // rebuild of the list must not drop keyboard focus to <body>.
    const attest = page.locator('#cbList [data-attest="2026"]');
    await expect(page.locator('#cbStatus')).toContainText('Threshold 2026 indeterminate');
    await expect(attest).not.toBeChecked();
    await attest.check();
    await expect(attest).toBeChecked();
    await expect(attest).toBeFocused();
    await expect(page.locator('#cbStatus')).toContainText('Threshold 2026 below threshold');
    await expect(page.locator('#cbStatus')).not.toContainText('indeterminate');
    await attest.uncheck();
    await expect(attest).toBeFocused();
    await expect(page.locator('#cbStatus')).toContainText('Threshold 2026 indeterminate');
    await attest.check();
    await expect(attest).toBeFocused();
    await expect(page.locator('#cbStatus')).toContainText('Threshold 2026 below threshold');
    await page.locator('#cbList [data-remove]').first().click();
    await expect(page.locator('#cbList .cb-line')).toHaveCount(0);
    await expect(page.locator('[data-view="list"] .cbx-empty')).toBeVisible();
    await expect(page.locator('#cbxH-list')).toBeFocused();
  });

  test('phone: tab bar and top bar replace the rail', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    await expect(page.locator('.cbx-rail')).toBeHidden();
    await expect(page.locator('.cbx-top')).toContainText('CBAM Calculator');
    await page.locator('.cbx-tabs [data-goto="why"]').click();
    await expect(page.locator('[data-view="why"]')).toBeVisible();
    await page.locator('.cbx-more > summary').click();
    await page.locator('.cbx-more [data-goto="rules"]').click();
    await expect(page.locator('[data-view="rules"]')).toBeVisible();
  });

  test('Legislation & updates: the new name everywhere, the Updates tile, #rules still works', async ({ page }) => {
    await page.goto(URL);
    await view(page, 'rules');
    expect(new globalThis.URL(page.url()).hash).toBe('#rules');
    await expect(page.locator('#cbxH-rules')).toContainText('Legislation & updates.');
    await expect(page.locator('.cbx-rail')).toContainText('Legislation & updates');
    await expect(page.locator('body')).not.toContainText('Rules & sources');
    const rows = page.locator('[data-view="rules"] #cbUpdates li');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.locator('[data-view="rules"] #cbUpdates')).toContainText('Regulation (EU) 2025/2083');
    // The older rows sit in a closed native <details>; opening it by its summary reveals them.
    await page.locator('[data-view="rules"] #cbUpdates .b-upd-more summary').click();
    await expect(page.locator('[data-view="rules"] #cbUpdates li', { hasText: 'Regulation (EU) 2025/2083' }).first()).toBeVisible();
  });
});
