// tests/e2e/obos-v2-boot.spec.ts
import { expect, test } from '@playwright/test';
import { duplicateIds, openV2 } from './obos-v2-helpers';

test.describe('@v2 boot', () => {
  test.setTimeout(180_000);

  test('@v2 the flag swaps the tree before mount: one main, unique ids, live readouts, no page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openV2(page);
    expect(await duplicateIds(page)).toEqual([]);
    await expect(page.locator('template#obos-v2-tree')).toHaveCount(0);
    await expect(page.locator('#bcount')).not.toHaveText('— buildings');
    expect(errors).toEqual([]);
  });

  test('@v2 a v2 visit never writes the v1 panel or rail preference', async ({ page }) => {
    await openV2(page);
    const keys = await page.evaluate(() => [localStorage.getItem('obos:panel'), localStorage.getItem('obos:rail')]);
    expect(keys).toEqual([null, null]);
  });

  test('@v2 ?ui=v1 clears the sticky flag; ?ui=v2 sets it again', async ({ page }) => {
    await openV2(page);
    await page.goto('/heat-map/in/kolkata/ballygunge/?ui=v1');
    await expect(page.locator('html')).not.toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('main#main.stage:not(.obos-v2)')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('obos:ui'))).toBeNull();
    await page.goto('/heat-map/in/kolkata/ballygunge/?ui=v2');
    await expect(page.locator('main.obos-v2')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('obos:ui'))).toBe('v2');
  });

  test('@v2 the flag survives a cross-city hard navigation and a soft (ClientRouter) one', async ({ page }) => {
    await openV2(page);
    await page.goto('/heat-map/in/bengaluru/mg-road/');
    await expect(page.locator('main.obos-v2')).toHaveCount(1);
    await page.evaluate(() => { const a = document.createElement('a'); a.href = '/heat-map/in/kolkata/baruipur/'; a.id = 'softnav'; a.textContent = 'soft nav'; a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;padding:8px;background:#fff'; document.body.append(a); });
    await page.locator('#softnav').click();
    await expect(page).toHaveURL(/baruipur/);
    await expect(page.locator('html')).toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('main.obos-v2')).toHaveCount(1);
    expect(await duplicateIds(page)).toEqual([]);
  });

  test('@v2 in-place ward switch still works (obos:open-area)', async ({ page }) => {
    await openV2(page);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('obos:open-area', { detail: { key: 'in/kolkata/baruipur' } })));
    await expect(page).toHaveURL(/\/in\/kolkata\/baruipur\//, { timeout: 30_000 });
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-area', 'in/kolkata/baruipur');
    await expect(page.locator('#crumbArea')).toHaveText('Baruipur');
  });
});
