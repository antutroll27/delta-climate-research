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
  await expect(page.locator('#tabs .tab.on')).toHaveAttribute('data-w', 'baruipur');

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
  await page.locator('#tabs .tab[data-w="barrackpore"]').click();
  await expect(page.locator('#pname')).toHaveText('Barrackpore', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/heat-map\/in\/kolkata\/barrackpore\/$/);
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
  // its tabs are links, because nothing is running that could handle a button
  await expect(page.locator('#tabs a.tab')).toHaveCount(3);
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
