import { expect, test } from '@playwright/test';

test.describe('paired heat-map comparison', () => {
  test('settles an atomic comparison, updates state, and exposes the Brief', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/heat-map/compare/');
    await expect(page).toHaveTitle(/Compare Urban Heat Scenarios/);
    await expect(page.locator('main[data-compare-root] h1')).toContainText('Same policy');
    await expect(page.locator('[data-map-field="a"]')).toBeVisible();
    await expect(page.locator('[data-map-field="b"]')).toBeVisible();
    await expect(page.locator('[data-role="status"]')).toContainText('Comparison settled', { timeout: 30_000 });
    await expect(page.locator('[data-value="a-scenario"]').first()).not.toHaveText('—');
    await expect(page.locator('[data-value="b-scenario"]').first()).not.toHaveText('—');

    await page.locator('[data-input="roofs"]').press('ArrowRight');
    await expect(page).toHaveURL(/roof=70/);
    await expect(page.locator('[data-role="status"]')).toContainText('Comparison settled', { timeout: 30_000 });

    const brief = page.locator('[data-role="brief-link"]');
    await expect(brief).toHaveAttribute('href', /heat-map\/brief\/\?/);
  });

  test('keeps Compare and Brief nonindexable', async ({ page }) => {
    await page.goto('/heat-map/compare/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.goto('/heat-map/brief/?a=ballygunge&b=baruipur');
    await expect(page.locator('main[data-brief-root] h1')).toHaveText('Paired scenario brief');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('lets the active adaptive field orbit and return to its reset view', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/heat-map/compare/');
    await expect(page.locator('[data-role="status"]')).toContainText('Comparison settled', { timeout: 30_000 });

    const root = page.locator('main[data-compare-root]');
    await expect.poll(() => root.evaluate((node) => (
      (node as HTMLElement).dataset.renderer === 'three'
      || Boolean((node as HTMLElement).dataset.rendererReason)
    ))).toBe(true);
    const motion = page.locator('[data-action="motion"]');
    if (await motion.isEnabled()) {
      await motion.click();
      await expect(motion).toHaveText('Motion');
    }
    await page.locator('[data-action="map-reset"][data-map-reset="a"]').click();

    const map = page.locator(
      'main[data-renderer="three"] [data-map-three="a"], main[data-renderer="canvas"] [data-map-field="a"]',
    );
    await expect(map).toBeVisible();
    await expect(map).toHaveAttribute('data-map-view', /.+/);
    await expect.poll(() => map.getAttribute('data-map-view')).toBe(
      (await root.getAttribute('data-renderer')) === 'three'
        ? '-0.300,0.920,1.00'
        : '0.000,0.620,1.00',
    );
    const resetView = await map.getAttribute('data-map-view');
    const box = await map.boundingBox();
    if (!box) throw new Error('Map canvas did not have a visible box.');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.42);
    await page.mouse.up();
    await expect(map).not.toHaveAttribute('data-map-view', resetView ?? '');

    await page.locator('[data-action="map-reset"][data-map-reset="a"]').click();
    await expect(map).toHaveAttribute('data-map-view', resetView ?? '');
  });
});
