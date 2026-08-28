import { expect, test } from '@playwright/test';

/**
 * ONE URL PER AREA — the contract Task 8 exists to create, checked in a browser.
 *
 * WHY THESE ASSERTIONS AND NOT A STATUS CODE. Every page here answers 200 whether
 * the scope reaches the client or not: the markup is prerendered, so an area page
 * that failed to pass its scope to the instrument would still serve a complete
 * document with a correct title and a correct coordinate, and Ballygunge's
 * buildings underneath. Every readout would agree with every other one and the page
 * would be wrong. So each test names the ward it expects to SEE, and the pair test
 * below opens two different areas and compares what they rendered.
 */

/** Two areas that are NOT the default, so a fallback cannot pass as a resolve. */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';
const BARUIPUR = '/heat-map/in/kolkata/baruipur/';

test('each area URL renders its OWN ward, not the default', async ({ page }) => {
  await page.goto(BARUIPUR);
  await expect(page.locator('#pname')).toHaveText('Baruipur');
  await expect(page.locator('#coord')).toHaveText('22.365° N · 88.432° E');
  await expect(page.locator('.stage')).toHaveAttribute('data-area', 'in/kolkata/baruipur');
  /* The ward strip, which is the page's only in-place area switcher since the
     header tab strip was deleted as the third control over one fact. */
  await expect(page.locator('#strip .ward.on')).toHaveAttribute('data-w', 'baruipur');
  /* And the scope switcher, which is the control that scales past one city: its
     Area select must be on the area the route named, not on the default. */
  await expect(page.locator('select[data-scope="area"]')).toHaveValue('in/kolkata/baruipur');

  /* The comparison, not the single reading. Baruipur alone proves nothing if the
     page were somehow serving one document for every route — these two must differ,
     and in the coordinate as well as the name, because the coordinate is the value
     that was hardcoded in the markup before the scope arrived. */
  const baruipurCoord = await page.locator('#coord').textContent();
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#pname')).toHaveText('Ballygunge');
  await expect(page.locator('#coord')).toHaveText('22.528° N · 88.366° E');
  expect(await page.locator('#coord').textContent()).not.toBe(baruipurCoord);
});

test('the instrument opens the area the route named, and no data 404s', async ({ page }) => {
  /* A 404 under /heat-map/data/ is the silent-degradation signature scope/paths.ts
     was written against: fourteen of the sixteen original call sites swallowed their
     own failure, so a wholly wrong area id renders an empty map that looks loaded.
     Watched here because a routing change is exactly what would reintroduce it. */
  const missing: string[] = [];
  page.on('response', (response) => {
    if (response.status() === 404 && response.url().includes('/heat-map/data/')) {
      missing.push(new URL(response.url()).pathname);
    }
  });
  await page.goto(BARUIPUR);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });
  // the ward the INSTRUMENT loaded, not the one the markup was rendered with
  await expect(page.locator('#report-link')).toHaveAttribute('href', '/api/wards/baruipur/metadata.json');
  expect(missing).toEqual([]);
});

test('switching ward moves the address bar with it', async ({ page }) => {
  /* Without this the URL goes on naming the ward the page was opened at while the
     instrument shows another, and copying it hands someone a different ward than the
     one on screen — the whole point of per-area URLs, undone by the tab that does
     not navigate. */
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });
  await page.locator('#strip .ward[data-w="barrackpore"]').click();
  await expect(page.locator('#pname')).toHaveText('Barrackpore', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/heat-map\/in\/kolkata\/barrackpore\/$/);
  /* The scope switcher has to follow too, or the console shows one ward and its
     own Area control names another — the same wrong-record failure one control
     over. It follows because heat-map-app.ts re-selects it on every ward change,
     which is the half a click on the strip would otherwise leave behind. */
  await expect(page.locator('select[data-scope="area"]')).toHaveValue('in/kolkata/barrackpore');
});

test('the Area select switches ward in place, and the strip follows', async ({ page }) => {
  /* THE OTHER DIRECTION. The strip and the select are two controls over one fact,
     which is exactly the arrangement that drifts: a select that switched the map
     without moving the strip's highlight would leave the page stating two
     different wards at once. Both directions are checked because either one alone
     would pass over a half-wired pair.
     IN PLACE, not a navigation: these two areas are in one city and both ship
     data, which is `tabKind`'s rule, so no page load happens and the URL is
     rewritten by `updateAddressBar`. */
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });
  await page.locator('select[data-scope="area"]').selectOption('in/kolkata/baruipur');
  await expect(page.locator('#pname')).toHaveText('Baruipur', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/heat-map\/in\/kolkata\/baruipur\/$/);
  await expect(page.locator('#strip .ward.on')).toHaveAttribute('data-w', 'baruipur');
});

test('no rail section is a link to the page it is already on', async ({ page }) => {
  /* The defect this closes, in both of its historical forms: the Explore tab
     carried aria-current="page" while its href pointed elsewhere (a lie to a
     screen reader), and the fix for that left a link to the page you were already
     standing on. The rail takes the href away from the current ROUTE, so the
     section renders as a <button> — and it does so whichever PANE is open, which
     is the half a single `active` prop could not express.
     Checked at BOTH pane states, because the whole point of the split is that
     opening a pane must not put the link back. */
  await page.goto(BALLYGUNGE);
  const map = page.locator('[data-rail="map"]');
  await expect(map).toHaveJSProperty('tagName', 'BUTTON');
  await expect(map).toHaveAttribute('aria-current', 'page');
  // Analysis goes somewhere else, so it stays a link.
  await expect(page.locator('[data-rail="analysis"]')).toHaveJSProperty('tagName', 'A');

  await page.locator('[data-rail="layers"]').click();
  await expect(page.locator('.pane[data-pane="layers"]')).toHaveClass(/is-on/);
  await expect(map).toHaveJSProperty('tagName', 'BUTTON');
  await expect(map).toHaveAttribute('aria-current', 'page');

  /* Clicking the OPEN pane collapses the sidebar; clicking another reopens it. */
  await page.locator('[data-rail="layers"]').click();
  await expect(page.locator('.sidebar')).toHaveClass(/is-collapsed/);
  await page.locator('[data-rail="map"]').click();
  await expect(page.locator('.sidebar')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('.pane[data-pane="map"]')).toHaveClass(/is-on/);
});

test('the console carries exactly one brand mark', async ({ page }) => {
  /* Two brands eight pixels apart, both linking to `/`, is what composing the rail
     with the old top bar produced. Counted in the built page rather than in either
     source, because that is the only place the two could ever have met. */
  await page.goto(BALLYGUNGE);
  await expect(page.locator('.stage a[href="/"]')).toHaveCount(1);
});

test('/heat-map still reaches the tool', async ({ page }) => {
  // It is a prerendered meta-refresh stub, not a server redirect — the build is
  // static. Landing on the tool is the contract; how it gets there is not.
  await page.goto('/heat-map');
  await expect(page).toHaveURL(/\/heat-map\/in\/kolkata\/ballygunge\/$/);
  await expect(page.locator('#pname')).toHaveText('Ballygunge');
});

test('an area with no data states its tier instead of half-rendering', async ({ page }) => {
  /* Dubai is registered so it can be NAMED — the gap between its tier and Kolkata's
     is the thing the twin is asking to be funded to close — and it ships no
     artefacts. The failure to guard against is not a 404: it is a page that mounts
     the instrument anyway and shows an empty map under a spinner, which at a glance
     is a city that has not finished loading. */
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/heat-map/data/')) requests.push(request.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const response = await page.goto('/heat-map/ae/dubai/al-quoz/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('.notyet-h')).toHaveText('Al Quoz');
  await expect(page.locator('.notyet-tier')).toContainText('geometry');
  // no map host means the page's boot script never imports the instrument
  await expect(page.locator('#mlmap')).toHaveCount(0);
  await expect(page.locator('#loadchip')).toHaveCount(0);
  /* and no readout left in its starting state. "SELECTING ENGINE" over a page where
     no engine will ever be selected does not read as "nothing ships here" — it reads
     as still loading, which is the one impression this page must not give. */
  await expect(page.locator('#simBackend')).toHaveCount(0);
  await expect(page.locator('#bcount')).toHaveCount(0);
  await expect(page.locator('.read')).toContainText('no artefacts · geometry tier');

  /* THE CONSOLE IS STILL AROUND THE STATEMENT, and every control in it tells the
     truth about this place. The header tab strip used to be checked here — its
     three siblings had to be <a> rather than <button>, because no instrument is
     mounted to handle a click. That strip is gone; the same claim is now made by
     the two controls that replaced it.

     THE AREA SELECT offers Dubai's three tiles and DISABLES every one of them, so
     the "not shipping" fact is announced rather than accepted-and-then-refused. */
  const areaOptions = page.locator('select[data-scope="area"] option');
  await expect(areaOptions).toHaveCount(3);
  await expect(page.locator('select[data-scope="area"] option:not([disabled])')).toHaveCount(0);

  /* THE LAYER TREE shows its rows rather than hiding them — an absent row reads as
     "this does not exist", which is a different and wronger claim than "we do not
     have it here yet" — and disables each one WITH A REASON. The five checked are
     the artefact-backed layers; street-level imagery is refused on the capability
     axis instead, which is a build fact rather than a fact about Dubai, so it is
     deliberately not asserted here. */
  for (const id of ['thermal/surface', 'green/canopy', 'green/trees',
    'built/footprints', 'built/heights']) {
    await expect(page.locator(`input[data-layer="${id}"]`)).toBeDisabled();
    await expect(page.locator(`input[data-layer="${id}"]`)).not.toBeChecked();
    await expect(page.locator(`.tree-row:has(input[data-layer="${id}"]) .tree-why`))
      .not.toBeEmpty();
  }

  /* NOTHING IN THE SIDEBAR RESPONDS TO A CLICK EXCEPT THE WAY OUT, and this was
     MEASURED rather than assumed. The sidebar renders on every area page, so
     composing the console moved the intervention toolbox and the ward-record link
     onto this one — three live sliders, a segmented control and a download whose
     route the build never emitted, all on the page whose entire content is a
     statement that nothing can be computed here. No instrument is mounted to hear
     any of it.
     The three scope selects are the exception and the point: they are how you
     leave. Everything else must be absent or disabled. */
  await expect(page.locator('.sidebar button')).toHaveCount(0);
  await expect(page.locator('.sidebar a')).toHaveCount(0);
  await expect(page.locator('.sidebar input:not(:disabled)')).toHaveCount(0);
  await expect(page.locator('.sidebar select:not([data-scope])')).toHaveCount(0);
  await expect(page.locator('.sidebar select[data-scope]')).toHaveCount(3);

  await page.waitForTimeout(1_500);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('the instrument mounts after a soft navigation from an un-instrumented area', async ({ page }) => {
  /* THE MOUNT-AFTER-SWAP PATH, which is where a boot area read from the DOM can go
     wrong in a way nothing else catches. The page script is shared by all six area
     routes, so arriving at Dubai loads it and it returns early — no `#mlmap`. The
     ClientRouter then swaps in Ballygunge WITHOUT re-executing that module, and the
     mount happens from the listener the Dubai visit registered. If `bootArea` were
     resolved at module load rather than per mount, this is the navigation that would
     open the wrong area — or throw, because Dubai has no ward row at all. */
  await page.goto('/heat-map/ae/dubai/creek/');
  await expect(page.locator('.notyet-h')).toHaveText('Dubai Creek');
  await page.locator('.notyet-links a').click();
  await expect(page).toHaveURL(/\/heat-map\/in\/kolkata\/ballygunge\/$/);
  await expect(page.locator('#pname')).toHaveText('Ballygunge');
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });
});
