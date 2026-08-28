import { expect, test } from '@playwright/test';


/**
 * WCAG contrast between an element's text colour and the first ancestor that
 * actually paints a background.
 *
 * Module scope, and named, because two readings in one test must run the SAME
 * code: the open-pane state and the collapsed state are painted by different CSS
 * rules, and two copies of this arithmetic would be free to drift into agreeing
 * for the wrong reason.
 */
const contrastOf = (el: Element): number => {
    /* THE BROWSER DOES THE COLOUR CONVERSION, because we cannot. This palette is
       oklch and Chromium serialises a computed oklch colour AS oklch — so a
       regex pulling the first three numbers out of `getComputedStyle().color`
       reads 0.78, 0.105 and 202 as if they were sRGB bytes and reports a
       contrast of 1.01 for a perfectly readable cyan. That false negative was
       measured here before this comment was written. Painting the colour onto a
       canvas and reading the pixel back is the one conversion that is guaranteed
       correct for every colour space the page might be written in. */
    const ctx = document.createElement('canvas').getContext('2d')!;
    const toRgb = (c: string): [number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };
    const lum = (c: string) => {
      const [r, g, b] = toRgb(c).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // The nearest ancestor that actually paints — the rail itself, or the page.
    let ground: Element | null = el.parentElement;
    let bg = 'rgba(0, 0, 0, 0)';
    while (ground) {
      const c = getComputedStyle(ground).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
      ground = ground.parentElement;
    }
    const a = lum(getComputedStyle(el).color);
    const b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

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


  /*
   * THE CONSOLE ON THE COMPARE ROUTE.
   *
   * Every unit guard for this is a SOURCE tripwire — an .astro component cannot be
   * imported into `node --import tsx --test`. So the claims that are actually about
   * a rendered, styled, running page are made here, against the built output the
   * visitor gets.
   *
   * The legibility assertion is the one worth explaining. The rail paints in var(),
   * and its tokens are declared on `.stage` in HeatMapStage.astro — a stylesheet
   * this route never loads. Two of the names exist here with the OPPOSITE role, so
   * the active button rendered near-black on a rail whose background had silently
   * unset. Nothing errored, nothing looked wrong in either source, and no assertion
   * about a CSS rule EXISTING would have caught it: the rules were all there. The
   * only thing that catches it is measuring the pixels the browser computed.
   */
  test('the rail is the console, and the section you are on is legible', async ({ page }) => {
    /* REDUCED MOTION, AND IT IS LOAD-BEARING RATHER THAN POLITE. `.rail-btn` has
       `transition: color .18s`, and getComputedStyle DURING a transition returns
       the interpolated value — so reading the colour straight after the click that
       collapses the sidebar returns the colour it is coming FROM. That is how the
       collapsed assertion below first passed with its subject deleted: it was
       measuring cyan, 180ms before the near-black arrived. Reduced motion removes
       the transition outright (the rail honours it), which makes the reading
       deterministic instead of timing-dependent. The colours are identical in both
       modes; only the interpolation between them is not. */
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/heat-map/compare/');

    const rail = page.locator('nav.rail');
    await expect(rail).toHaveCount(1);          // counted: two rails is the shipped-twice defect
    await expect(page.locator('nav.rail .mark')).toHaveCount(1);

    /* ANALYSIS IS THE ROUTE AND ITS PANE IS OPEN — two facts, stated separately.
       Map is the way across and carries no aria-pressed at all, because the toolbox
       it names is not in this document. */
    const analysis = page.locator('[data-rail="analysis"]');
    await expect(analysis).toHaveAttribute('aria-current', 'page');
    await expect(analysis).toHaveAttribute('aria-pressed', 'true');
    await expect(analysis).toHaveJSProperty('tagName', 'BUTTON');
    const map = page.locator('[data-rail="map"]');
    await expect(map).toHaveAttribute('href', /\/heat-map\/in\/kolkata\//);
    expect(await map.getAttribute('aria-pressed')).toBeNull();

    /* THE PIXELS, NOT THE RULE. An undefined custom property makes the whole
       declaration invalid rather than falling back, so `background:var(--rail-ground)`
       left the rail transparent over a near-black page while the active button was
       painted in a --paper that means "near-black ground" on this route. Both ends
       were wrong and both were invisible to source. */
    const contrast = await analysis.evaluate(contrastOf);
    expect(contrast, 'the section marked as the current page must be readable '
      + 'against the rail it sits on').toBeGreaterThan(3);

    /* THE RAIL PAINTS ITS OWN GROUND. Readability alone cannot catch an
       unresolved --rail-ground: the declaration unsets, the rail goes
       transparent, and the near-black PAGE shows through — so the cyan text is
       still perfectly legible against it and every contrast check passes while
       the console's navigation column has visually ceased to exist. Measured:
       deleting --rail-ground left the contrast assertions green. */
    const railBg = await rail.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(railBg, 'the rail has no background of its own — --rail-ground did not '
      + 'resolve, so `background:var(--rail-ground)` is invalid at computed-value '
      + 'time and unsets entirely, and the rail becomes a transparent strip over '
      + 'the page').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

    /* AND AGAIN WITH THE SIDEBAR COLLAPSED, which is the state that actually
       exercises --paper. While a pane is open the button carries aria-pressed="true"
       as well, and that rule wins on source order and paints it --cyan — so the
       measurement above would pass with the --paper remap deleted. Collapsed, the
       button is only aria-current, `color:var(--paper)` is the single rule painting
       it, and an unremapped --paper is this route's near-black GROUND: the exact
       shipped defect, near-black on near-black. Measured, not reasoned — this
       assertion was watched to fail with the remap removed. */
    await analysis.click();
    await expect(page.locator('.sidebar')).toHaveClass(/is-collapsed/);
    await expect(analysis).toHaveAttribute('aria-pressed', 'false');
    const collapsedContrast = await analysis.evaluate(contrastOf);
    expect(collapsedContrast, 'with the sidebar collapsed the current section is '
      + 'painted only by its aria-current rule, and that colour must still be '
      + 'readable against the rail').toBeGreaterThan(3);
  });

  test('every rail section opens a body that says what it holds here', async ({ page }) => {
    await page.goto('/heat-map/compare/');
    await expect(page.locator('[data-pane="analysis"]')).toHaveClass(/is-on/);

    /* THE THREE THAT WOULD OTHERWISE BE DEAD. Each must open, each must say why it
       is empty on this route, and each must offer a way out. Before this task they
       were buttons with no handler and no body — the defect this project has
       deleted more often than any other, on the one control every visitor uses. */
    for (const id of ['layers', 'reports', 'scenarios']) {
      await page.locator(`[data-rail="${id}"]`).click();
      const pane = page.locator(`[data-pane="${id}"]`);
      await expect(pane).toHaveClass(/is-on/);
      await expect(pane.locator('.pane-note').first()).not.toBeEmpty();
      await expect(pane.locator('.pane-out')).toHaveAttribute('href', /\/heat-map\//);
      await expect(page.locator(`[data-rail="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    }

    // Clicking the OPEN pane collapses the sidebar — the VS Code behaviour.
    await page.locator('[data-rail="scenarios"]').click();
    await expect(page.locator('.sidebar')).toHaveClass(/is-collapsed/);

    await page.locator('[data-rail="analysis"]').click();
    await expect(page.locator('[data-pane="analysis"]')).toHaveClass(/is-on/);
    await expect(page.locator('.sidebar')).not.toHaveClass(/is-collapsed/);
  });

  test('the A/B pickers are the scope control, and they still drive the model', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/heat-map/compare/?a=barrackpore&b=ballygunge');
    await expect(page.locator('[data-role="status"]'))
      .toContainText('Comparison settled', { timeout: 45_000 });

    /* POPULATED, AND INSIDE THE PANE. paired-controller.ts fills both selects from
       `areaKeysInCity`, querying through [data-compare-root] — so a select moved
       outside that element is never found and never filled, and the page settles
       perfectly around two empty controls. Three options because Kolkata has three
       areas; the count is what proves they were built from the registry rather than
       left as the empty markup the server ships. */
    const a = page.locator('[data-pane="analysis"] [data-input="ward-a"]');
    const b = page.locator('[data-pane="analysis"] [data-input="ward-b"]');
    await expect(a.locator('option')).toHaveCount(3);
    await expect(b.locator('option')).toHaveCount(3);
    await expect(a).toHaveValue('in/kolkata/barrackpore');
    await expect(b).toHaveValue('in/kolkata/ballygunge');
    // The other side of the pair cannot be chosen on this one: no self-pairing.
    await expect(a.locator('option[value="in/kolkata/ballygunge"]'))
      .toHaveAttribute('disabled', '');

    // ...and changing one still re-runs the model.
    await a.selectOption('in/kolkata/baruipur');
    await expect(page.locator('[data-value="a-name"]').first())
      .toHaveText('Baruipur', { timeout: 45_000 });
    await expect(page.locator('[data-role="status"]'))
      .toContainText('Comparison settled', { timeout: 45_000 });
  });

  test('on a phone the bottom sheet clears the rail instead of sitting on it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/heat-map/compare/');

    const railBox = await page.locator('nav.rail').boundingBox();
    const sheetBox = await page.locator('.heat-compare__controls').boundingBox();
    if (!railBox || !sheetBox) throw new Error('rail or sheet had no box at 390px');
    expect(sheetBox.x, 'the bottom sheet overlaps the rail — the sheet is fixed at '
      + 'left:.6rem and the rail is a fixed column beside it, so it has to be offset '
      + 'past whatever --rail currently is')
      .toBeGreaterThanOrEqual(railBox.x + railBox.width);

    /* And the page's own content clears it too — the mobile padding shorthand
       reset the reserved column once already. */
    const h1 = await page.locator('main[data-compare-root] h1').boundingBox();
    if (!h1) throw new Error('h1 had no box');
    expect(h1.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
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
