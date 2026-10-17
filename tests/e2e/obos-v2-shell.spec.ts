// tests/e2e/obos-v2-shell.spec.ts
import { expect, test } from '@playwright/test';
import { openV2 } from './obos-v2-helpers';

test.describe('@v2 shell', () => {
  test.setTimeout(180_000);

  test('@v2 eight menu items; each section is reachable and publishes data-open-pane', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });   // desktop: labels by default (≥1366 px, spec §1.5)
    await openV2(page);
    await expect(page.locator('.rail .nav-label')).toHaveText(
      ['Overview', 'Heat', 'Air', 'Solar', 'Weather', 'Scenarios', 'Analysis · Compare', 'Data & methods', 'Collapse menu']);
    for (const [id, pane] of [['heat', 'heat'], ['air', 'air'], ['solar', 'solar'], ['weather', 'weather'], ['scenarios', 'scenarios'], ['methods', 'reports'], ['overview', 'map']]) {
      await page.locator(`.nav-item[data-section="${id}"]`).click();
      await expect(page.locator('main.obos-v2')).toHaveAttribute('data-section', id);
      await expect(page.locator('html')).toHaveAttribute('data-open-pane', pane);
      await expect(page.locator(`.nav-item[data-section="${id}"]`)).toHaveAttribute('aria-current', 'true');
    }
    await expect(page.locator('a.nav-item[data-rail="analysis"]')).toHaveAttribute('href', /\/heat-map\/compare\/\?/);
  });

  test('@v2 menu labels and side panel are independent: all four combinations', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page);
    const root = page.locator('main.obos-v2');
    const pin = page.locator('[data-menu-pin]');
    const overview = page.locator('.nav-item[data-section="overview"]');
    for (const [menu, side] of [['labels', '1'], ['icons', '1'], ['icons', '0'], ['labels', '0']]) {
      if ((await root.getAttribute('data-menu')) !== menu) await pin.click();
      if ((await root.getAttribute('data-side-shown')) !== side) await overview.click();
      await expect(root).toHaveAttribute('data-menu-eff', menu);
      await expect(root).toHaveAttribute('data-side-shown', side);
      await expect(page.locator('aside.side-panel')).toBeVisible({ visible: side === '1' });
    }
  });

  test('@v2 menu and side preferences survive a reload, applied before paint', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page);
    await page.locator('[data-menu-pin]').click();
    await page.locator('.nav-item[data-section="overview"]').click();
    const want = [await page.locator('main.obos-v2').getAttribute('data-menu'), await page.locator('main.obos-v2').getAttribute('data-side')];
    await page.reload();
    const first = await page.evaluate(() => { const r = document.querySelector('main.obos-v2'); return [r?.getAttribute('data-menu'), r?.getAttribute('data-side')]; });
    expect(first).toEqual(want);
  });

  test('@v2 theme and cards persist and apply pre-paint; theme is CSS-only', async ({ page }) => {
    await openV2(page);
    const root = page.locator('main.obos-v2');
    await expect(root).toHaveAttribute('data-theme', 'dark');            // D5
    let styleLoads = 0;
    page.on('request', (r) => { if (/style.*\.json|tiles.openfreemap/.test(r.url())) styleLoads++; });
    await page.locator('[data-pref="theme"][data-v="light"]').click();
    await expect(root).toHaveAttribute('data-theme', 'light');
    await page.locator('[data-pref="cards"][data-v="glass"]').click();
    await expect(root).toHaveAttribute('data-cards', 'glass');
    await page.reload();
    const first = await page.evaluate(() => { const r = document.querySelector('main.obos-v2'); return [r?.getAttribute('data-theme'), r?.getAttribute('data-cards')]; });
    expect(first).toEqual(['light', 'glass']);
    expect(styleLoads, 'flipping the theme alone must not reload the basemap').toBeLessThan(50);
  });

  test('@v2 first visit pairs the map look with the theme until the look is chosen (D1)', async ({ page }) => {
    await openV2(page);
    await page.locator('[data-pref="theme"][data-v="light"]').click();
    await expect(page.locator('#envchip button[data-e="studio"]')).toHaveClass(/\bon\b/, { timeout: 20_000 });
    await page.locator('[data-pop-open="layers"]').click();
    await page.locator('#envchip button[data-e="dark"]').click();               // an explicit choice
    expect(await page.evaluate(() => localStorage.getItem('obos:v2:look-chosen'))).toBe('1');
    await page.keyboard.press('Escape');
    await page.locator('[data-pref="theme"][data-v="dark"]').click();
    await page.locator('[data-pref="theme"][data-v="light"]').click();
    await expect(page.locator('#envchip button[data-e="dark"]')).toHaveClass(/\bon\b/);  // independent now
  });

  test('@v2 title card follows an in-place ward switch; compass resets north', async ({ page }) => {
    await openV2(page, '/heat-map/in/kolkata/ballygunge/?lab=1');
    await expect(page.locator('.tc-area:not([hidden]) .tc-n')).toHaveText(/^\d/);
    const before = await page.locator('.tc-area:not([hidden]) .tc-n').textContent();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('obos:open-area', { detail: { key: 'in/kolkata/baruipur' } })));
    await expect(page.locator('#pname')).toContainText(/Baruipur/i, { timeout: 30_000 });
    await expect(page.locator('.tc-area:not([hidden]) .tc-n')).not.toHaveText(before ?? '');
    await page.evaluate(() => (window as unknown as { __obosMap?: { setBearing(b: number): void } }).__obosMap?.setBearing(90));
    await page.locator('#compass').click();
    await expect.poll(() => page.locator('#compassDial').getAttribute('transform'), { timeout: 5000 }).toMatch(/rotate\(-?0(\.0+)? 24 24\)/);
  });
});
