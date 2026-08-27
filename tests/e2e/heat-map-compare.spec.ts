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

  /*
   * A LINK SHARED BEFORE THE SCOPE MIGRATION STILL NAMES THE SAME TWO WARDS.
   *
   * Compare reads `?a=`/`?b=` from the query string, and the state behind them is
   * now an area key (`in/kolkata/barrackpore`) rather than a bare slug. The reader
   * that was replaced FAILED SOFT — an unrecognised id fell through to the default
   * pair — so the migration's plausible failure is not a crash or a 404 but a page
   * that settles perfectly and shows the WRONG COMPARISON under the bookmarked URL.
   * Nothing in the DOM would say so; the page even rewrites the address bar from
   * whatever it parsed.
   *
   * So this asserts the RENDERED WARD NAMES, which is the only thing a user can
   * check, and it does it with a NON-DEFAULT pair. Barrackpore-vs-Ballygunge
   * differs from the default on both sides; Ballygunge-vs-Baruipur — the obvious
   * choice — IS the default, and would pass against a legacy bridge that had been
   * deleted outright. That is measured, not supposed: the unit test for this
   * started on that pair and went green against exactly that mutant.
   */
  test('a legacy compare link renders the wards it names, in either spelling', async ({ page }) => {
    test.setTimeout(90_000);
    const missing: string[] = [];
    page.on('response', (response) => {
      if (response.status() === 404 && response.url().includes('/heat-map/data/')) {
        missing.push(new URL(response.url()).pathname);
      }
    });

    const namesAfterSettling = async (query: string) => {
      await page.goto(`/heat-map/compare/${query}`);
      await expect(page.locator('[data-role="status"]'))
        .toContainText('Comparison settled', { timeout: 45_000 });
      return {
        a: await page.locator('[data-value="a-name"]').first().textContent(),
        b: await page.locator('[data-value="b-name"]').first().textContent(),
      };
    };

    // The legacy spelling — the one in every already-shared link.
    const legacy = await namesAfterSettling('?a=barrackpore&b=ballygunge');
    expect(legacy).toEqual({ a: 'Barrackpore', b: 'Ballygunge' });

    // The same comparison addressed by full key must render identically.
    const keyed = await namesAfterSettling('?a=in/kolkata/barrackpore&b=in/kolkata/ballygunge');
    expect(keyed).toEqual(legacy);

    /* An unresolvable id falls back to the default rather than throwing — and the
       page must still SETTLE, not sit at "—" behind a swallowed error.

       This link exercises the collision path too: `a` falls back to Ballygunge,
       which is exactly what `b` asked for, so `b` is moved on to the next distinct
       area IN THE SAME CITY. Hence Baruipur rather than a repeated Ballygunge —
       a self-pairing would be refused by `assertPairedResult` and never settle. */
    const nonsense = await namesAfterSettling('?a=nonsense&b=ballygunge');
    expect(nonsense).toEqual({ a: 'Ballygunge', b: 'Baruipur' });

    expect(missing, `data artefacts 404'd: ${missing.join(', ')}`).toEqual([]);
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
