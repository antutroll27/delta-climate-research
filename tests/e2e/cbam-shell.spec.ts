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
    await page.goto(`${URL}#list`);
    await expect(page.locator('[data-view="list"] .cbx-empty')).toBeVisible();
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
    await page.click('#cbAdd');
    await view(page, 'list');
    await expect(page.locator('#cbStatus')).toBeVisible();
    await expect(page.locator('#cbStatus')).toContainText('1 line in this estimate');
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
});
