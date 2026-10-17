// tests/e2e/obos-v2-building.spec.ts — OBOS v2 spec §3.8 (map stack), §4.8 (building card) [H]. Owner: Track A (plan S4.2, S4.3).
import { expect, test } from '@playwright/test';
import { openV2, stubWeather } from './obos-v2-helpers';

test.describe('@v2 map stack', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });   // Desktop: the ward card starts open (it starts folded on a laptop)

  test('@v2 [H] ward card: the app\'s own count and engine, the map-face chip as three rows, Less/More, the crumb opens Explore', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page, '/heat-map/in/kolkata/ballygunge/?lab=1');
    const card = page.locator('#v2WardCard');
    await expect(card).toBeVisible();
    /* the app's sentence, whole: the ward count first, the drawn count beside it */
    await expect(page.locator('#bcount')).toHaveText(/^[\d,]+ buildings in .+ · [\d,]+ drawn$/);
    await expect(page.locator('#simBackend')).not.toHaveText('SELECTING ENGINE');
    const rows = card.locator('.wc-prov li');
    await expect(rows).toHaveText(['Live basemap, real footprints & Google heights', 'Heat field · modelled', 'Block detail · illustrative']);
    await expect(card.locator('[data-v2-crumb]')).toContainText('India');
    await expect(card.locator('[data-v2-crumb] .crumb-g .cgw:not([hidden]) svg')).toBeVisible();
    await expect(card.locator('[data-v2-crumb] .crumb-g .cgw:not([hidden])')).toHaveAttribute('data-v2-for', 'in/kolkata/ballygunge');
    /* Less / More */
    const more = card.locator('[data-v2-more]');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await more.click();
    await expect(card.locator('.wc-body')).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toHaveAttribute('aria-label', 'Show more about this ward');
    await more.click();
    await expect(card.locator('.wc-body')).toBeVisible();
    /* the breadcrumb is a door to the Location selects (the Explore panel) */
    await page.locator('.nav-item[data-section="overview"]').click({ position: { x: 30, y: 22 } });   // the current section's item closes its side panel
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-side-shown', '0');
    await card.locator('[data-v2-crumb]').click();
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-side-current', 'explore');
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-side-shown', '1');
    /* an in-place ward switch moves the crumb and its outline */
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('obos:open-area', { detail: { key: 'in/kolkata/baruipur' } })));
    await expect(page.locator('#crumbArea')).toHaveText('Baruipur', { timeout: 30_000 });
    await expect(card.locator('[data-v2-crumb] .crumb-g .cgw:not([hidden])')).toHaveAttribute('data-v2-for', 'in/kolkata/baruipur');
  });

  test('@v2 the stack keeps clear of the dock and the right column at 1440 x 900 (Sun above Ward)', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    const sun = await page.locator('#v2SunCard').boundingBox(), ward = await page.locator('#v2WardCard').boundingBox();
    const dock = await page.locator('#v2Dock').boundingBox(), col = await page.locator('#legend').boundingBox();
    expect(sun!.y + sun!.height).toBeLessThanOrEqual(ward!.y + 1);
    expect(ward!.y + ward!.height).toBeLessThanOrEqual(dock!.y + 1);
    expect(sun!.x + sun!.width).toBeLessThanOrEqual(col!.x);
  });
});
