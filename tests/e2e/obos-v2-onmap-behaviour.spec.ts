// tests/e2e/obos-v2-onmap-behaviour.spec.ts — OBOS v2 on-map building card (brainstorm 04, founder option C, 20 Oct): CONTENT, KEYS, the two rc3 bugs, the PHONE.
/**
 * The other half of the on-map card's e2e budget (placement and the column fold are in obos-v2-onmap-card.spec.ts; the solver is pinned in
 * tests/unit/obos-v2-place-card.test.mjs). Every test is headless; placement needs an apex, so the map is put in 3-D relief where it matters.
 */
import { expect, test, type Page } from '@playwright/test';
import { openV2, duplicateIds, stubWeather } from './obos-v2-helpers';
import { LAB, HUD, pick, relief, placed } from './obos-v2-onmap-helpers';

test.describe('@v2 on-map building card: content', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@v2 [H] H13: each floor sits beside its own headline; the solar block is always open; rings, greenery and sources fold into one disclosure', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page, LAB);
    await relief(page);
    await pick(page);
    await placed(page);
    for (const sel of ['#bcSolKwp', '#bcSolLoss', '#bcSolFloor', '#bcSolKwh', '#bcSolRaised', '#bcSolRs', '#bcSolTier', '#bcSolNote', '#bcSure summary', '#bcBrief']) await expect(page.locator(sel), sel).toBeVisible();
    /* the app repaints these cells on every stats tick (new nodes each time), so every box is read in ONE evaluate, never through a locator that may go stale between two reads */
    const g = await page.evaluate(`(() => { const q = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { kwp: q('#bcSolKwp'), kwpSmall: q('#bcSolKwp small'), loss: q('#bcSolLoss'), floor: q('#bcSolFloor'), text: document.querySelector('#bcSolKwp small').textContent }; })()`) as Record<'kwp' | 'kwpSmall' | 'loss' | 'floor', { x: number; y: number; width: number; height: number }> & { text: string };
    /* the capacity floor is printed with the capacity: inside Installable's own small line, a few px under it */
    expect(g.text).toMatch(/floor \d/);
    expect(g.kwpSmall.y).toBeGreaterThanOrEqual(g.kwp.y);
    expect(g.kwpSmall.y + g.kwpSmall.height).toBeLessThanOrEqual(g.kwp.y + g.kwp.height + 2);
    /* the strict shading floor sits beside Shaded, one row; the capacity headline is NOT in that row */
    expect(Math.abs(g.loss.y - g.floor.y), 'At least beside Shaded').toBeLessThanOrEqual(8);
    expect(g.floor.x).toBeGreaterThan(g.loss.x);
    expect(g.kwp.y + g.kwp.height, 'the capacity headline is above the shading row').toBeLessThanOrEqual(g.loss.y);
    await expect(page.locator('#bcSolFloor small')).toContainText('strict roof mask');
    /* the building's notes are one fold: closed, its text exists but is not drawn; open, the rings sentence and the greenery line are */
    const fold = page.locator('#bcFold');
    expect(await fold.evaluate((e) => (e as HTMLDetailsElement).open)).toBe(false);
    await expect(page.locator('#bcRings')).toBeHidden();
    await fold.locator('summary').click();
    await expect(page.locator('#bcRings')).toContainText('how far you could walk from this building in 1 and 5 minutes');
    await expect(page.locator('#bcRings')).toBeVisible();
    await expect(page.locator('#bcIns')).toContainText('Nearest greenery');
    await expect(page.locator('#bcSrc')).toBeVisible();
    /* the sheet's two doors, the tier chip and the ladder (closed) are all in the always-open block */
    await expect(page.locator('#bcPay')).toBeVisible();
    expect(await page.locator('#bcSure').evaluate((e) => (e as HTMLDetailsElement).open)).toBe(false);
    expect(await duplicateIds(page)).toEqual([]);
  });
});

test.describe('@v2 on-map building card: keyboard', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@v2 [H] a roof picked by keyboard: focus moves to the card\'s heading; Esc closes it and focus returns to the row; an open popover takes the first Esc', async ({ page }) => {
    await openV2(page, LAB);
    await relief(page);
    await page.locator('.nav-item[data-section="solar"]').click();
    const rows = page.locator('#solList tr[data-idx]');
    await expect(rows.first()).toBeAttached({ timeout: 60_000 });
    await rows.nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#bcard')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#bcard')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#bcHead'), 'the dialog\'s heading takes focus').toBeFocused();
    /* Esc closes the card and focus goes back to the row that opened it */
    await page.keyboard.press('Escape');
    await expect(page.locator('#bcard')).toBeHidden();
    await expect(page.locator('#solList tr[data-idx]').nth(1), 'focus is back on the row that opened the card').toBeFocused();
    /* one press, one thing: an open popover first, then the card */
    await page.keyboard.press('Enter');
    await expect(page.locator('#bcard')).toBeVisible({ timeout: 30_000 });
    await page.locator('.tab[data-pop-open="layers"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#v2Layers')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#v2Layers')).toBeHidden();
    await expect(page.locator('#bcard'), 'the popover took the press').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#bcard')).toBeHidden();
  });

  test('@v2 [H] a roof picked with the pointer on the map: Esc closes the card and focus lands on the map, not on <body>', async ({ page }) => {
    await openV2(page, LAB);
    await relief(page);
    await pick(page);
    await placed(page);
    await page.locator('#bcard #bcHead').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#bcard')).toBeHidden();
    const at = await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}.${a.className}` : 'none'; });
    expect(at, 'focus went somewhere real').not.toMatch(/^BODY/);
  });
});

test.describe('@v2 on-map building card: the two rc3 bugs', () => {
  test.setTimeout(240_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@v2 [H] bug 1: a roof picked from the Solar list is not centred behind the bottom-left stack (or any chrome)', async ({ page }) => {
    await openV2(page, LAB);
    await relief(page);
    for (const row of [0, 1, 2, 3]) {
      await pick(page, row);
      await placed(page);
      await page.waitForTimeout(1500);   // the 700 ms ease; the orbit is paused for 2.5 s after a row pick
      const bad = await page.evaluate(`(() => {
        const hud = (${HUD})(), s = document.getElementById('bsel').getBoundingClientRect(), out = [];
        for (const h of hud) if (s.left < h.r && s.right > h.l && s.top < h.b && s.bottom > h.t) out.push('brackets on ' + h.n + ' ' + JSON.stringify([Math.round(s.left), Math.round(s.top)]));
        if (s.left < 0 || s.top < 0 || s.right > innerWidth || s.bottom > innerHeight) out.push('brackets off-screen');
        return out;
      })()`);
      expect(bad, `row ${row}`).toEqual([]);
    }
  });

  test('@v2 [H] bug 2: the card\'s nearest-greenery figure equals the map tag\'s, for every roof in the list (including the two that read "0 m")', async ({ page }) => {
    await openV2(page, LAB);
    const n = await page.locator('#solList tr[data-idx]').count();
    expect(n).toBeGreaterThan(5);
    const seen: string[] = [];
    for (let i = 0; i < n; i++) {
      await pick(page, i);
      await expect(page.locator('#bcard')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(700);   // the tag's count-up lands in 380 ms
      const r = await page.evaluate(() => ({
        id: document.getElementById('bcId')!.textContent,
        card: /Nearest greenery ≈(\d+) m/.exec(document.getElementById('bcIns')!.textContent ?? '')?.[1] ?? null,
        tag: /≈(\d+) m/.exec(document.getElementById('coolTagM')!.textContent ?? '')?.[1] ?? null,
        tagShown: !document.getElementById('coolTag')!.hasAttribute('hidden'),
      }));
      if (r.card === null) { expect(r.tagShown, `${r.id}: no greenery on the card, none on the map`).toBe(false); continue; }
      expect(r.tag, `${r.id}: the tag says ${r.tag} m, the card ${r.card} m`).toBe(r.card);
      seen.push(`${r.id}=${r.card}`);
    }
    expect(seen.some((s) => s.endsWith('=0')), `a near roof (the rc3 case) is in the list: ${seen}`).toBe(true);
  });
});

test.describe('@v2 on-map building card: phone', () => {
  test.setTimeout(240_000);
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const seen = (page: Page) => page.addInitScript(() => { try { sessionStorage.setItem('obos:entry-note-seen', '1'); sessionStorage.setItem('obos:rotate-nudge-dismissed', '1'); } catch { /* none */ } });

  test('@v2 [H] a short summary peeks above the sheet and the roof stays visible; the sheet does not open itself; drag up or tap grows the same card; Esc folds it back, then closes', async ({ page }) => {
    await seen(page);
    await openV2(page, LAB);
    await relief(page);
    await pick(page);
    const card = page.locator('#bcard');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute('data-peek', '1');
    await page.waitForTimeout(1800);
    const sheet = (await page.locator('#v2Sheet').boundingBox())!, peek = (await card.boundingBox())!, sel = (await page.locator('#bsel').boundingBox())!;
    expect(peek.height, 'the peek is short').toBeLessThanOrEqual(220);
    expect(peek.y + peek.height, 'it sits above the sheet').toBeLessThanOrEqual(sheet.y + 1);
    expect(peek.x).toBeGreaterThanOrEqual(0);
    expect(peek.x + peek.width).toBeLessThanOrEqual(390.5);
    expect(sel.y + sel.height, 'the roof you tapped is above the peek').toBeLessThanOrEqual(peek.y);
    expect(sel.y, 'and below the title card').toBeGreaterThan(90);
    await expect(page.locator('[data-v2-sheet-toggle]'), 'no auto-open of the sheet').toHaveAttribute('aria-expanded', 'false');
    /* the peek has what a reader needs: the roof, the capacity with its floor, the shading with ITS floor; the long notes are not here */
    for (const s of ['#bcId', '#bcH', '#bcA', '#bcT', '#bcSolKwp', '#bcSolLoss', '#bcSolFloor']) await expect(page.locator(s), s).toBeVisible();
    for (const s of ['#bcSolKwh', '#bcSolRs', '#bcSolNote', '#bcFold', '#bcPay', '#bcBrief']) await expect(page.locator(s), s).toBeHidden();
    const [l, f] = await Promise.all([page.locator('#bcSolLoss').boundingBox(), page.locator('#bcSolFloor').boundingBox()]);
    expect(Math.abs(f!.y - l!.y), 'the strict floor is beside Shaded in the peek too').toBeLessThanOrEqual(8);
    /* tap: the same card grows (one #bcard, no clone) and its buttons are there */
    await page.locator('#bcExpand').click();
    await expect(card).toHaveAttribute('data-peek', '0');
    await expect(page.locator('#bcGrip')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#bcSolKwh')).toBeVisible();
    await expect(page.locator('#bcBrief')).toBeVisible();
    await expect(page.locator('#bcHead'), 'focus goes to the heading of the grown card').toBeFocused();
    expect(await duplicateIds(page)).toEqual([]);
    /* Esc folds the grown card back to the peek; the next closes it (the sheet's own order) */
    await page.keyboard.press('Escape');
    await expect(card).toHaveAttribute('data-peek', '1');
    await expect(card).toBeVisible();
    await expect(page.locator('#bcExpand')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    /* drag up on the grip grows it too */
    await pick(page, 1);
    await expect(card).toBeVisible({ timeout: 30_000 });
    const grip = (await page.locator('#bcGrip').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y - 90, { steps: 6 });
    await page.mouse.up();
    await expect(card).toHaveAttribute('data-peek', '0');
  });
  test('@v2 [H] F4: the grown phone card is a modal: aria-modal, everything behind it inert, Tab and Shift+Tab never leave it; the peek is not modal; Esc, Esc keep their order', async ({ page }) => {
    await seen(page);
    await openV2(page, LAB);
    await relief(page);
    await pick(page);
    const card = page.locator('#bcard');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card, 'the peek is not modal').not.toHaveAttribute('aria-modal', 'true');
    expect(await page.locator('#v2Sheet').evaluate((e) => (e as HTMLElement).inert), 'nor does it inert the page').toBe(false);
    await page.locator('#bcExpand').click();
    await expect(card).toHaveAttribute('data-peek', '0');
    await expect(card).toHaveAttribute('aria-modal', 'true');
    expect(await page.locator('#v2Sheet').evaluate((e) => (e as HTMLElement).inert), 'the sheet behind the grown card is inert').toBe(true);
    expect(await page.locator('.skip-link').getAttribute('inert'), 'so is the page furniture').not.toBeNull();
    const inside = (): Promise<boolean> => page.evaluate(() => document.getElementById('bcard')!.contains(document.activeElement));
    /* the card has ten-odd stops: two laps forwards and one back are 30 presses, and every one of them must land inside it */
    const stops: boolean[] = [];
    for (let i = 0; i < 24; i++) { await page.keyboard.press('Tab'); stops.push(await inside()); }
    for (let i = 0; i < 14; i++) { await page.keyboard.press('Shift+Tab'); stops.push(await inside()); }
    expect(stops.filter((x) => !x).length, `${stops.length} Tab and Shift+Tab presses; the ones that left the card: ${stops.map((x, i) => (x ? '' : i + 1)).filter(Boolean)}`).toBe(0);
    await page.keyboard.press('Escape');
    await expect(card).toHaveAttribute('data-peek', '1');
    await expect(card).not.toHaveAttribute('aria-modal', 'true');
    expect(await page.locator('#v2Sheet').evaluate((e) => (e as HTMLElement).inert)).toBe(false);
    expect(await page.locator('.skip-link').getAttribute('inert')).toBeNull();
    await expect(page.locator('#bcExpand')).toBeFocused();
    await page.locator('#bcExpand').click();
    await expect(card).toHaveAttribute('aria-modal', 'true');
    await page.locator('#bcX').click();
    await expect(card).toBeHidden();
    expect(await page.locator('#v2Sheet').evaluate((e) => (e as HTMLElement).inert), 'closing releases the page').toBe(false);
  });
});
