import { expect, test } from '@playwright/test';

test.describe('heat-map runtime resilience', () => {
  test('Explore selects a real engine and produces analytical readouts', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    const backend = page.locator('#simBackend');
    await expect(backend).not.toHaveText('SELECTING ENGINE', { timeout: 15_000 });
    await expect(backend).toHaveText(/GPU SIM|CPU SIM|CPU STATIC/);
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });
    await expect(page.locator('#uhi')).not.toContainText('—');
    expect(errors).toEqual([]);
  });

  test('a delayed obsolete ward cannot replace the latest selection', async ({ page }) => {
    let releaseBaruipur!: () => void;
    const held = new Promise<void>((resolve) => { releaseBaruipur = resolve; });
    await page.route('**/heat-map/data/baruipur.json', async (route) => { await held; await route.continue(); });
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });
    await page.locator('#tabs .tab[data-w="baruipur"]').click();
    await page.locator('#tabs .tab[data-w="barrackpore"]').click();
    await expect(page.locator('#pname')).toHaveText('Barrackpore', { timeout: 20_000 });
    releaseBaruipur();
    await page.waitForTimeout(500);
    await expect(page.locator('#tabs .tab.on')).toHaveAttribute('data-w', 'barrackpore');
  });
});
