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

  test('an environment switch reloads the style rather than diffing it', async ({ page }) => {
    /* THE FLAG THIS GUARDS IS THE ONE THAT MAKES onStyleLoad RUN AT ALL.

       `setEnv` replaces the basemap with `map.setStyle(...)`. MapLibre's default is
       to DIFF the two styles and apply the result to the live Style object — and our
       two basemaps are diffable: identical `sprite`, identical `glyphs`, both drawn
       on `openmaptiles` + `ne2_shaded`. A successful diff never re-creates the Style,
       so `style.load` never re-fires and `onStyleLoad` never runs; what the diff DOES
       do is drop every source and layer present in the old style and absent from the
       new one, which is everything this app added.

       MEASURED ON THE SHIPPED BUILD, before `diff: false`: after switching Dark to
       Clay, `getSource`/`getLayer` answered false for the analytical field, the
       road-name labels, the relief scene AND the Mapillary coverage, and the probe
       inside onStyleLoad never fired a second time. The handler's own comment said
       it did.

       READ OFF THE NETWORK, because that is what distinguishes the two behaviours
       from outside the map. The `openmaptiles` source is a TileJSON at
       `tiles.openfreemap.org/planet` and it is the SAME url in both styles: an
       in-place diff leaves that source untouched and never re-fetches it, while a
       full reload rebuilds every source and asks for it again. So a non-zero count
       after the click IS the full reload, and it is not something a broken restore
       could fake.

       `page.route` rather than the `request` event, because a route runs before the
       HTTP cache and a second fetch of a cached TileJSON might otherwise never
       reach the network at all — the count would then measure the cache. */
    let styleFetches = 0;
    let planetFetches = 0;
    await page.route('**/tiles.openfreemap.org/styles/positron*', async (route) => {
      styleFetches += 1;
      await route.continue();
    });
    await page.route('**/tiles.openfreemap.org/planet*', async (route) => {
      planetFetches += 1;
      await route.continue();
    });

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await page.locator('#segPhase button[data-p="peak"]').click();
    const tile = page.locator('#big-ballygunge');
    await expect(tile).not.toContainText('—', { timeout: 20_000 });

    planetFetches = 0;
    await page.locator('#envchip button[data-e="studio"]').click();
    await expect.poll(() => styleFetches, {
      timeout: 20_000,
      message: 'the Clay studio button never caused the new style to be fetched, so '
        + 'no style swap happened and everything below would pass over a click that '
        + 'did nothing',
    }).toBeGreaterThan(0);
    await expect.poll(() => planetFetches, {
      timeout: 20_000,
      message: 'the basemap source was never re-fetched, so MapLibre DIFFED the two '
        + 'styles instead of reloading — which means style.load did not fire, '
        + 'onStyleLoad did not run, and every source this app added to the old style '
        + 'has been dropped with nothing to put it back. Restore `{ diff: false }` '
        + 'on setStyle',
    }).toBeGreaterThan(0);

    /* STILL COMPUTING, which is the part a broken restore takes away. The phase
       moves, so the open ward's tile must be recomputed and land on a different
       number — a page whose field source or renderer did not come back would sit on
       the value it had before the swap.

       WHAT THIS DOES NOT ASSERT is which sources came back: MapLibre keeps no handle
       on the page, and exposing one purely so a test could read it would be a
       production change made for a test. Completeness of the restoration list is
       asserted from source in tests/unit/heat-map-console-coherence.test.mjs. */
    const beforeNight = await tile.textContent();
    await page.locator('#segPhase button[data-p="night"]').click();
    await expect(tile, 'after the environment switch the instrument stopped '
      + 'recomputing — something onStyleLoad is meant to put back did not come back')
      .not.toHaveText(beforeNight ?? '', { timeout: 20_000 });

    /* And back, because a restore written for one direction is one that has been
       checked once. */
    await page.locator('#envchip button[data-e="dark"]').click();
    const beforeDay = await tile.textContent();
    await page.locator('#segPhase button[data-p="peak"]').click();
    await expect(tile).not.toHaveText(beforeDay ?? '', { timeout: 20_000 });

    expect(errors, 'the environment switch threw').toEqual([]);
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
