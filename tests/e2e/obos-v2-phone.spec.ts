// tests/e2e/obos-v2-phone.spec.ts — OBOS v2 spec §3 (phone), §7.3–7.4, H13/H21, decision C11 (S8).
/**
 * THE PHONE, MEASURED. v1's three phone bugs (the sidebar display:none under 820 px, a landscape sheet showing only Location, a building card off the left
 * edge) are each pinned absent, and so are the S6 audit's C2 (the Solar side panel covered the ward card) and C3 (focus escaped the modal).
 * Three viewports: 390x844 and 360x740 portrait, 844x390 on its side. Every test is headless and runs under chromium-v2.
 */
import { expect, test, type Page } from '@playwright/test';
import { occludedBy, openV2, phoneIssues } from './obos-v2-helpers';

const SECTIONS = ['overview', 'heat', 'air', 'solar', 'weather', 'scenarios', 'methods'] as const;
const ROOT = 'main.obos-v2';
const menu = (page: Page) => page.locator('[data-v2-menu]');
/** The way a reader changes section on a phone: the menu button, then the section, and the drawer steps aside. */
async function section(page: Page, id: string): Promise<void> {
  await menu(page).click();
  await expect(page.locator('#v2Drawer')).toBeVisible();
  await page.locator(`#v2Drawer .nav-item[data-section="${id}"]`).click();
  await expect(page.locator(ROOT)).toHaveAttribute('data-section', id);
  await expect(page.locator('#v2Drawer')).toBeHidden();
}
const seenNote = (page: Page) => page.addInitScript(() => { try { sessionStorage.setItem('obos:entry-note-seen', '1'); sessionStorage.setItem('obos:rotate-nudge-dismissed', '1'); } catch { /* none */ } });

test.describe('@v2 phone 390x844', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@v2 [H] the entry note once per session, then the rotate nudge below the toolbar; no horizontal scroll (H21)', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
    await page.goto('/heat-map/in/kolkata/ballygunge/');
    await expect(page.locator(ROOT)).toHaveCount(1);
    const note = page.locator('#entryNote');
    await expect(note).toBeVisible({ timeout: 30_000 });
    await expect(note).toContainText('Best on a bigger screen');
    await expect(note).toContainText('This is a full console');
    await expect(note).toContainText('On a phone, turn it sideways for the full width.');
    /* a modal: the skip-link and the rest of the root are behind it (C3), from the moment the v2 shell has bound */
    await expect(page.locator(ROOT)).toHaveAttribute('data-v2-bound', '1', { timeout: 90_000 });
    await expect(page.locator('.skip-link')).toHaveAttribute('inert', '');
    await expect(page.locator('#v2Drawer')).toHaveAttribute('inert', '');
    await page.locator('[data-entry-close]').click();
    await expect(note).toBeHidden();
    expect(await page.locator('.skip-link').getAttribute('inert')).toBeNull();
    /* the rotate nudge: v1's words, a 44 px dismiss, and it overlaps nothing */
    const nudge = page.locator('#rotateNudge');
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText('Turn your phone for the full instrument');
    const x = await page.locator('[data-rn-dismiss]').boundingBox();
    expect(Math.min(x!.width, x!.height)).toBeGreaterThanOrEqual(44);
    expect(await phoneIssues(page)).toEqual([]);
    await page.locator('[data-rn-dismiss]').click();
    await expect(nudge).toBeHidden();
    await page.reload();
    await expect(page.locator('#entryNote')).toBeHidden();
    await expect(page.locator('#rotateNudge')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('@v2 the drawer is a real dialog: focus in, trapped, the page behind inert, Esc / scrim / × close, focus returns (spec §7.3)', async ({ page }) => {
    await seenNote(page);
    await openV2(page);
    const btn = menu(page), drawer = page.locator('#v2Drawer');
    await expect(btn).toHaveAttribute('aria-controls', 'v2Drawer');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(Math.min(...(await btn.evaluate((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; })))).toBeGreaterThanOrEqual(44);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('role', 'dialog');
    await expect(drawer).toHaveAttribute('aria-modal', 'true');
    const label = await drawer.getAttribute('aria-labelledby');
    await expect(page.locator(`#${label}`)).toHaveText('Sections and controls');
    expect(await page.evaluate(() => document.activeElement?.id), 'focus moves to the drawer heading').toBe('v2DrawerH');
    for (const id of ['overview', 'heat', 'air', 'solar', 'weather', 'scenarios', 'methods']) await expect(drawer.locator(`.nav-item[data-section="${id}"]`)).toBeVisible();
    await expect(drawer.locator('a.nav-item[data-rail="analysis"]')).toBeVisible();
    /* v1 bug #1 (the sidebar was display:none under 820 px): the Explore pane's Location selects are reachable here */
    await expect(drawer.locator('[data-side-pane="explore"] select[data-scope], [data-side-pane="explore"] .field-trigger').first()).toBeVisible();
    /* Tab is trapped, forward and back, and the skip-link (outside the root) is not reachable: it is inert */
    expect(await page.locator('.skip-link').getAttribute('inert')).not.toBeNull();
    for (let i = 0; i < 60; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('v2Drawer')!.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 60; i++) await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.getElementById('v2Drawer')!.contains(document.activeElement))).toBe(true);
    expect(await page.locator('#v2Sheet').getAttribute('inert')).not.toBeNull();
    expect(await page.locator('#v2Drawer .toolbar').count(), 'FINAL visual V2: the display toolbar is in the drawer on a phone').toBe(1);
    /* Esc closes it and returns focus to the button, and frees everything it held */
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(await page.locator('#v2Sheet').getAttribute('inert')).toBeNull();
    expect(await page.locator('.skip-link').getAttribute('inert')).toBeNull();
    /* the scrim closes it */
    await btn.click();
    await expect(drawer).toBeVisible();
    await page.locator('[data-v2-scrim]').click({ position: { x: 370, y: 300 } });
    await expect(drawer).toBeHidden();
    await expect(btn).toBeFocused();
    /* so does its own × */
    await btn.click();
    await page.locator('#v2Drawer .drawer-x').click();
    await expect(drawer).toBeHidden();
    await expect(btn).toBeFocused();
    /* a section chosen in it closes it and shows that section (and the sheet that holds its cards) */
    await section(page, 'air');
    await expect(page.locator('[data-v2-sheet-toggle]')).toHaveAttribute('aria-expanded', 'true');
  });

  test('@v2 [H] the sheet: a real button handle, closed once per session, 44 px; the credits chip is visible and tappable beside it; the readings are tied to their honesty text', async ({ page }) => {
    await seenNote(page);
    await openV2(page);
    const handle = page.locator('[data-v2-sheet-toggle]');
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await expect(handle).toHaveText('Show the readings');
    expect((await handle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    /* closed: the readings are out of the accessibility tree, the dock stays */
    await expect(page.locator('[data-v2-card="temp"]')).toBeHidden();
    await expect(page.locator('#v2Dock .bar')).toBeVisible();
    /* the credits chip: visible, on top (nothing covers it), 44 px, and it opens the sources with the DataMeet credit (S2 audit gate) */
    const chip = page.locator('.sheet-head .attrib');
    await expect(chip).toBeVisible();
    expect(await occludedBy(page, '.sheet-head .attrib')).toBeNull();
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await chip.click();
    await expect(page.locator('#v2Credits')).toBeVisible();
    await expect(page.locator('#wardScope')).toBeAttached();
    await expect(page.locator('#attrWard')).toContainText('DataMeet', { timeout: 30_000 });
    expect(await phoneIssues(page), 'with the credits open').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#v2Credits')).toBeHidden();
    await expect(chip).toBeFocused();
    /* opened: the temperature card, its ± chip and the Δ door are in it, uncovered, and ONE ± in the whole page (H1) */
    await handle.click();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await expect(handle).toHaveText('Hide the readings');
    const card = page.locator('[data-v2-card="temp"]');
    await expect(card).toBeVisible();
    for (const sel of ['#lst', '#conf', '[data-v2-card="temp"] details.disc summary']) expect(await occludedBy(page, sel), sel).toBeNull();
    const conf = (await page.locator('#conf').textContent()) ?? '';
    expect(await card.evaluate((e) => ((e as HTMLElement).innerText.match(/±/g) ?? []).length)).toBe((conf.match(/±/g) ?? []).length);
    expect(await page.evaluate(() => (document.body.innerText.match(/±/g) ?? []).length), 'one ± on the phone page too').toBe((conf.match(/±/g) ?? []).length);
    /* the figure and its chip share one card: the chip is below #lst, inside the same .card */
    expect(await page.evaluate(() => document.getElementById('lst')!.closest('.card') === document.getElementById('conf')!.closest('.card'))).toBe(true);
    expect(await phoneIssues(page)).toEqual([]);
    /* Esc folds an open sheet, once nothing more specific wanted the key */
    await handle.focus();
    await page.keyboard.press('Escape');
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await expect(handle).toBeFocused();
  });

  test('@v2 [H13] Solar on a phone (S6 audit C2): the headline and its strict-mask floor in one row, nothing on top of them; a roof from the drawer opens its card with the floor beside Shaded, on screen', async ({ page }) => {
    await seenNote(page);
    await openV2(page);
    await section(page, 'solar');
    for (const sel of ['#solPaneKwp', '#solPaneFloor']) {
      await expect(page.locator(sel)).toBeVisible();
      expect(await occludedBy(page, sel), `${sel} must not sit under another box`).toBeNull();
    }
    const [k, f] = await Promise.all([page.locator('#solPaneKwp').boundingBox(), page.locator('#solPaneFloor').boundingBox()]);
    /* B-S6 audit F3 (H13), measured on the phone: the floor's top within 8 px of the headline's bottom, and the confidence line below both */
    expect(f!.y - (k!.y + k!.height), 'the floor touches the headline').toBeLessThanOrEqual(8);
    expect(f!.y - (k!.y + k!.height), 'the floor is below the headline, not behind it').toBeGreaterThanOrEqual(-2);
    expect((await page.locator('#solPaneConf').boundingBox())!.y, 'nothing sits between the headline and its floor').toBeGreaterThan(f!.y);
    expect(await page.evaluate(() => document.getElementById('solPaneFloor')!.parentElement === document.getElementById('solPaneKwp')!.parentElement)).toBe(true);
    expect(await phoneIssues(page)).toEqual([]);
    /* the roof list is the drawer's: pick the first roof, as a reader does; the drawer steps aside, the sheet opens to the building card */
    await menu(page).click();
    const row = page.locator('#v2Drawer #solList tr[data-idx]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.locator('#v2Drawer')).toBeHidden();
    const bcard = page.locator('#bcard');
    await expect(bcard).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-v2-sheet-toggle]')).toHaveAttribute('aria-expanded', 'true');
    /* v1 bug #3 (the building card off the left edge): the card lies inside the screen, left edge included */
    const b = await bcard.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(390.5);
    for (const sel of ['#bcSolLoss', '#bcSolFloor']) { await expect(page.locator(sel)).toBeVisible(); expect(await occludedBy(page, sel), sel).toBeNull(); }
    const [l, fl] = await Promise.all([page.locator('#bcSolLoss').boundingBox(), page.locator('#bcSolFloor').boundingBox()]);
    expect(Math.abs(fl!.y - l!.y), 'the strict floor sits beside the Shaded figure').toBeLessThanOrEqual(8);
    expect(await phoneIssues(page)).toEqual([]);
    /* Esc closes the card and nothing else: the same press does not also fold the sheet */
    await page.keyboard.press('Escape');
    await expect(bcard).toBeHidden();
    await expect(page.locator('[data-v2-sheet-toggle]')).toHaveAttribute('aria-expanded', 'true');
  });

  test('@v2 [H] the payback sheet is a modal on a phone: focus cannot leave it, Esc closes it and nothing else (S6 audit C3)', async ({ page }) => {
    await seenNote(page);
    await openV2(page);
    await section(page, 'solar');
    /* the app shows #bcPay only where a payback can be computed: take the first of five roofs that offers it (the roof list is the drawer's; the row path is deterministic) */
    let shown = false;
    for (let i = 0; i < 5 && !shown; i++) {
      await page.locator('#solList tr[data-idx]').nth(i).dispatchEvent('click');
      await expect(page.locator('#bcard')).toBeVisible({ timeout: 30_000 });
      shown = await page.locator('#bcPay').isVisible();
    }
    expect(shown, 'none of the first five roofs offers a payback').toBe(true);
    await page.locator('#bcPay').click();
    await expect(page.locator('#solPay')).toBeVisible();
    expect(await page.locator('.skip-link').getAttribute('inert'), 'the Base skip-link is outside the stage: it must be behind the modal too').not.toBeNull();
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('solPay')!.contains(document.activeElement)), 'Tab stays in the sheet').toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#solPay')).toBeHidden();
    await expect(page.locator('#bcard'), 'Esc closed the sheet only').toBeVisible();
    expect(await page.locator('.skip-link').getAttribute('inert')).toBeNull();
  });

  test('@v2 in-place ward switch from the dock chips; the title card, the sheet and the page stay whole', async ({ page }) => {
    await seenNote(page);
    await openV2(page);
    await page.locator('#strip .ward[data-w]').nth(1).click();
    await expect(page.locator('#crumbArea')).not.toHaveText('Ballygunge', { timeout: 60_000 });
    await expect(page.locator('#pname')).not.toContainText('Ballygunge');
    expect(await phoneIssues(page)).toEqual([]);
  });

  test('@v2 no artefacts (Al Quoz): one centred card, "Open a validated area", the menu reachable, no sheet; nothing overlaps', async ({ page }) => {
    await seenNote(page);
    await openV2(page, '/heat-map/ae/dubai/al-quoz/');
    const card = page.locator('.notyet');
    await expect(card).toBeVisible();
    await expect(card.locator('a')).toHaveText('Open a validated area →');
    await expect(page.locator('#v2Sheet')).toHaveCount(0);
    const b = await card.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(390.5);
    await expect(page.locator('.st-attrib .attrib')).toBeVisible();
    expect(await occludedBy(page, '.st-attrib .attrib')).toBeNull();
    expect(await phoneIssues(page)).toEqual([]);
    await menu(page).click();
    await expect(page.locator('#v2Drawer [data-side-pane="explore"]'), 'the Location selects are the way off this page').toBeVisible();
    await expect(page.locator('#v2Drawer [data-side-pane="explore"] .field-trigger').first()).toBeVisible();
    await expect(page.locator('#v2Drawer .nav-item[data-section="overview"]')).toBeEnabled();
    await expect(page.locator('#v2Drawer .nav-item[data-section="heat"]')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#v2Drawer')).toBeHidden();
  });

  test('@v2 Compare and the paired brief on a phone: the rail is the drawer, the caveats are on the page, nothing scrolls sideways', async ({ page }) => {
    await seenNote(page);
    await page.goto('/heat-map/compare/');
    await expect(page.locator(ROOT)).toHaveCount(1);
    await expect(page.locator('[data-role="status"]')).not.toHaveText('Preparing the paired model.', { timeout: 90_000 });
    /* C audit F5: the method paragraph, "not a ward ranking" and "one city" are readable without opening the sheet */
    const note = page.locator('.cmp-phone-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('They are not a ward ranking.');
    await expect(note).toContainText('Both sides come from one city.');
    await expect(note).toContainText('Ballygunge is KMC Ward 68');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await phoneIssues(page)).toEqual([]);
    await menu(page).click();
    await expect(page.locator('#v2Drawer .nav-item[aria-current="page"]')).toBeVisible();
    await expect(page.locator('#v2Drawer .toolbar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeFocused();
    /* the brief: a document; the menu is still one tap away; no credits chip (v1's brief has none either) */
    await page.goto('/heat-map/brief/');
    await expect(page.locator('main.obos-v2[data-brief-root]')).toHaveCount(1);
    await expect(page.locator('.attrib, #v2Credits'), 'the brief carries no credits popover, as v1\'s has none (S8 decision; the boundary credit line is printed in the sheet)').toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await phoneIssues(page)).toEqual([]);
    await menu(page).click();
    await expect(page.locator('#v2Drawer')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  /* FINAL visual V2 (the twin's phone pattern, the approved preview's ?device=phone): the title card, the display toggles and the compass took about a quarter of the screen. The title is
     a slim card, the Light/Dark and Glass/Plates toggles and the Key live in the drawer, the compass is small; the map gets the screen. */
  test('@v2 [V2] phone top: a slim title card and a small compass; the toggles and the Key are in the drawer; the map keeps most of the screen', async ({ page }) => {
    await seenNote(page);
    await openV2(page);
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const tc = await box('.st-title .tc'), compass = await box('#compass'), menuB = await box('[data-v2-menu]');
    expect(tc.height, 'the title card is slim').toBeLessThanOrEqual(92);
    expect(Math.max(compass.width, compass.height), 'the compass is small').toBeLessThanOrEqual(40);
    expect(Math.min(compass.width, compass.height), 'and still a 24 px target').toBeGreaterThanOrEqual(24);
    const chromeBottom = Math.max(tc.y + tc.height, compass.y + compass.height, menuB.y + menuB.height);
    expect(chromeBottom, 'the top chrome ends within the first 13% of the screen').toBeLessThanOrEqual(844 * 0.13);
    /* the card still names the ward, the city and the figure */
    await expect(page.locator('#pname')).toContainText('Ballygunge');
    await expect(page.locator('.st-title .tc-area:not([hidden])')).toContainText('ha');
    await expect(page.locator('#coord')).toBeVisible();
    /* the toggles are not on the map; they are in the drawer, and they work from there */
    await expect(page.locator('main.obos-v2 > .toolbar')).toHaveCount(0);
    await expect(page.locator('#v2Drawer .toolbar')).toBeHidden();
    await menu(page).click();
    await expect(page.locator('#v2Drawer .toolbar')).toBeVisible();
    await page.locator('#v2Drawer .toolbar [data-pref="theme"][data-v="light"]').click();
    await expect(page.locator(ROOT)).toHaveAttribute('data-theme', 'light');
    await page.locator('#v2Drawer .toolbar [data-pref="theme"][data-v="dark"]').click();
    await expect(page.locator(ROOT)).toHaveAttribute('data-theme', 'dark');
    await page.locator('#v2Drawer .key-btn').click();
    await expect(page.locator('#v2Key')).toBeVisible();
    expect(await page.locator('#v2Key').evaluate((e) => e.closest('[inert]') === null)).toBe(true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('#v2Drawer')).toBeHidden();
    expect(await phoneIssues(page)).toEqual([]);
  });

  /* FINAL audit F2: the Key button rides the toolbar into the drawer on Compare and the brief, so the popover it opens must ride along (it was a root child, made inert by the drawer). */
  for (const route of ['/heat-map/compare/', '/heat-map/brief/']) {
    test(`@v2 [F2] ${route}: the Key popover opened from the drawer is usable (not inert), takes focus, and Esc closes it before the drawer`, async ({ page }) => {
      await seenNote(page);
      await page.goto(route);
      await expect(page.locator(ROOT)).toHaveCount(1);
      await menu(page).click();
      await expect(page.locator('#v2Drawer')).toBeVisible();
      await page.locator('#v2Drawer .key-btn').click();
      const key = page.locator('#v2Key');
      await expect(key).toBeVisible();
      expect(await key.evaluate((e) => e.closest('[inert]') === null), 'no inert ancestor').toBe(true);
      expect(await page.evaluate(() => document.getElementById('v2Key')!.contains(document.activeElement)), 'focus is inside the popover').toBe(true);
      /* it lies inside the drawer's box and the viewport */
      expect(await key.evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.height > 40; })).toBe(true);
      await page.keyboard.press('Escape');
      await expect(key).toBeHidden();
      await expect(page.locator('#v2Drawer')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#v2Drawer')).toBeHidden();
      await expect(menu(page)).toBeFocused();
      /* on the way back out of the phone band the popover is back at the root (every id once, no marker left over) */
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.locator('#v2Drawer')).toBeHidden();
      await expect.poll(() => page.evaluate(() => document.getElementById('v2Key')!.parentElement === document.querySelector('main.obos-v2'))).toBe(true);
    });
  }
});

for (const v of [{ n: '360x740', width: 360, height: 740 }, { n: '844x390 on its side', width: 844, height: 390 }, { n: '390x844', width: 390, height: 844 }]) {
  test.describe(`@v2 phone sweep ${v.n}`, () => {
    test.setTimeout(240_000);
    test.use({ viewport: { width: v.width, height: v.height }, isMobile: true, hasTouch: true });

    test(`@v2 [H] every screen at ${v.n}: no sideways scroll, nothing off screen or overlapping, targets 24 px, the figure beside its honesty text`, async ({ page }) => {
      await seenNote(page);
      await openV2(page);
      expect(await phoneIssues(page), 'the opening view').toEqual([]);
      /* the menu is reachable in every orientation (v1 bug #1) and its drawer is clean */
      await menu(page).click();
      expect(await phoneIssues(page), 'the drawer').toEqual([]);
      /* S2 audit: the Explore pane has content, and on a phone it is in the drawer, visible, at every size */
      await expect(page.locator('#v2Drawer [data-side-pane="explore"]')).toBeVisible();
      expect(await page.locator('#v2Drawer [data-side-pane="explore"]').evaluate((e) => e.querySelectorAll(':scope > *, :scope .sp-scroll > *').length)).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      for (const s of SECTIONS) {
        await section(page, s);
        expect(await phoneIssues(page), `${s}`).toEqual([]);
        /* v1 bug #2 (a landscape sheet that showed only Location): the section's own cards are in the sheet, at this size too */
        const visibleCards = await page.locator('#v2Sheet [data-v2-card]:visible, #v2Sheet #aqiBlock:visible').count();
        expect(visibleCards, `${s}: the sheet holds the section's cards`).toBeGreaterThan(0);
        if (s === 'overview') { for (const sel of ['#lst', '#conf']) { await expect(page.locator(sel)).toBeVisible(); expect(await occludedBy(page, sel), `${sel} on ${v.n}`).toBeNull(); } }
        if (s === 'solar') { for (const sel of ['#solPaneKwp', '#solPaneFloor']) { await expect(page.locator(sel)).toBeVisible(); expect(await occludedBy(page, sel), `${sel} on ${v.n}`).toBeNull(); } }
        if (s === 'heat') { await expect(page.locator('#patternNote')).toBeAttached(); }
        if (s === 'methods') { await expect(page.locator('[data-v2-card="how-sure"]')).toBeVisible(); }
      }
      /* layers popover and the key, the two other layers a reader opens on a phone */
      await page.locator('.tab[data-pop-open="layers"]').click();
      await expect(page.locator('#v2Layers')).toBeVisible();
      expect(await phoneIssues(page), 'layers popover').toEqual([]);
      await page.keyboard.press('Escape');
      /* the Key button is in the drawer with the display toolbar (FINAL visual V2) */
      await menu(page).click();
      await page.locator('#v2Drawer .key-btn').click();
      await expect(page.locator('#v2Key')).toBeVisible();
      expect(await phoneIssues(page), 'key popover').toEqual([]);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.locator('#v2Drawer')).toBeHidden();
    });

    /* the two off-map pages at the other two sizes (390x844 is pinned above): their phone layout answers the same query, so a phone on its side gets it too */
    if (v.width !== 390 || v.height !== 844) test(`@v2 Compare and the paired brief at ${v.n}: nothing scrolls sideways or overlaps, the caveats are on the page, the rail is the drawer`, async ({ page }) => {
      await seenNote(page);
      await page.goto('/heat-map/compare/');
      await expect(page.locator('[data-role="status"]')).not.toHaveText('Preparing the paired model.', { timeout: 90_000 });
      await expect(page.locator('.cmp-phone-note')).toBeVisible();
      await expect(page.locator('.cmp-phone-note')).toContainText('They are not a ward ranking.');
      expect(await phoneIssues(page), 'Compare').toEqual([]);
      await menu(page).click();
      await expect(page.locator('#v2Drawer nav.rail')).toBeVisible();
      expect(await phoneIssues(page), 'Compare with the drawer open').toEqual([]);
      await page.keyboard.press('Escape');
      await page.goto('/heat-map/brief/');
      await expect(page.locator('main.obos-v2[data-brief-root]')).toHaveCount(1);
      expect(await phoneIssues(page), 'the paired brief').toEqual([]);
    });
  });
}
