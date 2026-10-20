// tests/e2e/obos-v2-states.spec.ts — OBOS v2 spec §6 (states), plan S8.3 (S8).
/**
 * ERROR, EMPTY, LOADING AND STALE, as v1 shows them, on v2's screens. Where a state does not show, the fix is v2 CSS or a v2-only binder: never the app.
 * Air's own states (stale, not reporting, quiet for more than 7 days, too few hours) are pinned in obos-v2-air-weather; this file owns the rest.
 */
import { expect, test } from '@playwright/test';
import { openV2, stubWeather } from './obos-v2-helpers';

const BALLY = '/heat-map/in/kolkata/ballygunge/';
const go = (page: import('@playwright/test').Page, section: string) => page.locator(`.nav-item[data-section="${section}"]`).click({ position: { x: 30, y: 22 } });

test.describe('@v2 states', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@v2 error: an artefact that will not load is said in the ward card, and the flash repeats it once (spec §6)', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
    /* the ward's grid artefact: the same refusal heat-map-ward-switch.spec.ts injects for v1 (a 500 on the ward's own json) */
    await page.route('**/heat-map/data/ballygunge.json', (r) => r.fulfill({ status: 500, body: 'injected' }));
    await page.goto(BALLY);
    await expect(page.locator('main.obos-v2')).toHaveCount(1);
    const chip = page.locator('#loadchip');
    await expect(chip).toHaveClass(/\bfail\b/, { timeout: 60_000 });
    await expect(chip).toHaveClass(/\bon\b/);
    await expect(chip).toHaveText('Ballygunge could not load.');
    await expect(chip).toBeVisible();
    /* the flash: role=status, the same sentence, shown (opacity) and announced */
    const flash = page.locator('[data-v2-flash]');
    await expect(flash).toHaveAttribute('role', 'status');
    await expect(flash).toHaveText('Ballygunge could not load.');
    await expect(flash).toHaveAttribute('data-on', 'true');
    await expect(flash, 'shown, not just present (opacity, so the live region stays in the tree)').toHaveCSS('opacity', '1');
    expect(((await flash.textContent()) ?? '').trim(), 'the flash says what the card says').toBe(((await chip.textContent()) ?? '').trim());
  });

  test('@v2 error: provenance unavailable says so in the receipts panel (spec §6)', async ({ page }) => {
    await page.route(/\/heat-map\/data\/ballygunge-layers\.json/, (r) => r.fulfill({ status: 404, body: '' }));
    await openV2(page, BALLY);
    await go(page, 'methods');
    await page.locator('#srcBtn').click();
    await expect(page.locator('#srcPanel')).toBeVisible();
    await expect(page.locator('#srcPanel')).toContainText('Provenance manifest unavailable.');
    await expect(page.locator('#srcPanel h4')).toHaveText('Data receipts');
  });

  test('@v2 stale: an 8-hour-old reading greys the clock bar, says its age and turns the live dot off; the Air card says "could not be loaded" when the feed is down', async ({ page }) => {
    await stubWeather(page, '2026-10-07T14:30:00Z');          // the reading is valid for 06:09 UTC: 8 h 21 min old at the server's now
    await openV2(page);
    const clock = page.locator('#clockw');
    await expect(clock).toHaveAttribute('data-age', 'stale', { timeout: 60_000 });
    await expect(page.locator('#clockAgeLab')).toHaveText(/^read \d+h ago$/);
    await expect(page.locator('#livedot')).not.toHaveClass(/\bon\b/);
    expect(await page.locator('#clockBar').evaluate((e) => e.getAttribute('style'))).toMatch(/scaleX\(0(\.0+)?\)/);
    expect(await page.locator('#clockw .k-bar i').evaluate((e) => getComputedStyle(e).backgroundColor), 'the stale bar is greyed (ink-3), not the live ink')
      .not.toBe(await page.locator('#clockw .k-time').evaluate((e) => getComputedStyle(e).color));
    await expect(clock.locator('#clockAge')).toHaveAttribute('aria-label', /Live reading is \d+h old\. Activate to fetch current conditions\./);
    /* Air: the build has no /api/air-quality, which is the same refusal a quiet feed gives: v1's sentence, in the card AND the pane */
    await go(page, 'air');
    await expect(page.locator('#airPane')).toContainText('could not be loaded just now', { timeout: 30_000 });
    await expect(page.locator('#aqiBlock')).toContainText('could not be loaded just now');
    await expect(page.locator('#airStatus')).toContainText('could not be loaded just now');
  });

  test('@v2 empty: no artefacts says so (Open a validated area), the Air pane names the uncovered city, and the menu offers only what exists', async ({ page }) => {
    await openV2(page, '/heat-map/ae/dubai/al-quoz/');
    const card = page.locator('.notyet');
    await expect(card).toBeVisible();
    await expect(card.locator('a')).toHaveText('Open a validated area →');
    await expect(card.locator('a')).toHaveAttribute('href', /\/heat-map\/in\/kolkata\/ballygunge\/$/);
    /* FINAL audit F10: UNREACHABLE BY DESIGN (spec §4.10). Air is disabled on a no-data area (the loop below), so a reader never sees this note: it is in the DOM, and this asserts exactly that (attached),
       not visibility the page does not offer. The sentence is still checked, as markup. */
    await expect(page.locator('#airPane')).toBeAttached();
    await expect(page.locator('#airPane')).toContainText('Air quality covers Kolkata and Bengaluru; this city is not yet covered.');
    for (const s of ['heat', 'air', 'solar', 'weather', 'scenarios']) await expect(page.locator(`.nav-item[data-section="${s}"]`)).toBeDisabled();
    for (const s of ['overview', 'methods']) await expect(page.locator(`.nav-item[data-section="${s}"]`)).toBeEnabled();
    await expect(page.locator('#mlmap')).toHaveCount(0);
  });

  test('@v2 loading: the engine line and the em-dashes show until the instrument answers; the home page\'s hologram loader is not v2\'s to show', async ({ page }) => {
    await page.goto(BALLY, { waitUntil: 'commit' });
    await expect(page.locator('main.obos-v2')).toHaveCount(1);
    /* a first visit this session: the area page has no loader of its own (the hologram loader is the home page's); the instrument says it is selecting */
    await expect(page.locator('#site-loader')).toHaveCount(0);
    await expect(page.locator('#simBackend')).toHaveText(/SELECTING ENGINE|^[A-Za-z]/);
    await expect(page.locator('#simBackend')).not.toHaveText('SELECTING ENGINE', { timeout: 90_000 });
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
    /* the home page with the flag stored: the loader still runs once and clears, and the page is not an OBOS page (no data-ui) */
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('#site-loader')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('html')).not.toHaveAttribute('data-loader', 'show');
  });
});

test.describe('@v2 states without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('@v2 noscript: v2 is visible with the server defaults (Dark + Plates, side open); Compare keeps its sentence (flip plan B.2.3 (iv))', async ({ page }) => {
    await page.goto(BALLY);
    const root = page.locator('main.obos-v2');
    await expect(root).toHaveCount(1);
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(root).toHaveAttribute('data-cards', 'plates');
    await expect(root).toHaveAttribute('data-side', 'open');
    await expect(page.locator('main#main.stage:not(.obos-v2)')).toHaveCount(0);
    await expect(page.locator('#v2Side')).toBeVisible();
    await page.goto('/heat-map/compare/');
    await expect(page.locator('main.obos-v2[data-compare-root]')).toHaveCount(1);
    await expect(page.locator('.cmp-noscript')).toContainText('Compare results need JavaScript to run the model.');
    await expect(page.locator('.cmp-noscript a')).toHaveAttribute('href', '/heat-map/brief/');
  });

  /* flip audit F2: presence is not enough. On a phone the sentence sat inside the collapsed sheet and rendered 0 px tall. It must have a real box,
     lie wholly inside the first screen (no scrolling), and have nothing on top of its centre. */
  for (const [name, w, h] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    test(`@v2 noscript: Compare's sentence is VISIBLE on ${name} (${w}x${h}): a real box, inside the viewport, uncovered (flip audit F2)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/heat-map/compare/');
      const s = page.locator('.cmp-noscript');
      await expect(s).toContainText('Compare results need JavaScript to run the model.');
      await expect(s).toBeVisible();
      const box = await s.boundingBox();
      expect(box, 'the sentence has a box').not.toBeNull();
      expect(box!.height, 'non-zero height').toBeGreaterThan(0);
      expect(box!.width, 'non-zero width').toBeGreaterThan(0);
      expect(box!.x, 'inside the viewport, left').toBeGreaterThanOrEqual(0);
      expect(box!.y, 'inside the viewport, top').toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, 'inside the viewport, right').toBeLessThanOrEqual(w);
      expect(box!.y + box!.height, 'inside the viewport, bottom').toBeLessThanOrEqual(h);
      const covered = await s.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top && (e.contains(top) || top.contains(e)) ? null : `covered by ${top ? top.tagName.toLowerCase() + '.' + String(top.className) : 'nothing'}`;
      });
      expect(covered, 'nothing sits on top of the sentence').toBeNull();
      await expect(s.locator('a')).toBeVisible();
    });
  }
});

test.describe('@v2 states on a phone', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@v2 error: on a phone the refusal opens the sheet so the ward card says it (the card is folded away otherwise)', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); sessionStorage.setItem('obos:entry-note-seen', '1'); sessionStorage.setItem('obos:rotate-nudge-dismissed', '1'); } catch { /* none */ } });
    /* the ward's grid artefact: the same refusal heat-map-ward-switch.spec.ts injects for v1 (a 500 on the ward's own json) */
    await page.route('**/heat-map/data/ballygunge.json', (r) => r.fulfill({ status: 500, body: 'injected' }));
    await page.goto(BALLY);
    await expect(page.locator('#loadchip')).toHaveClass(/\bfail\b/, { timeout: 60_000 });
    await expect(page.locator('[data-v2-sheet-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#loadchip')).toBeVisible();
    await expect(page.locator('#loadchip')).toHaveText('Ballygunge could not load.');
  });
});
