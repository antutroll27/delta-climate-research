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
    await expect(rows).toHaveText(['Live basemap, real footprints & Google heights']);
    await expect(card.locator('.wc-heat'), 'F6 + rc1 R1: the modelled-heat and illustrative-block rows sit in the header, outside the fold').toHaveText(['Heat field · modelled', 'Block detail · illustrative']);
    await expect(card.locator('[data-v2-crumb]')).toContainText('India');
    /* a-01: the glyph is the SVG itself, switched by the hidden attribute (no wrapper span) */
    await expect(card.locator('[data-v2-crumb] .crumb-g svg.cg:not([hidden])')).toBeVisible();
    await expect(card.locator('[data-v2-crumb] .crumb-g svg.cg:not([hidden])')).toHaveAttribute('data-v2-for', 'in/kolkata/ballygunge');
    await expect(card.locator('[data-v2-crumb] .cgw'), 'no wrapper span: toggleAttribute is the only mechanism').toHaveCount(0);
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
    await expect(card.locator('[data-v2-crumb] .crumb-g svg.cg:not([hidden])')).toHaveAttribute('data-v2-for', 'in/kolkata/baruipur');
    await expect(page.locator('svg.tc-park:not([hidden])'), 'the title card outline followed too').toHaveAttribute('data-v2-for', 'in/kolkata/baruipur');
    expect(await page.evaluate(() => [...document.querySelectorAll('svg[data-v2-for]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('data-v2-for'))), 'both outlines, and only the open ward\'s, are drawn').toEqual(['in/kolkata/baruipur', 'in/kolkata/baruipur']);
    /* A-S4 audit F10: Baruipur has no ward polygon, so its glyph is the study square, drawn OUTLINED (not a measured boundary) */
    await expect(card.locator('[data-v2-crumb] .crumb-g svg.cg:not([hidden]) path')).toHaveAttribute('fill', 'none');
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

/* A-S4 audit F1: the map stack grows up from the dock; nothing may sit on it at any common laptop size, with the side panel shown or closed. */
/* A-S4 audit F3 + F9: the build-status stamp lives in the ward card's HEADER (so a folded card still says it), and the fold follows the viewport. */
test.describe('@v2 ward card on laptops', () => {
  test.setTimeout(180_000);
  for (const [w, h, open] of [[1280, 720, false], [1366, 768, false], [1366, 860, true], [1440, 900, true]] as const) {
    test(`@v2 at ${w} x ${h} the ward card starts ${open ? 'open' : 'folded'} and still says Under Construction`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openV2(page);
      const card = page.locator('#v2WardCard');
      await expect(card.locator('[data-v2-more]')).toHaveAttribute('aria-expanded', String(open));
      if (open) await expect(card.locator('.wc-body')).toBeVisible(); else await expect(card.locator('.wc-body')).toBeHidden();
      const stamp = card.locator('.con-stamp');
      await expect(stamp).toBeVisible();
      await expect(stamp).toHaveText('Under Construction');
      expect(await stamp.evaluate((e) => getComputedStyle(e).borderTopWidth), 'a stamp has a visible border, not grey body text').toBe('1px');
      expect(await stamp.evaluate((e) => !!e.closest('.wc-body')), 'the stamp is outside the fold').toBe(false);
      /* FINAL audit F6 (honesty): "Heat field · modelled" is never folded away, folded card or not; and on Heat the block-pattern note is on screen too */
      const heat = card.locator('.wc-heat');
      await expect(heat).toHaveText(['Heat field · modelled', 'Block detail · illustrative']);
      for (const row of await heat.all()) {
        await expect(row).toBeVisible();
        expect(await row.evaluate((e) => !!e.closest('.wc-body')), 'the modelled-heat and illustrative-block rows are outside the fold').toBe(false);
        /* rc1 R1 (honesty): on the FIRST screen, so a laptop reader sees both without scrolling */
        const rb = (await row.boundingBox())!;
        expect(rb.y + rb.height, 'the row is above the bottom edge of the window').toBeLessThanOrEqual(h);
      }
      const cardBox = (await card.boundingBox())!;
      for (const other of ['#compass', '#v2SunCard']) {
        const o = page.locator(other);
        if (!(await o.isVisible())) continue;
        const b = (await o.boundingBox())!;
        expect(cardBox.x + cardBox.width <= b.x || b.x + b.width <= cardBox.x || cardBox.y + cardBox.height <= b.y || b.y + b.height <= cardBox.y, `rc1 R1: the ward card does not overlap ${other}`).toBe(true);
      }
      await page.locator('.nav-item[data-section="heat"]').click({ position: { x: 30, y: 22 } });
      const note = page.locator('#patternNote');
      await expect(note).toContainText('illustrative', { timeout: 30_000 });
      await expect(note, 'the block-pattern note is visible on Heat').toBeVisible();
      expect(await note.evaluate((e) => { let n: Element | null = e; while (n) { if (n.matches('details:not([open]), [hidden], .wc-body')) return false; n = n.parentElement; } return true; }), 'and it is in no folded container (the right column scrolls; nothing folds it)').toBe(true);
    });
  }
});

test.describe('@v2 map stack: no collisions', () => {
  test.setTimeout(240_000);
  const SIZES: ReadonlyArray<readonly [number, number]> = [[1366, 768], [1366, 640], [1280, 720], [1440, 900]];
  for (const [w, h] of SIZES) {
    test(`@v2 nothing overlaps the Sun and Ward cards at ${w} x ${h}, side panel shown and closed`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await stubWeather(page, '2026-10-07T06:05:00Z');
      await openV2(page);
      for (const side of ['shown', 'closed'] as const) {
        const root = page.locator('main.obos-v2');
        if ((await root.getAttribute('data-side-shown')) === (side === 'shown' ? '0' : '1')) await page.locator('.nav-item[data-section="overview"]').click({ position: { x: 30, y: 22 } });
        await expect(root).toHaveAttribute('data-side-shown', side === 'shown' ? '1' : '0');
        await page.waitForTimeout(700);                                      // the title column's 0.45 s transition
        const boxes = async (sel: string): Promise<Array<{ n: string; x: number; y: number; w: number; h: number }>> => {
          const out: Array<{ n: string; x: number; y: number; w: number; h: number }> = [];
          for (const el of await page.locator(sel).all()) {
            if (!(await el.isVisible())) continue;
            const b = await el.boundingBox();
            if (b && b.width > 0 && b.height > 0) out.push({ n: sel, x: b.x, y: b.y, w: b.width, h: b.height });
          }
          return out;
        };
        const stack = [...await boxes('#v2SunCard'), ...await boxes('#v2WardCard')];
        const others = [...await boxes('#v2Title .tc'), ...await boxes('#compass'), ...await boxes('#v2Toasts > *'), ...await boxes('#v2Dock > *'), ...await boxes('#legend')];
        expect(stack.length, 'the Sun and Ward cards are both drawn').toBe(2);
        for (const a of stack) for (const b of others) {
          const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          expect(ix * iy, `${a.n} x ${b.n} at ${w}x${h}, side ${side}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(0);
        }
      }
    });
  }
});

test.describe('@v2 building card', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  /** the app selects a building from the roof list (a hidden parked pane until Track B's Solar screen); a row click is the same code path as a map click */
  const pick = async (page: import('@playwright/test').Page, row = 0) => {
    await expect(page.locator('#solList tr[data-idx]').nth(row)).toBeAttached({ timeout: 60_000 });
    await page.locator('#solList tr[data-idx]').nth(row).dispatchEvent('click');
  };

  test('@v2 [H] a roof row selects its building: the card is on the map (not in the column), surface row, rings in the fold, greenery, Esc closes and the column returns', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    await pick(page);
    const card = page.locator('#bcard');
    await expect(card).toBeVisible();
    /* brainstorm 04: the card stands on the map, a direct child of the root and outside the right column, and clear of every other piece of chrome (a flat map has no apex, so it docks at the right) */
    expect(await card.evaluate((e) => e.parentElement === document.querySelector('main.obos-v2') && !e.closest('#legend'))).toBe(true);
    await page.waitForTimeout(1500);
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    for (const hud of await page.locator('[data-hud]').all()) {
      if (!(await hud.isVisible())) continue;                              // (not written as a :visible selector: Tailwind turns that string into a site-wide junk class, F11)
      const h = await hud.boundingBox();
      if (!h || h.width === 0 || (await hud.getAttribute('id')) === 'v2Toasts') continue;
      expect(box.x < h.x + h.width && box.x + box.width > h.x && box.y < h.y + h.height && box.y + box.height > h.y, `the card sits on ${await hud.evaluate((e) => `${e.tagName}#${e.id}.${e.className}`)}`).toBe(false);
    }
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-readings', 'folded');   // the column folded away while a building is selected
    await expect(page.locator('[data-v2-card="temp"]')).toBeHidden();
    await expect(page.locator('#bcT')).not.toHaveText('—');
    await expect(page.locator('#bcT')).toBeVisible();
    await expect(page.locator('#bcSolKwp')).toBeVisible();
    await expect(page.locator('#bcSolLoss')).toBeVisible();
    const loss = await page.locator('#bcSolLoss').boundingBox(), floor = await page.locator('#bcSolFloor').boundingBox();
    expect(Math.abs(loss!.y - floor!.y), 'H13 (A-S4 F2): the strict-mask floor sits beside the SHADING loss it bounds').toBeLessThanOrEqual(8);
    /* the capacity headline carries its own floor in its small line, and is not the strict floor's neighbour */
    await expect(page.locator('#bcSolKwp small')).toContainText('floor');
    /* the building's notes are ONE fold (rc3 mutation MB1: text that exists but is hidden must fail): closed they are not drawn, open they are */
    await expect(page.locator('#bcRings')).toBeHidden();
    await page.locator('#bcFold summary').click();
    await expect(page.locator('#bcRings')).toContainText('how far you could walk from this building in 1 and 5 minutes');
    await expect(page.locator('#bcRings')).toBeVisible();                    // A-S4 audit F4: text that exists but is hidden must fail
    await expect(page.locator('#bcIns')).toBeVisible();
    await expect(page.locator('#bcIns')).not.toBeEmpty();
    /* the ring labels and the greenery tag are placed clear of every HUD box (the app's keep-out, spec E1/E2) */
    await page.waitForTimeout(1500);                                         // the entrance animation and the app's 250 ms HUD read settle
    for (const sel of ['#ringNear', '#ringFar', '#coolTag']) {
      const shown = await page.locator(sel).evaluate((e) => !(e as HTMLElement).hidden && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
      if (!shown) continue;                                                  // hidden when nowhere is clear: allowed
      const b = (await page.locator(sel).boundingBox())!;
      for (const hud of await page.locator('[data-hud]').all()) {
        if (!(await hud.isVisible())) continue;
        const h = await hud.boundingBox();
        if (!h || h.width === 0) continue;
        const overlap = b.x < h.x + h.width && b.x + b.width > h.x && b.y < h.y + h.height && b.y + b.height > h.y;
        const id = await hud.evaluate((e) => `${e.tagName}#${e.id}.${e.className}`);
        expect(overlap, `${sel} ${JSON.stringify(b)} sits on HUD ${id} ${JSON.stringify(h)}`).toBe(false);
      }
    }
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(page.locator('[data-v2-card="temp"]')).toBeVisible();      // the column is back
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

  test('@v2 [H] the shading loss and its strict floor stay together, whole, inside the card (which scrolls inside itself) at 1366 x 640', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 640 });
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    await pick(page);
    await expect(page.locator('#bcSolLoss')).toBeAttached();
    await page.locator('#bcSolLoss').scrollIntoViewIfNeeded();
    const card = (await page.locator('#bcard .bcard-in').boundingBox())!;
    expect(card.y + card.height, 'the card is inside the window').toBeLessThanOrEqual(640);
    for (const id of ['#bcSolLoss', '#bcSolFloor']) {
      const b = (await page.locator(id).boundingBox())!;
      expect(b.y, `${id} top inside the card`).toBeGreaterThanOrEqual(card.y - 1);
      expect(b.y + b.height, `${id} bottom inside the card`).toBeLessThanOrEqual(card.y + card.height + 1);
    }
    const loss = (await page.locator('#bcSolLoss').boundingBox())!, floor = (await page.locator('#bcSolFloor').boundingBox())!;
    expect(Math.abs(loss.y - floor.y)).toBeLessThanOrEqual(8);
  });

  test('@v2 [H] Light theme: the vs-ward-mean figure on the card is ink (AA), with the ramp as a mark only', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('obos:v2:theme', 'light'); } catch { /* none */ } });
    await openV2(page);
    await pick(page);
    await expect(page.locator('#bcard')).toBeVisible();
    await page.locator('#bcFold summary').click();   // the context line is in the card's fold
    const mark = page.locator('#bcIns :is(.hot, .cool)').first();
    await expect(mark).toBeVisible();
    const [markInk, idInk, underline] = await page.evaluate(() => {
      const m = document.querySelector('#bcIns :is(.hot, .cool)') as HTMLElement, id = document.getElementById('bcId') as HTMLElement;
      return [getComputedStyle(m).color, getComputedStyle(id).color, getComputedStyle(m).boxShadow];
    });
    expect(markInk, 'the figure takes the card\'s ink, not a ramp colour').toBe(idInk);
    expect(underline, 'and carries the ramp as an underline mark').not.toBe('none');
  });
});
