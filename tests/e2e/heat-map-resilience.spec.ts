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

  test('a layer checkbox and the on-map chip stay one control', async ({ page }) => {
    /* TWO CONTROLS OVER ONE FACT is how the two come to disagree — the chip
       reading On beside an unticked box — so both call one function that moves the
       layer AND repaints the other. Toggling twice is the point: a sync written
       only for the off case passes the first assertion and leaves the chip stuck.

       DRIVEN FROM THE CHECKBOX, NEVER FROM THE CHIP, and that is an environment
       fact rather than a preference. `#vegw` unhides only once a live ambient
       reading has arrived (paintClock), because the widget is meaningless before a
       ward has loaded — so on a machine with no route to met.no the chip is in the
       DOM, correctly classed, and permanently invisible. Clicking it would make
       this test a network check wearing a wiring check's name. The classes are
       still read, which is what proves the sync ran.

       The layer tree is behind the rail's Layers pane, so this is also the first
       runtime proof that the pane swap works at all. */
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });

    await page.locator('[data-rail="layers"]').click();
    const trees = page.locator('input[data-layer="green/trees"]');
    /* Ticked, because the trees ship for this ward — and enabled, which is the
       state in which a click can prove anything at all. */
    await expect(trees).toBeChecked();
    await expect(trees).toBeEnabled();

    await trees.uncheck();
    await expect(page.locator('#vegchip button[data-v="0"]')).toHaveClass(/\bon\b/);
    await expect(page.locator('#vegchip button[data-v="1"]')).not.toHaveClass(/\bon\b/);

    await trees.check();
    await expect(page.locator('#vegchip button[data-v="1"]')).toHaveClass(/\bon\b/);
    await expect(page.locator('#vegchip button[data-v="0"]')).not.toHaveClass(/\bon\b/);
    expect(errors).toEqual([]);
  });

  test('a delayed obsolete ward cannot replace the latest selection', async ({ page }) => {
    let releaseBaruipur!: () => void;
    const held = new Promise<void>((resolve) => { releaseBaruipur = resolve; });
    await page.route('**/heat-map/data/baruipur.json', async (route) => { await held; await route.continue(); });
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });
    /* THE WARD STRIP, which is now the only in-place area switcher on the page.
       The header tab strip did this job when this test was written; it was the
       third switcher on one page, after the scope switcher's Area select and this,
       and it is gone. The strip stays because it shows every ward's live mean at
       once, and it carries the same `data-w` it always did — so the race being
       tested here is unchanged. */
    await page.locator('#strip .ward[data-w="baruipur"]').click();
    await page.locator('#strip .ward[data-w="barrackpore"]').click();
    await expect(page.locator('#pname')).toHaveText('Barrackpore', { timeout: 20_000 });
    releaseBaruipur();
    await page.waitForTimeout(500);
    await expect(page.locator('#strip .ward.on')).toHaveAttribute('data-w', 'barrackpore');
  });
});
