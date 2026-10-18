// tests/e2e/obos-v2-shell.spec.ts
import { expect, test } from '@playwright/test';
import { openV2, stubWeather } from './obos-v2-helpers';

test.describe('@v2 shell', () => {
  test.setTimeout(180_000);

  test('@v2 eight menu items; each section is reachable and publishes data-open-pane', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });   // desktop: labels by default (≥1366 px, spec §1.5)
    await openV2(page);
    await expect(page.locator('.rail .nav-label')).toHaveText(
      ['Overview', 'Heat', 'Air', 'Solar', 'Weather', 'Scenarios', 'Analysis · Compare', 'Data & methods', 'Collapse menu']);
    for (const [id, pane] of [['heat', 'heat'], ['air', 'air'], ['solar', 'solar'], ['weather', 'weather'], ['scenarios', 'scenarios'], ['methods', 'reports'], ['overview', 'map']]) {
      await page.locator(`.nav-item[data-section="${id}"]`).click();
      await expect(page.locator('main.obos-v2')).toHaveAttribute('data-section', id);
      await expect(page.locator('html')).toHaveAttribute('data-open-pane', pane);
      await expect(page.locator(`.nav-item[data-section="${id}"]`)).toHaveAttribute('aria-current', 'true');
    }
    await expect(page.locator('a.nav-item[data-rail="analysis"]')).toHaveAttribute('href', /\/heat-map\/compare\/\?/);
  });

  test('@v2 menu labels and side panel are independent: all four combinations', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page);
    const root = page.locator('main.obos-v2');
    const pin = page.locator('[data-menu-pin]');
    const overview = page.locator('.nav-item[data-section="overview"]');
    // Click the ICON, not the centre: in icons mode the rail is clip-path-clipped to 72 px (F10), so the centre of the 204 px item is
    // deliberately not hit-testable once the .45 s transition passes it; the icon (x 28) is visible and clickable in both modes.
    const ICON = { position: { x: 30, y: 22 } };
    for (const [menu, side] of [['labels', '1'], ['icons', '1'], ['icons', '0'], ['labels', '0']]) {
      if ((await root.getAttribute('data-menu')) !== menu) await pin.click(ICON);
      if ((await root.getAttribute('data-side-shown')) !== side) await overview.click(ICON);
      await expect(root).toHaveAttribute('data-menu-eff', menu);
      await expect(root).toHaveAttribute('data-side-shown', side);
      await expect(page.locator('aside.side-panel')).toBeVisible({ visible: side === '1' });
    }
  });

  test('@v2 menu and side preferences survive a reload, applied before paint', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page);
    await page.locator('[data-menu-pin]').click({ position: { x: 30, y: 22 } });
    await page.locator('.nav-item[data-section="overview"]').click({ position: { x: 30, y: 22 } });   // the icon: the item's centre is clipped away in icons mode (F10)
    const want = [await page.locator('main.obos-v2').getAttribute('data-menu'), await page.locator('main.obos-v2').getAttribute('data-side')];
    await page.reload();
    const first = await page.evaluate(() => { const r = document.querySelector('main.obos-v2'); return [r?.getAttribute('data-menu'), r?.getAttribute('data-side')]; });
    expect(first).toEqual(want);
  });

  test('@v2 theme and cards persist and apply pre-paint; theme is CSS-only', async ({ page }) => {
    await openV2(page);
    const root = page.locator('main.obos-v2');
    await expect(root).toHaveAttribute('data-theme', 'dark');            // D5
    let styleLoads = 0;
    page.on('request', (r) => { if (/style.*\.json|tiles.openfreemap/.test(r.url())) styleLoads++; });
    await page.locator('[data-pref="theme"][data-v="light"]').click();
    await expect(root).toHaveAttribute('data-theme', 'light');
    await page.locator('[data-pref="cards"][data-v="glass"]').click();
    await expect(root).toHaveAttribute('data-cards', 'glass');
    await page.reload();
    const first = await page.evaluate(() => { const r = document.querySelector('main.obos-v2'); return [r?.getAttribute('data-theme'), r?.getAttribute('data-cards')]; });
    expect(first).toEqual(['light', 'glass']);
    expect(styleLoads, 'flipping the theme alone must not reload the basemap').toBeLessThan(50);
  });

  test('@v2 D2 revised: an empty store is Plates; a chosen Glass persists but stays flat where Glass is refused (tier 0 here)', async ({ page }) => {
    await openV2(page);
    const root = page.locator('main.obos-v2');
    expect(await page.evaluate(() => localStorage.getItem('obos:v2:cards'))).toBeNull();
    await expect(root).toHaveAttribute('data-cards', 'plates');
    await page.locator('[data-pref="cards"][data-v="glass"]').click();
    await expect(root).toHaveAttribute('data-cards', 'glass');
    await expect(root, 'SwiftShader is tier 0: the choice is kept, the blur is refused').toHaveAttribute('data-glass', 'flat');
    await page.reload();
    const first = await page.evaluate(() => { const r = document.querySelector('main.obos-v2'); return [r?.getAttribute('data-cards'), r?.getAttribute('data-glass')]; });
    expect(first[0], 'applied before paint after a reload').toBe('glass');
    await expect(root).toHaveAttribute('data-glass', 'flat', { timeout: 30_000 });
    const blurred = await page.evaluate(() => [...document.querySelectorAll('main.obos-v2 *')].filter((e) => { const v = getComputedStyle(e).backdropFilter; return !!v && v !== 'none'; }).length);
    expect(blurred).toBe(0);
  });

  test('@v2 first visit pairs the map look with the theme until the look is chosen (D1)', async ({ page }) => {
    await openV2(page);
    await page.locator('[data-pref="theme"][data-v="light"]').click();
    await expect(page.locator('#envchip button[data-e="studio"]')).toHaveClass(/\bon\b/, { timeout: 20_000 });
    await page.locator('[data-pop-open="layers"]').click();
    await page.locator('#envchip button[data-e="dark"]').click();               // an explicit choice
    expect(await page.evaluate(() => localStorage.getItem('obos:v2:look-chosen'))).toBe('1');
    await page.keyboard.press('Escape');
    await page.locator('[data-pref="theme"][data-v="dark"]').click();
    await page.locator('[data-pref="theme"][data-v="light"]').click();
    await expect(page.locator('#envchip button[data-e="dark"]')).toHaveClass(/\bon\b/);  // independent now
  });

  test('@v2 title card follows an in-place ward switch; compass resets north', async ({ page }) => {
    await openV2(page, '/heat-map/in/kolkata/ballygunge/?lab=1');
    await expect(page.locator('.tc-area:not([hidden]) .tc-n')).toHaveText(/^\d/);
    const before = await page.locator('.tc-area:not([hidden]) .tc-n').textContent();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('obos:open-area', { detail: { key: 'in/kolkata/baruipur' } })));
    await expect(page.locator('#pname')).toContainText(/Baruipur/i, { timeout: 30_000 });
    await expect(page.locator('.tc-area:not([hidden]) .tc-n')).not.toHaveText(before ?? '');
    await page.evaluate(() => (window as unknown as { __obosMap?: { setBearing(b: number): void } }).__obosMap?.setBearing(90));
    await page.locator('#compass').click();
    await expect.poll(() => page.locator('#compassDial').getAttribute('transform'), { timeout: 5000 }).toMatch(/rotate\(-?0(\.0+)? 24 24\)/);
  });

  test('@v2 the Trees tab and the tree layer row are one control', async ({ page }) => {
    await openV2(page);
    const tab = page.locator('[data-v2-proxy="vegchip:v"]');
    await expect(page.locator('#vegw')).toBeVisible({ timeout: 30_000 });
    await expect(tab).toHaveAttribute('aria-pressed', 'true');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-pressed', 'false');
    await page.locator('[data-pop-open="layers"]').click();
    await expect(page.locator('input[data-layer="green/trees"]')).not.toBeChecked();
    await page.locator('input[data-layer="green/trees"]').check();
    await expect(tab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-layers-count]')).toHaveText(/^\d\/\d$/);
  });

  test('@v2 Layers popover: Esc closes only it and focus returns to its tab', async ({ page }) => {
    await openV2(page);
    const open = page.locator('[data-pop-open="layers"]');
    await open.click();
    await expect(page.locator('#v2Layers')).toBeVisible();
    await expect(page.locator('#v2Layers #modechip button[data-m="relief"]')).toBeVisible();
    /* S2 audit F3: "and stops there" must be tested, not assumed. A bubbling listener on window sees an Escape only if the shell's
       capture handler let it through; the app's own onPickKey (deselect, close brief, close street view) listens there too. */
    await page.evaluate(() => { const w = window as unknown as { __escLeaked: boolean }; w.__escLeaked = false; window.addEventListener('keydown', (e) => { if (e.key === 'Escape') w.__escLeaked = true; }); });
    const leaked = (): Promise<boolean> => page.evaluate(() => (window as unknown as { __escLeaked: boolean }).__escLeaked);
    await page.keyboard.press('Escape');
    await expect(page.locator('#v2Layers')).toBeHidden();
    await expect(open).toBeFocused();
    expect(await leaked(), 'the Esc that closed the popover must not reach the app').toBe(false);
    await page.keyboard.press('Escape');
    expect(await leaked(), 'with nothing open the app still gets its Esc').toBe(true);
  });

  test('@v2 a popover left behind by the keyboard closes without stealing focus (S2 audit F4)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page);
    await page.locator('[data-pop-open="key"]').click();
    await expect(page.locator('#v2Key')).toBeVisible();
    await page.locator('.nav-item[data-section="heat"]').focus();
    await expect(page.locator('#v2Key'), 'focus left the Key: it closes').toBeHidden();
    await expect(page.locator('.nav-item[data-section="heat"]'), 'and focus stays where the reader put it').toBeFocused();
    await expect(page.locator('[data-pop-open="key"]')).toHaveAttribute('aria-expanded', 'false');
  });

  test('@v2 the clock: 12/24 h persists; the age button re-reads exactly once', async ({ page }) => {
    await openV2(page);
    await expect(page.locator('#clockw')).toBeVisible({ timeout: 30_000 });
    /* the stack shows the meridiem pair OR the mode, never both (v1's rule) */
    await expect(page.locator('#clock24')).toBeHidden();
    await expect(page.locator('#clockAm')).toBeVisible();
    await page.locator('#clockFace').click();
    await expect(page.locator('#clockFace')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#clock24')).toBeVisible();
    await expect(page.locator('#clockAm')).toBeHidden();
    let reads = 0;
    page.on('request', (r) => { if (/\/api\/live\?/.test(r.url())) reads++; });
    await page.locator('#clockAge').click();
    await expect.poll(() => reads, { timeout: 10_000 }).toBe(1);
    await page.reload();
    await expect(page.locator('#clockFace')).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  });

  test('@v2 [H] credits: every licence is a real link; DataMeet credit present for Ward 68', async ({ page }) => {
    await openV2(page);
    await page.locator('[data-pop-open="credits"]').click();
    const pop = page.locator('#v2Credits');
    await expect(pop).toBeVisible();
    for (const t of ['OpenStreetMap', 'OpenFreeMap', 'Overture Maps Foundation', 'Google Open Buildings 2.5D', 'SRTM', 'Met Norway', 'Cloud deck drawn at 320 m, real base ~700 m']) {
      await expect(pop).toContainText(t);
    }
    const hrefs = await pop.locator('a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    for (const h of hrefs) expect(h).toMatch(/^https:\/\//);
    await expect(page.locator('#attrWard')).toContainText('DataMeet', { timeout: 30_000 });
    await expect(page.locator('#terrLab')).toHaveText(/indicative/);
    /* S2 audit F1: v1's MapLibre control carried the OpenMapTiles credit and the LINKED DataMeet licence; the v2 popover mirrors it */
    await expect(pop).toContainText('OpenMapTiles');
    await expect(pop.locator('a[href*="openmaptiles.org"]').first()).toBeVisible();
    await expect(pop.locator('[data-v2-map-attrib] a[href*="by-sa/2.5/in"]')).toHaveCount(1, { timeout: 30_000 });
    const chip = page.locator('.st-attrib .attrib');
    await expect(chip, 'the chip is always visible').toBeVisible();
    await expect(chip).toHaveText('© OpenStreetMap · OpenMapTiles · OpenFreeMap · Overture · Credits');
  });

  test('@v2 [H] credits follow v1 per area: no DataMeet where no DataMeet boundary is drawn; no map, only "Credits" (S2 audit F1, F11)', async ({ page }) => {
    await openV2(page, '/heat-map/in/kolkata/baruipur/');
    const chip = page.locator('.st-attrib .attrib');
    await expect(chip).toBeVisible();
    await expect(chip).not.toContainText('DataMeet');
    await expect(chip).toContainText('OpenMapTiles');
    await page.locator('[data-pop-open="credits"]').click();
    const pop = page.locator('#v2Credits');
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('OpenMapTiles');
    await expect(pop).not.toContainText('DataMeet');
    await expect(pop.locator('[data-v2-map-attrib] a[href*="by-sa"]')).toHaveCount(0);
    await expect(page.locator('li:has(> #attrWard)'), 'the empty ward row draws no stray divider').toBeHidden();
    await page.goto('/heat-map/ae/dubai/al-quoz/');
    await expect(page.locator('html')).toHaveAttribute('data-ui', 'v2');
    await expect(page.locator('.st-attrib .attrib'), 'no map, no source list; the chip stays').toHaveText('Credits');
    await expect(page.locator('.st-attrib .attrib')).toBeVisible();
  });

  test('@v2 no data (Al Quoz): no compass, no measured/modelled legend, no coordinate (S2 audit F8)', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await openV2(page, '/heat-map/ae/dubai/al-quoz/');
    /* A-S5 audit F8: the credit-card title body is empty here (no outline, coordinate, legend or compass) and the not-yet card already carries the name:
       the empty card is hidden (it stays in the tree: #pname/#pzone/#coord are bound ids) */
    await expect(page.locator('.tc')).toBeHidden();
    await expect(page.locator('.notyet h1')).toHaveText('Al Quoz');
    await expect(page.locator('#compass')).toHaveCount(0);
    await expect(page.locator('.tc-legend')).toHaveCount(0);
    await expect(page.locator('#coord'), 'the app binds #coord (the unit contract counts it), so it stays in the tree, hidden and empty').toBeHidden();
    await expect(page.locator('#coord')).toHaveText('');
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });

  test('@v2 compass: four ticks that turn with the dial and never touch N or S (S2 audit F6)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page, '/heat-map/in/kolkata/ballygunge/?lab=1');
    await expect(page.locator('#compassDial .compass-tick'), 'the approved design has four, and they are the dial\'s').toHaveCount(4);
    for (const b of [0, 90, 45, -90]) {
      await page.evaluate((bearing) => (window as unknown as { __obosMap: { jumpTo(o: { bearing: number }): void } }).__obosMap.jumpTo({ bearing }), b);
      await expect.poll(() => page.locator('#compassDial').getAttribute('transform')).toBe(`rotate(${-b} 24 24)`);
      const hits = await page.evaluate(() => {
        /* a text element's box includes the font's ascent and descent; the cap's ink is the middle ~70 % of it */
        const ink = (id: string): DOMRect => { const r = document.getElementById(id)!.getBoundingClientRect(); const cut = r.height * 0.15; return new DOMRect(r.x, r.y + cut, r.width, r.height - 2 * cut); };
        const hit = (a: DOMRect, b: DOMRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const letters = [ink('compassN'), ink('compassS')];
        return [...document.querySelectorAll('#compassDial .compass-tick')].map((t) => { const r = t.getBoundingClientRect(); return letters.some((l) => hit(r, l)); });
      });
      expect(hits, `bearing ${b}: a tick touches a letter`).toEqual([false, false, false, false]);
    }
  });

  test('@v2 toasts: the tip dismisses for the session; the key popover explains the marks', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.removeItem('delta:hm-tip'); } catch { /* none */ } });
    await openV2(page);
    await expect(page.locator('#tiphint')).toBeVisible();
    await page.locator('#tipX').click();
    await expect(page.locator('#tiphint')).toBeHidden();
    await page.reload();
    await expect(page.locator('#tiphint')).toBeHidden();
    await page.locator('[data-pop-open="key"]').click();
    await expect(page.locator('#v2Key')).toContainText('Red and orange belong to the heat ramp, and to India\'s AQI bands where an AQI band is shown.');
    const box = await page.locator('#tipX').boundingBox().catch(() => null);
    if (box) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
  });

  test('@v2 A1: the right column composes by section (#aqiBlock on Overview and Air only; #solBlock never)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });   // desktop: the rail is 220 px wide, so a centre click lands on it
    await openV2(page);
    /* a probe: the painter unhides #aqiBlock only when a payload lands; the rule under test is the CSS */
    await page.evaluate(() => { const a = document.getElementById('aqiBlock'); if (a) { a.hidden = false; a.textContent = 'probe'; } });
    for (const [s, shown] of [['overview', true], ['heat', false], ['air', true], ['solar', false], ['methods', false]] as const) {
      await page.locator(`.nav-item[data-section="${s}"]`).click();
      await expect(page.locator('#aqiBlock')).toBeVisible({ visible: shown });
    }
    await expect(page.locator('#solBlock')).toBeHidden();
  });

  test('@v2 at 1400 px with labels and the Explore panel, the toasts sit under the compass, clear of the right column (S2 audit F7)', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.removeItem('delta:hm-tip'); } catch { /* none */ } });
    await page.setViewportSize({ width: 1400, height: 900 });
    await openV2(page);
    const root = page.locator('main.obos-v2');
    await expect(root).toHaveAttribute('data-menu-eff', 'labels');
    await expect(root).toHaveAttribute('data-side-shown', '1');
    await expect(page.locator('#tiphint')).toBeVisible();
    const pill = await page.locator('#tiphint').boundingBox();
    const col = await page.locator('#legend').boundingBox();
    const compass = await page.locator('#compass').boundingBox();
    expect(pill && col && compass).toBeTruthy();
    expect(pill!.x + pill!.width, 'the pill ends before the right column starts').toBeLessThanOrEqual(col!.x);
    expect(pill!.y, 'and sits below the compass').toBeGreaterThanOrEqual(compass!.y + compass!.height);
  });
  /* ── S5.1: Explore the ward (plan S5.1; every control is the app's own and every result is the live map's) ── */
  test('@v2 Explore: the toolbox, phase and pathway are the app\'s controls and move the reading; Resilience says Coming soon, with no number', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    const pane = page.locator('[data-side-pane="explore"]');
    await expect(pane).toBeVisible();
    await expect(pane.locator('h2')).toHaveText('Explore the ward');
    /* the real ranges, from v1's pane */
    for (const [id, min, max, step] of [['ivTrees', '0', '50', null], ['ivRoof', '0', '100', '5'], ['ivFacades', '0', '15', null]] as const) {
      await expect(pane.locator(`#${id}`)).toBeVisible();
      await expect(pane.locator(`#${id}`)).toHaveAttribute('min', min);
      await expect(pane.locator(`#${id}`)).toHaveAttribute('max', max);
      if (step) await expect(pane.locator(`#${id}`)).toHaveAttribute('step', step);
    }
    /* Resilience: withdrawn; the words, no figure */
    await expect(pane.locator('.scorebox .soon')).toContainText('Coming soon');
    await expect(pane.locator('.scorebox-body')).toBeHidden();
    await expect(pane.locator('#scoreNum')).toBeHidden();
    /* sliders: the readouts follow and the reading moves (the app's scenario logic, not ours) */
    const before = await page.locator('#lst').textContent();
    /* A-S5 audit F2: a REAL drag, thumb to thumb, as a reader does it (mutation M2, pointer-events: none on the sliders, must fail); fill() stays for the other two */
    const tree = pane.locator('#ivTrees'), tb = (await tree.boundingBox())!;
    await page.mouse.move(tb.x + 9, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width - 9, tb.y + tb.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(pane.locator('#v1')).toHaveText('50');
    await pane.locator('#ivRoof').fill('100');
    await expect(pane.locator('#v2')).toHaveText('100%');
    await pane.locator('#ivFacades').fill('15');
    await expect(pane.locator('#v4')).toHaveText('15');
    await expect.poll(() => page.locator('#lst').textContent(), { timeout: 30_000 }).not.toBe(before);
    await expect(page.locator('[data-v2-mirror="lst"]')).toHaveText(/^\d+\.\d.?C$/);
    await expect(page.locator('.ov-hero')).toHaveAttribute('aria-hidden', 'true');                // a read-only mirror: the real readout is the temperature card
  });

  test('@v2 Explore: every phase and pathway button is a real click on a visible control', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    const phase = page.locator('[data-side-pane="explore"] #segPhase');
    await expect(phase.locator('button')).toHaveText(['Now', '13:00 Peak', '22:00 Retained', 'Heatwave']);
    for (const [p, label] of [['peak', 'modelled at 13:00'], ['night', 'modelled at 22:00'], ['heatwave', 'modelled at 13:00 · 1-in-100 heat'], ['now', 'modelled now']] as const) {
      await phase.locator(`button[data-p="${p}"]`).click();
      await expect(phase.locator(`button[data-p="${p}"]`)).toHaveClass(/\bon\b/);
      await expect(page.locator('#lstPhase')).toHaveText(label, { timeout: 30_000 });
      /* A-S5 audit F3: the hero follows the card (phase label, and the chip without its ±, which the card alone carries: F1) */
      await expect(page.locator('[data-v2-mirror="phase"]')).toHaveText(label);
      const conf = (await page.locator('#conf').innerText()).split(' · ').filter((x) => !x.includes('±')).join(' · ');
      await expect(page.locator('[data-v2-mirror="conf"]')).toHaveText(conf);
    }
    /* A-S5 audit F3 (mutation M3): the hero follows #conf and #lstPhase on THEIR OWN, not only when #lst changes with them in the same tick.
       The app writes these two ids; writing them here exercises the mirror's own observers. */
    await page.evaluate(() => { document.getElementById('conf')!.innerHTML = 'Calibrated · <b>±3.0 °C</b> · <b>n=50</b>'; });
    await expect(page.locator('[data-v2-mirror="conf"]')).toHaveText('Calibrated · n=50');
    await page.evaluate(() => { document.getElementById('lstPhase')!.textContent = 'modelled at 22:00'; });
    await expect(page.locator('[data-v2-mirror="phase"]')).toHaveText('modelled at 22:00');
    const path = page.locator('[data-side-pane="explore"] #segPath');
    await expect(path.locator('button')).toHaveCount(3);
    await phase.locator('button[data-p="night"]').click();
    await expect(page.locator('#conf')).toContainText('Calibrated', { timeout: 30_000 });
    const base = await page.locator('#lst').textContent();
    await path.locator('button').nth(2).click();
    await expect(path.locator('button').nth(2)).toHaveClass(/\bon\b/);
    await expect.poll(() => page.locator('#lst').textContent(), { timeout: 30_000 }).not.toBe(base);
  });

  test('@v2 Explore: the area switch from the side panel goes through the app\'s own switcher; the panel closes and the menu reopens it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page);
    await page.locator('#scope-area-trigger').click();
    await expect(page.locator('#scope-area-trigger')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#scope-area-list li[data-value="in/kolkata/barrackpore"]').click();
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-area', 'in/kolkata/barrackpore', { timeout: 30_000 });
    await expect(page.locator('#crumbArea')).toHaveText('Barrackpore');
    await expect(page.locator('select[data-scope="area"]')).toHaveValue('in/kolkata/barrackpore');
    /* close, then the menu brings it back */
    await page.locator('[data-side-pane="explore"] [data-side-close]').click();
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-side-shown', '0');
    await page.locator('.nav-item[data-section="overview"]').click({ position: { x: 30, y: 22 } });
    await expect(page.locator('main.obos-v2')).toHaveAttribute('data-side-shown', '1');
  });

  /* the S2 audit's gate addition: the Explore pane is never an empty slab, on any area, in either section it serves */
  for (const path of ['/heat-map/in/kolkata/ballygunge/', '/heat-map/in/bengaluru/mg-road/', '/heat-map/ae/dubai/al-quoz/']) {
    test(`@v2 Explore is never an empty slab: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openV2(page, path);
      for (const section of path.includes('/ae/') ? ['overview'] : ['overview', 'scenarios']) {       // Al Quoz: Scenarios is disabled (nothing ships)
        const item = page.locator(`.nav-item[data-section="${section}"]`);
        const pane = page.locator('[data-side-pane="explore"]');
        if (!(await pane.isVisible()) || (await item.getAttribute('aria-current')) !== 'true') await item.click({ position: { x: 30, y: 22 } });
        if (!(await pane.isVisible())) await item.click({ position: { x: 30, y: 22 } });
        await expect(pane).toBeVisible();
        const box = await pane.boundingBox();
        expect(box!.height, 'a panel with content is taller than its head').toBeGreaterThan(200);
        await expect(pane.locator('#scope-area-trigger')).toBeVisible();
        expect(await pane.locator('.sp-scroll').evaluate((e) => e.scrollHeight)).toBeGreaterThan(150);
        if (path.includes('/ae/')) await expect(pane).toContainText('There is nothing to intervene in here.');
        else await expect(pane.locator('#ivTrees')).toBeVisible();
      }
    });
  }
});
