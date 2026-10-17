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

test.describe('@v2 building card', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  /** the app selects a building from the roof list (a hidden parked pane until Track B's Solar screen); a row click is the same code path as a map click */
  const pick = async (page: import('@playwright/test').Page, row = 0) => {
    await expect(page.locator('#solList tr[data-idx]').nth(row)).toBeAttached({ timeout: 60_000 });
    await page.locator('#solList tr[data-idx]').nth(row).dispatchEvent('click');
  };

  test('@v2 [H] a roof row selects its building: card in the right column, surface row, rings, greenery, Esc closes', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    await pick(page);
    const card = page.locator('#bcard');
    await expect(card).toBeVisible();
    const box = await card.boundingBox(), col = await page.locator('#legend').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(col!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(col!.x + col!.width + 1);
    await expect(page.locator('[data-v2-card="temp"]')).toBeHidden();       // the card replaces the column's other cards
    await expect(page.locator('#bcT')).not.toHaveText('—');
    await expect(page.locator('#bcRings')).toContainText('how far you could walk from this building in 1 and 5 minutes');
    await expect(page.locator('#bcIns')).not.toBeEmpty();
    await expect(page.locator('#bcSolKwp')).toBeVisible();
    const kwp = await page.locator('#bcSolKwp').boundingBox(), floor = await page.locator('#bcSolFloor').boundingBox();
    expect(Math.abs(kwp!.y - floor!.y), 'H13: the strict floor sits beside the headline').toBeLessThanOrEqual(8);
    /* the ring labels and the greenery tag are placed clear of every HUD box (the app's keep-out, spec E1/E2) */
    await page.waitForTimeout(1500);                                         // the entrance animation and the app's 250 ms HUD read settle
    for (const sel of ['#ringNear', '#ringFar', '#coolTag']) {
      const shown = await page.locator(sel).evaluate((e) => !(e as HTMLElement).hidden && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
      if (!shown) continue;                                                  // hidden when nowhere is clear: allowed
      const b = (await page.locator(sel).boundingBox())!;
      for (const hud of await page.locator('[data-hud]:visible').all()) {
        const h = await hud.boundingBox();
        if (!h || h.width === 0) continue;
        const overlap = b.x < h.x + h.width && b.x + b.width > h.x && b.y < h.y + h.height && b.y + b.height > h.y;
        const id = await hud.evaluate((e) => `${e.tagName}#${e.id}.${e.className}`);
        expect(overlap, `${sel} ${JSON.stringify(b)} sits on HUD ${id} ${JSON.stringify(h)}`).toBe(false);
      }
    }
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(page.locator('[data-v2-card="temp"]')).toBeVisible();
  });

  test('@v2 the close button and a second building both work; no page errors over a selection and an orbit', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await openV2(page);
    await pick(page, 0);
    await expect(page.locator('#bcard')).toBeVisible();
    const first = await page.locator('#bcId').textContent();
    await pick(page, 1);
    await expect(page.locator('#bcId')).not.toHaveText(first ?? '');
    await page.waitForTimeout(4000);                                          // the app places the card every frame; a clash would throw here
    await page.locator('#bcX').click();
    await expect(page.locator('#bcard')).toBeHidden();
    expect(errors.filter((e) => !/mapillary|favicon|Failed to load resource/i.test(e))).toEqual([]);
  });

  test('@v2 payback opens over the card; Esc closes only the sheet', async ({ page }) => {
    await openV2(page);
    /* the app shows #bcPay only where a payback can be computed: take the first of five roofs that offers it */
    let shown = false;
    for (let i = 0; i < 5 && !shown; i++) {
      await pick(page, i);
      shown = await page.locator('#bcPay').isVisible();
    }
    expect(shown, 'none of the first five roofs offers a payback').toBe(true);
    await page.locator('#bcPay').click();
    await expect(page.locator('#solPay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#solPay')).toBeHidden();
    await expect(page.locator('#bcard')).toBeVisible();
  });

  test('@v2 [H] a landmark (Bengaluru): its published height AND its source are on the card', async ({ page }) => {
    await openV2(page, '/heat-map/in/bengaluru/mg-road/');
    /* landmark chips are pinned to roofs, so they exist only in the 3-D relief view (the app hides them in 2-D isotherm; tier 0 may start there) */
    await page.locator('[data-pop-open="layers"]').click();
    await page.locator('.layers-pop [data-m="relief"]').click();
    await page.keyboard.press('Escape');
    const chip = page.locator('#lmlabs .lmlab:not([hidden])').first();
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await chip.click();
    await expect(page.locator('#tiphint')).toBeHidden();                       // finding a landmark retires the first-run hint (app)
    await expect(page.locator('#bcLm')).toBeVisible();
    await expect(page.locator('#bcLmH')).not.toHaveText('—');
    await expect(page.locator('#bcLmSrc')).not.toHaveText('—');
  });
});
