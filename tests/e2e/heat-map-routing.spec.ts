import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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

/**
 * PICK AN AREA THE WAY A READER DOES — open the dropdown, click a row.
 *
 * NOT `selectOption` ON THE <select>, and the difference matters more than it
 * looks. The select is still there and still holds the value, so `selectOption`
 * would still pass — while driving straight past the trigger, the list, the row
 * and the commit, which is now the entire control. A test that keeps working after
 * the thing it was testing was replaced is a test that has stopped testing it.
 *
 * The value assertions BELOW still read `select[data-scope]`, and that is the
 * other half of the same argument: the select is the SEAM — what console-shell.ts
 * reads and what heat-map-app.ts writes — so the control is driven where a hand
 * goes and asserted where the machinery looks.
 */
async function pickArea(page: Page, key: string): Promise<void> {
  const trigger = page.locator('#scope-area-trigger');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.locator(`#scope-area-list li[data-value="${key}"]`).click();
  /* The list closing is the control's own statement that it took the row. Waiting
     on it here keeps a failure to commit from being reported three assertions
     later as a map that did not move. */
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

test('each area URL renders its OWN ward, not the default', async ({ page }) => {
  await page.goto(BARUIPUR);
  await expect(page.locator('#pname')).toHaveText('Baruipur');
  await expect(page.locator('#coord')).toHaveText('22.365° N · 88.432° E');
  await expect(page.locator('.stage')).toHaveAttribute('data-area', 'in/kolkata/baruipur');
  /* The ward strip, which is the page's only in-place area switcher since the
     header tab strip was deleted as the third control over one fact. */
  await expect(page.locator('#strip .ward.on')).toHaveAttribute('data-w', 'baruipur');
  /* And the scope switcher, which is the control that scales past one city: its
     Area field must be on the area the route named, not on the default. BOTH
     halves of it — the <select> that holds the value and console-shell.ts reads,
     and the words the reader can actually see. Asserting only the first would pass
     over a trigger that had never been painted at all. */
  await expect(page.locator('select[data-scope="area"]')).toHaveValue('in/kolkata/baruipur');
  await expect(page.locator('#scope-area-trigger [data-select-value]')).toHaveText('Baruipur');

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
     which is the half a click on the strip would otherwise leave behind.
     THE VISIBLE HALF IS THE ONE THAT CAN GO STALE ON ITS OWN, and it is asserted
     for that reason: assigning `select.value` in script raises no event, so the
     words on the trigger only follow because `updateScopeSwitcher` says so. Take
     that line out and the value below still passes while the console reads
     "Ballygunge" over Barrackpore's map. */
  await expect(page.locator('select[data-scope="area"]')).toHaveValue('in/kolkata/barrackpore');
  await expect(page.locator('#scope-area-trigger [data-select-value]')).toHaveText('Barrackpore');
});

test('the Area dropdown switches ward in place, and the strip follows', async ({ page }) => {
  /* THE OTHER DIRECTION. The strip and the dropdown are two controls over one
     fact, which is exactly the arrangement that drifts: a dropdown that switched
     the map without moving the strip's highlight would leave the page stating two
     different wards at once. Both directions are checked because either one alone
     would pass over a half-wired pair.
     IN PLACE, not a navigation: these two areas are in one city and both ship
     data, which is `tabKind`'s rule, so no page load happens and the URL is
     rewritten by `updateAddressBar`. */
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });
  await pickArea(page, 'in/kolkata/baruipur');
  await expect(page.locator('#pname')).toHaveText('Baruipur', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/heat-map\/in\/kolkata\/baruipur\/$/);
  await expect(page.locator('#strip .ward.on')).toHaveAttribute('data-w', 'baruipur');
});

test('the area the page loaded with can be switched BACK to', async ({ page }) => {
  /* THE RETURN TRIP, which the test above does not make and which was broken for
     as long as the switcher has existed.

     `console-shell.ts` used to capture the page's area ONCE at mount, from
     `.stage[data-area]`, and refuse any selection equal to it as a no-op. An
     in-place switch remounts nothing, and nothing rewrote that attribute -- so the
     snapshot stayed on the boot area for the whole session and the reader could
     never come back to it. Measured over six hops: the boot area was refused every
     single time, every other area switched fine.

     IT FAILED SILENTLY, which is why a one-way test could not see it. The control
     took the new value, the map stayed where it was, and nothing threw or logged.
     The page simply named two different wards in two places.

     THE ASSERTION IS ON THE MAP, NOT THE CONTROL. `#pname` is painted by
     `loadWard`; the control's value moves the instant you click. Asserting the
     control here would pass against the bug -- it always showed the right answer.

     DRIVEN THROUGH THE DROPDOWN rather than through the <select> underneath it.
     `selectOption` would still work -- the select is still the model -- and that
     is exactly why it is not used: it would skip the trigger, the list, the row
     and the commit, so the return trip would be proved for a path no reader takes.

     Three hops, because the second one is what makes the first one's success
     meaningless: away, away again, then home. */
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });

  await pickArea(page, 'in/kolkata/baruipur');
  await expect(page.locator('#pname')).toHaveText('Baruipur', { timeout: 20_000 });

  await pickArea(page, 'in/kolkata/barrackpore');
  await expect(page.locator('#pname')).toHaveText('Barrackpore', { timeout: 20_000 });

  await pickArea(page, 'in/kolkata/ballygunge');
  await expect(page.locator('#pname')).toHaveText('Ballygunge', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/heat-map\/in\/kolkata\/ballygunge\/$/);
  await expect(page.locator('#strip .ward.on')).toHaveAttribute('data-w', 'ballygunge');

  /* AND THE SEAM ITSELF, because the three assertions above would all pass again if
     someone fixed the symptom by deleting the `value === here` guard while leaving
     the attribute stale -- and `hasData`, which decides in-place versus navigate,
     would still be read off the wrong area. */
  await expect(page.locator('.stage')).toHaveAttribute('data-area', 'in/kolkata/ballygunge');
});

test('the Area dropdown is drivable from the keyboard alone', async ({ page }) => {
  /* THE HALF THAT GETS LEFT FOR LATER. Replacing a native <select> hands you the
     look and takes away arrow keys, Home/End, type-ahead, Escape and the focus
     contract — all of which the platform was providing for free and none of which
     is visible in a screenshot. So they are asserted here, on the real page, with
     the map as the witness: a dropdown a keyboard cannot drive is a worse control
     than the OS one it replaced, however good it looks.

     NOT A SINGLE `click()` IN THIS TEST past the first Tab-free focus. Every step
     is a key. */
  /* A FULL BOOT, SIX KEY JOURNEYS AND A WARD LOAD in one test, on a page that puts
     a WebGL instrument up first. It runs in six seconds on an idle machine and
     four times that when the suite is competing with itself, which is inside the
     default 30s only by luck rather than by margin. Stated here rather than raised
     for the whole file, because this is the one test that does all three. */
  test.setTimeout(90_000);
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });

  const trigger = page.locator('#scope-area-trigger');
  const list = page.locator('#scope-area-list');
  await trigger.focus();

  /* CLOSED, ARROW DOWN OPENS AND COMMITS NOTHING. A native select would have
     moved its value on this press — and here a value change is a NAVIGATION, so
     the first press has to show the list rather than move the map. */
  await page.keyboard.press('ArrowDown');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveAttribute('aria-activedescendant', 'scope-area-list-o0');
  await expect(page.locator('select[data-scope="area"]')).toHaveValue('in/kolkata/ballygunge');
  await expect(page.locator('#pname')).toHaveText('Ballygunge');

  /* ESCAPE CLOSES AND CHANGES NOTHING, and focus is back where the reader left
     it. `aria-activedescendant` has to go with the list: left behind, it points at
     a row that no longer exists and a screen reader announces a phantom. */
  await page.keyboard.press('ArrowDown');
  await expect(trigger).toHaveAttribute('aria-activedescendant', 'scope-area-list-o1');
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).not.toHaveAttribute('aria-activedescendant', /./);
  await expect(page.locator('select[data-scope="area"]')).toHaveValue('in/kolkata/ballygunge');
  await expect(trigger).toBeFocused();

  /* HOME AND END REACH THE ENDS WITHOUT WALKING, which is the whole reason they
     exist and the first thing a hand-rolled listbox drops. */
  await page.keyboard.press('End');
  await expect(trigger).toHaveAttribute('aria-activedescendant', 'scope-area-list-o2');
  await page.keyboard.press('Home');
  await expect(trigger).toHaveAttribute('aria-activedescendant', 'scope-area-list-o0');

  /* TYPE-AHEAD, and the ward names are what make this worth asserting: Baruipur
     and Barrackpore share "bar", so nothing shorter than "barr" can tell them
     apart. A first-letter jump — which is all a lazy implementation does — cannot
     reach the second of two neighbours whatever you type. */
  /* RETRIED AS A UNIT, because the thing between the keystrokes is a wall clock.
     select-field.ts drops the type-ahead buffer after TYPEAHEAD_MS (600ms) of
     silence — the platform's own behaviour, and correct. But this page is running
     a WebGL heat simulation, and heat-map-app.ts measures a single advance at up
     to 900ms on a machine with no GPU. One advance landing between two keystrokes
     lapses the buffer: "bar" + a fresh "r" matches nothing, the active row stays
     where "bar" left it, and the assertion sees Baruipur.

     That is not a fault in the control and not something to widen a timeout over —
     it is the difference between a laptop and a CI runner, and it failed both
     retries on ubuntu-latest while passing every local run. Retrying the whole
     journey keeps the claim exactly as strong: typing "barr" must still land on
     Barrackpore, and Home still resets the row first so each attempt starts from
     the same place. The gap between attempts is itself longer than TYPEAHEAD_MS,
     so a retry always begins with an empty buffer. */
  await expect(async () => {
    await page.keyboard.press('Home');
    await page.keyboard.type('barr', { delay: 40 });
    await expect(list.locator('li.is-active .field-option-text'))
      .toHaveText('Barrackpore', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  /* AND ENTER COMMITS THE ACTIVE ROW — asserted on the MAP, because the value is
     the easy half. `#pname` is painted by `loadWard`, so it moves only if the
     commit reached console-shell.ts and the instrument answered. */
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#pname')).toHaveText('Barrackpore', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/heat-map\/in\/kolkata\/barrackpore\/$/);
  await expect(page.locator('select[data-scope="area"]')).toHaveValue('in/kolkata/barrackpore');
  await expect(page.locator('#scope-area-trigger [data-select-value]')).toHaveText('Barrackpore');
  /* FOCUS COMES BACK TO THE TRIGGER on the committing path too, not just the
     cancelling one. Dropped here, the next Tab would restart from the top of the
     document and the reader would have to walk the whole console again. */
  await expect(trigger).toBeFocused();
});

test('the OPEN dropdown has no automated WCAG A/AA violations, on either tier', async ({ page }) => {
  /* THE STATE NOTHING ELSE SCANS. A <select> came with its popup already correct;
     this one is a listbox we wrote, and every rule it has to satisfy — a named
     combobox, a named listbox, rows that are really options, an active descendant
     that resolves, text that clears AA against the panel it sits on — is now
     something a person typed and can therefore mistype.

     SCOPED TO `.scope`, DELIBERATELY. The page around it is a MapLibre canvas and
     an instrument, and scanning all of it would drown this control in findings it
     is not responsible for — the way to make an axe assertion meaningless is to
     point it at something too big to keep clean.

     BOTH TIERS, because they are structurally different pages: Kolkata's rows are
     choosable and Dubai's are every one of them aria-disabled with a reason
     attached, and it is the second that carries the markup nobody writes twice. */
  for (const [route, at] of [[BALLYGUNGE, 'in/kolkata/ballygunge'], ['/heat-map/ae/dubai/al-quoz/', 'ae/dubai/al-quoz']] as const) {
    await page.goto(route);
    /* The control is server-rendered but INERT until console-shell.ts mounts it,
       and an unopened list would take this scan past the whole point of it. */
    await expect(page.locator('select[data-scope="area"]')).toHaveValue(at);
    await page.locator('#scope-area-trigger').click();
    await expect(page.locator('#scope-area-trigger')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#scope-area-list li').first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('.scope')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
      `the open dropdown violates WCAG on ${route}`).toEqual([]);
  }
});

test('the ward strip never prints two scenarios side by side', async ({ page }) => {
  /* THE STRIP IS THE ONLY CONTROL THAT PUTS THE WARDS BESIDE EACH OTHER, and its
     tiles used to be written one at a time and never invalidated. `refreshStats`
     filled `big-{id}` for the OPEN ward; a slider, a phase or a pathway moved the
     scenario under all three and nothing cleared the ones it had just falsified.

     MEASURED, ON THE SHIPPED BUILD. Open Ballygunge at 13:00 with no trees (40.6),
     plant 50 trees (39.3), switch to Baruipur, take the trees back out, then flip
     to 22:00: the strip read `ballygunge 39.3 · baruipur 29.9` and the console
     asserted a 9.4 K gap between two wards whose honest like-for-like difference
     was 2.4 K. The label is `°C mean` — no hour and no intervention set — so
     nothing on the page said the two numbers came from different worlds.

     THE ASSERTION IS ON THE RENDERED TILE, NOT ON `state.lastMean`. The internal
     map going stale is the mechanism; the visible contradiction is the defect, and
     a test on the cache would pass over a fix that cleared it without repainting.

     AN EM-DASH IS THE HONEST STATE. It is what the stage renders before a ward has
     been solved, and it says "not computed under this scenario" — which is true.
     Recomputing all three instead would mean three solves on every slider drag.

     BOTH DOORS, AND THE SPARED TILE ALTERNATES. Act one moves a slider with
     Baruipur open; act two moves the phase with Ballygunge open. So neither the
     blanking nor the sparing can be passing by naming one ward. */
  test.slow();
  const bally = page.locator('#big-ballygunge');
  const baruipur = page.locator('#big-baruipur');

  await page.goto(BALLYGUNGE);
  /* AN EXPLICIT PHASE FIRST, because the default is "Now" and Now is the wall
     clock: run this suite after dark in Kolkata and the night button below selects
     the physics already running, the mean does not move, and the test would be
     asserting against a scenario change that did not happen. 13:00 Peak fixes the
     sun, so every comparison here is deterministic. */
  await page.locator('#segPhase button[data-p="peak"]').click();
  await expect(bally).not.toContainText('—', { timeout: 20_000 });
  /* The unvisited tile starts blank, which is also what proves the em-dash below
     is the state this page really renders and not a string invented by the test. */
  await expect(baruipur).toContainText('—');

  /* BOTH TILES UNDER ONE SCENARIO — the arrangement the strip exists for, and the
     one a fix must not destroy. Blanking on a WARD change would clear this. */
  await page.locator('#strip .ward[data-w="baruipur"]').click();
  await expect(page.locator('#pname')).toHaveText('Baruipur', { timeout: 20_000 });
  await expect(baruipur).not.toContainText('—', { timeout: 20_000 });
  await expect(bally).not.toContainText('—');
  const baruipurBare = await baruipur.textContent();

  /* ACT ONE — A SLIDER, the case that happens on every drag. */
  await page.locator('#ivTrees').fill('50');
  await expect(bally, 'a slider moved the scenario under Ballygunge\'s tile and it '
    + 'is still printing the mean from before the drag, beside a Baruipur value '
    + 'about to be recomputed with the trees in')
    .toContainText('—');
  /* The open ward is re-solved rather than blanked with the rest — a strip of three
     em-dashes would be honest and useless — and its number MOVES, which is what
     proves the scenario really changed and this test is not passing vacuously. */
  await expect(baruipur).not.toContainText('—', { timeout: 20_000 });
  await expect(baruipur,
    'planting 50 trees left Baruipur\'s mean exactly where it was, so the slider '
    + 'changed nothing and neither act below is exercising a scenario change')
    .not.toHaveText(baruipurBare ?? '');

  /* ACT TWO — THE PHASE, with the OTHER ward open, so the tile that gets spared
     and the tile that gets blanked swap places. */
  await page.locator('#strip .ward[data-w="ballygunge"]').click();
  await expect(page.locator('#pname')).toHaveText('Ballygunge', { timeout: 20_000 });
  await expect(bally).not.toContainText('—', { timeout: 20_000 });
  await expect(baruipur).not.toContainText('—');
  const ballyPeak = await bally.textContent();

  await page.locator('#segPhase button[data-p="night"]').click();
  await expect(baruipur, 'the strip is showing Baruipur\'s 13:00 mean beside '
    + 'Ballygunge\'s 22:00 one, under a single `°C mean` label — the console is '
    + 'asserting a difference between two wards it never computed together')
    .toContainText('—');
  await expect(bally).not.toContainText('—', { timeout: 20_000 });
  await expect(bally,
    'the 22:00 mean equals the 13:00 one, so the phase button moved nothing')
    .not.toHaveText(ballyPeak ?? '');
});

test('the breadcrumb follows the ward', async ({ page }) => {
  /* IT HAD NO WRITER AT ALL — `grep -rn crumb src/scripts/` found none. The crumb
     is rendered once by HeatMapStage.astro and an in-place switch reloads nothing,
     so after switching to Baruipur the top bar carried a bold "Ballygunge" about
     two hundred pixels from a `#pname` reading "Baruipur", with the URL agreeing
     with the second. Both are statements of where you are; only one was updated.

     THE STRIP, NOT THE SELECT, so this covers the other in-place door too. */
  await page.goto(BALLYGUNGE);
  await expect(page.locator('.crumb b')).toHaveText('Ballygunge');
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });

  await page.locator('#strip .ward[data-w="baruipur"]').click();
  await expect(page.locator('#pname')).toHaveText('Baruipur', { timeout: 20_000 });
  await expect(page.locator('.crumb b'),
    'the breadcrumb is still naming the ward the page was opened at, beside a '
    + 'readout and a URL that both name the one actually loaded')
    .toHaveText('Baruipur');
  /* The cells that CANNOT change stay put, which is what proves the writer moved
     the right one rather than repainting the whole crumb from somewhere. */
  await expect(page.locator('.crumb span')).toHaveText(['India', 'Kolkata']);
});

test('the document title, canonical and social tags follow the ward', async ({ page }) => {
  /* NOTHING IN src/ WROTE `document.title`. Meanwhile `updateAddressBar` rewrites
     the URL on every switch — so `replaceState` paired the NEW url with the OLD
     title, and a bookmark taken after a switch was filed under a ward that is not
     on screen. The canonical link, the one statement in this document addressed to
     a crawler rather than a reader, went on pointing at a different page than the
     one rendered.

     ASSERTED ON THE LIVE DOCUMENT, not on the built HTML: the whole defect is that
     the built HTML is right and stops being right the moment you switch. So the
     "before" is read first, from the same page, and every assertion below is that
     the value MOVED — a test that only checked the "after" would pass against a
     server render of Baruipur and never exercise the writer at all. */
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });

  const read = () => page.evaluate(() => ({
    title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    twitterTitle: document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ?? null,
  }));

  const before = await read();
  /* Every tag this test reads must EXIST on the page it loaded, or the assertions
     below would be comparing two nulls and passing for it. */
  for (const [name, value] of Object.entries(before)) {
    expect(value, `the page renders no ${name}, so this test would assert nothing `
      + 'about it — Base.astro has stopped emitting it, or the selector has moved')
      .not.toBeNull();
    /* Case-insensitive: the titles carry "Ballygunge" and the URLs carry the
       lowercase slug, and both are statements of the same area. */
    expect(value, `${name} does not name the ward the page was opened at, so it is `
      + 'not a projection of the area and does not belong in this test')
      .toMatch(/ballygunge/i);
  }

  await pickArea(page, 'in/kolkata/baruipur');
  await expect(page.locator('#pname')).toHaveText('Baruipur', { timeout: 20_000 });
  const after = await read();

  expect(after.title, 'the tab and any bookmark taken now are labelled with a ward '
    + 'that is not on screen — and `replaceState` has already moved the URL to the '
    + 'one that is, so the pair is internally inconsistent').toContain('Baruipur');
  expect(after.canonical, 'the canonical link points at a different page than the '
    + 'one rendered').toContain('/heat-map/in/kolkata/baruipur/');
  expect(after.ogUrl).toContain('/heat-map/in/kolkata/baruipur/');
  expect(after.ogTitle).toContain('Baruipur');
  expect(after.twitterTitle).toContain('Baruipur');
  expect(after.description).toContain('Baruipur');

  /* AND NONE OF THEM STILL NAMES THE OLD WARD, which a `toContain` on the new name
     alone would not catch: a writer that appended rather than replaced would
     satisfy every assertion above. */
  for (const [name, value] of Object.entries(after)) {
    expect(value, `${name} still mentions Ballygunge`).not.toMatch(/ballygunge/i);
  }

  /* THE ORIGIN THE SERVER RENDERED IS KEPT. These are absolute against
     `Astro.site`, so rebuilding them from `location.origin` would silently rewrite
     production URLs to whatever host the page is being served from.

     COMPARED AGAINST THE RAW HTML, NOT AGAINST `before`. The instrument runs this
     same writer once on its FIRST ward load, so by the time the document is
     interactive the canonical in the DOM has already been through it — and a
     "before" taken from the live page would be a copy of the value under test,
     which is how a guard ends up passing for the bug it was written against. This
     one was: the check read identical rewritten origins and went green until the
     raw response was fetched instead. */
  const shipped = await page.request.get(BALLYGUNGE).then((r) => r.text());
  const shippedCanonical = shipped.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  expect(shippedCanonical, 'the prerendered HTML carries no canonical link, so '
    + 'there is no server statement left to compare the live one against and this '
    + 'assertion would be checking nothing').toBeTruthy();

  expect(new URL(after.canonical ?? '').origin,
    'the canonical URL has been rebuilt against the host the page is served from '
    + 'rather than having its path swapped, so a production page would publish a '
    + 'canonical pointing at wherever it was last previewed')
    .toBe(new URL(shippedCanonical ?? '').origin);
});

test('the data receipts follow the ward while the panel is open', async ({ page }) => {
  /* `renderSources` had exactly one caller — the `#srcBtn` click handler, and only
     on its OPENING edge. So opening the panel and then switching ward left the
     heading reading "Data receipts · ballygunge" over Ballygunge's rows, on a page
     whose every other statement had moved to Baruipur. It is self-labelled, which is
     the only reason it fails semi-loudly rather than silently — but a panel that
     names the wrong ward is worse than one that names none, because it reads as an
     answer.

     THE HEADING IS THE ASSERTION and it comes from the MANIFEST (`manifest.ward`),
     not from `state.ward`, so it cannot be satisfied by a repaint that re-labelled
     the old rows: the name changes only when a different manifest has actually been
     fetched and rendered. */
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });

  await page.locator('#srcBtn').click();
  const panel = page.locator('#srcPanel');
  await expect(panel).toContainText('ballygunge', { timeout: 20_000 });
  const rowsAtBallygunge = await panel.locator('.src-row').count();
  expect(rowsAtBallygunge, 'the receipts panel rendered no rows at all, so the '
    + 'assertions below would be comparing two empty panels').toBeGreaterThan(0);

  await page.locator('#strip .ward[data-w="baruipur"]').click();
  await expect(page.locator('#pname')).toHaveText('Baruipur', { timeout: 20_000 });
  await expect(panel, 'the open receipts panel is still headed with the ward the '
    + 'reader has left, over that ward\'s rows, on a page where the name, the URL, '
    + 'the breadcrumb and the strip have all moved on')
    .toContainText('baruipur', { timeout: 20_000 });
  await expect(panel).not.toContainText('ballygunge');

  /* A CLOSED PANEL IS NOT RE-RENDERED, which is the other half of the rule: the
     manifest is fetched per area, and re-rendering a panel nobody is looking at
     would spend a request on every strip click for a view that is not on screen.

     ASSERTED ON THE FETCH, AND ON A WARD NEVER YET VISITED. Asserting that the
     closed panel merely LOOKS closed does not bite -- rendering into a hidden
     element leaves it hidden, and it was written that way first and passed against
     a deliberately broken build. `loadLayerManifest` also caches, so a ward already
     opened would issue no request whatever the rule did. Barrackpore has not been
     touched in this test, so its manifest can only be requested by a render. */
  await page.locator('#srcBtn').click();
  await expect(panel).toBeHidden();

  let manifestFetches = 0;
  await page.route('**/barrackpore-layers.json*', async (route) => {
    manifestFetches += 1;
    await route.continue();
  });

  await page.locator('#strip .ward[data-w="barrackpore"]').click();
  await expect(page.locator('#pname')).toHaveText('Barrackpore', { timeout: 20_000 });
  await expect(panel).toBeHidden();
  expect(manifestFetches, 'the receipts panel is closed and its manifest was '
    + 'fetched anyway, so every ward switch now pays for a panel nobody is looking '
    + 'at').toBe(0);

  /* And opening it gets the ward that is now open, not the one it last held — which
     is also what proves the wait above was long enough for a fetch to have happened
     if the rule had been broken. */
  await page.locator('#srcBtn').click();
  await expect(panel).toContainText('barrackpore', { timeout: 20_000 });
  expect(manifestFetches, 'opening the panel did not fetch the manifest either, so '
    + 'the check above was measuring a request that never happens at all')
    .toBeGreaterThan(0);
});

test('a slow manifest cannot overwrite the ward the reader stopped on', async ({ page }) => {
  /* THE RACE THE FIX MAKES REACHABLE. `renderSources` used to have one caller — the
     opening click — and could not overlap itself. It is now also called on every
     ward change, and a manifest fetch easily outlives a ward switch, so two
     completed switches can leave two renders in flight. Whichever resolves LAST
     writes the panel, and that is the network's decision rather than the reader's:
     the ward passed through can overwrite the ward stopped on, rebuilding the
     wrong-ward panel out of a race.

     A FRESH PAGE, AND A WARD NOT YET OPENED. `loadLayerManifest` caches per area,
     so delaying a manifest that has already been fetched delays nothing — the first
     draft of this did exactly that, and passed against a build with the guard
     deliberately removed.

     THE SWITCHES COMPLETE. `loadWard` refuses a superseded token before it projects
     anything, so two rapid clicks produce only ONE render and no race at all; each
     switch here is waited for, which is what puts two renders in flight. */
  test.slow();

  /* Long enough to outlive a whole ward switch, which is what makes the resolution
     order wrong rather than merely concurrent. */
  await page.route('**/baruipur-layers.json*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 7000));
    await route.continue();
  });

  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 20_000 });
  const panel = page.locator('#srcPanel');
  await page.locator('#srcBtn').click();
  await expect(panel).toContainText('ballygunge', { timeout: 20_000 });

  /* Baruipur's render starts here and blocks on its delayed manifest. */
  await page.locator('#strip .ward[data-w="baruipur"]').click();
  await expect(page.locator('#pname')).toHaveText('Baruipur', { timeout: 20_000 });

  /* Barrackpore's render starts second and finishes first. */
  await page.locator('#strip .ward[data-w="barrackpore"]').click();
  await expect(page.locator('#pname')).toHaveText('Barrackpore', { timeout: 20_000 });
  await expect(panel).toContainText('barrackpore', { timeout: 20_000 });

  /* Now Baruipur's manifest lands, several seconds after the reader left it. */
  await page.waitForTimeout(9000);
  await expect(panel, 'the manifest for a ward the reader passed through arrived '
    + 'after the one for the ward they stopped on and overwrote it — the receipts '
    + 'panel is headed with a ward nothing else on the page names')
    .toContainText('barrackpore');
  await expect(panel).not.toContainText('baruipur');
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

/**
 * THE RAIL'S WIDTH, MEASURED RATHER THAN READ.
 *
 * Source cannot see a computed width, and the width is now the product of a
 * declaration on `:root`, an attribute on <html>, a media query and whatever the
 * viewport happens to be. The unit suite proves there is only ONE declaration of
 * it; only a browser can say what that declaration resolves to on each route in
 * each state, which is the fact the reader actually gets.
 */
/**
 * WHETHER THE LABEL IS A WORD ON THE ROW OR A TOOLTIP WAITING FOR A POINTER.
 *
 * NOT `toBeVisible()`, and the difference is the whole point of the collapsed
 * state. Playwright reads visibility as "has a box and is not display:none /
 * visibility:hidden" -- and the collapsed label deliberately keeps its box, at
 * `opacity: 0`, because that is what leaves the accessible name in the tree while
 * taking the pixels away. So `toBeVisible()` is TRUE in both states, and the
 * first draft of these tests asserted `not.toBeVisible()` against a collapsed
 * rail and failed for the right reason. The two computed properties below are
 * what actually separate the states.
 */
const labelStyle = (page: Page) => page.locator('[data-rail="layers"] .rail-label')
  .evaluate((el) => {
    const s = getComputedStyle(el);
    return { opacity: Number(s.opacity), position: s.position };
  });

const railBox = (page: Page) => page.locator('nav.rail').evaluate((el) => {
  const rail = el.getBoundingClientRect();
  /* The accent bar is a ::before, so it has no box of its own to measure. Its
     `left` is resolved against the button it hangs off, which does. */
  const pressed = el.querySelector('[aria-pressed="true"]');
  const barLeft = pressed === null ? null
    : pressed.getBoundingClientRect().left
      + parseFloat(getComputedStyle(pressed, '::before').left);
  return { left: rail.left, width: rail.width, barLeft };
});

test('the rail shows its labels, remembers being collapsed, and keeps its names', async ({ page }) => {
  /* REDUCED MOTION, because the width is transitioned: without it every
     measurement below is a race against 180ms of easing, and the first draft of
     this test read 141px — a number neither state has. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(BALLYGUNGE);

  const label = page.locator('[data-rail="layers"] .rail-label');
  const toggle = page.locator('button[data-rail-toggle]');

  /* EXPANDED IS WHAT A FIRST VISIT GETS. Nothing is stored, so this is the
     default arriving through the CSS rather than through any script. */
  expect(await labelStyle(page)).toEqual({ opacity: 1, position: 'static' });
  await expect(label).toHaveText('Layers');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const open = await railBox(page);
  expect(open.width, 'the rail is not wide enough to hold a word beside an icon')
    .toBeGreaterThan(120);

  /* THE ACCENT BAR IS FLUSH AT THIS WIDTH. It is offset from the rail's own
     width, and the last time that width moved the bar was left reading a stale
     copy and floated half the difference off the edge. */
  await page.locator('[data-rail="layers"]').click();
  const openPressed = await railBox(page);
  expect(openPressed.barLeft, 'no section is showing its open-pane accent bar')
    .not.toBeNull();
  expect(Math.abs(openPressed.barLeft! - openPressed.left),
    'the open-pane accent bar is not flush against the expanded rail\'s edge')
    .toBeLessThan(1);

  /* COLLAPSED. The labels go from the eye and stay in the accessibility tree —
     an icon-only rail whose sections announce nothing is the regression this
     replaces, not the state it collapses to. */
  await toggle.click();
  expect((await labelStyle(page)).opacity,
    'the label is still painted after the rail collapsed').toBe(0);
  expect((await labelStyle(page)).position,
    'the collapsed label is not the floating tooltip -- it is still taking a row '
    + "of the rail's own layout, in a column too narrow to hold it").toBe('absolute');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-rail="layers"]'))
    .toHaveAccessibleName(/Layers/);
  const shut = await railBox(page);
  expect(shut.width, 'the rail did not narrow when it was collapsed')
    .toBeLessThan(open.width);
  expect(Math.abs(shut.barLeft! - shut.left),
    'the accent bar is flush when the rail is expanded and not when it is '
    + 'collapsed — it is offset from a width that only tracks one of the two')
    .toBeLessThan(1);

  /* THE NAME FOLLOWS THE STATE. A disclosure that still says "Collapse" while
     collapsed is worse than one that says nothing. */
  const collapsedName = await toggle.getAttribute('aria-label');
  expect(collapsedName).toMatch(/expand/i);

  /* AND IT SURVIVES A RELOAD, which is the whole reason it is in localStorage.
     Measured after `load`, so a rail that came back expanded and then collapsed
     itself would show up as the flash it is rather than passing on the settled
     value. */
  await page.reload({ waitUntil: 'load' });
  expect((await railBox(page)).width).toBe(shut.width);
  expect((await labelStyle(page)).opacity).toBe(0);
  await expect(page.locator('button[data-rail-toggle]'))
    .toHaveAttribute('aria-expanded', 'false');

  /* EXPANDING AGAIN IS REMEMBERED TOO. A preference that can only be set one way
     is a door that locks — and it is exactly what a handler toggling the STORED
     value rather than the rendered one produces where storage is unavailable. */
  await page.locator('button[data-rail-toggle]').click();
  await page.reload({ waitUntil: 'load' });
  expect((await railBox(page)).width).toBe(open.width);
});

test('below the console breakpoint the rail is collapsed whatever was stored', async ({ page }) => {
  /* THE STORED PREFERENCE IS OVERRIDDEN, NOT FORGOTTEN. At this width the stage
     has already dropped the sidebar; a 172px navigation column over what is left
     of the map would be the same trade made worse. The chevron goes with it,
     because a control that cannot change anything is one this project deletes. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(BALLYGUNGE);

  const wide = await railBox(page);
  expect(await labelStyle(page)).toEqual({ opacity: 1, position: 'static' });

  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await railBox(page);
  expect(narrow.width, 'the rail keeps its expanded width on a phone, over a map '
    + 'that has already given up its sidebar').toBeLessThan(wide.width);
  expect((await labelStyle(page)).opacity,
    'the labels are still painted on a 390px rail').toBe(0);
  await expect(page.locator('button[data-rail-toggle]')).not.toBeVisible();

  /* THE SECTIONS ARE STILL NAMED. This is the width with no hover at all, so the
     tooltip that used to be the only label is unreachable by definition. */
  await expect(page.locator('[data-rail="layers"]')).toHaveAccessibleName(/Layers/);

  /* AND THE PREFERENCE IS INTACT: widening brings the labels back without the
     reader having to ask for them again. */
  await page.setViewportSize({ width: 1400, height: 900 });
  expect(await labelStyle(page)).toEqual({ opacity: 1, position: 'static' });
  expect((await railBox(page)).width).toBe(wide.width);
});

test('the panel closes by either door, and both doors leave the same state', async ({ page }) => {
  /* THE WIDTH IS PINNED WIDE FOR EVERY ASSERTION HERE. Below 820px this column is
     `display:none` by media query, so a "the panel is hidden" check would pass
     over a chevron that does nothing at all -- the exact shape of guard this
     project has been caught shipping. Nothing below is read at a width where the
     stylesheet would answer for the control. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(BALLYGUNGE);

  const sidebar = page.locator('.sidebar');
  const chevron = page.locator('button[data-panel-toggle]');
  const mapSection = page.locator('[data-rail="map"]');
  const layers = page.locator('[data-rail="layers"]');

  await expect(sidebar).toBeVisible();
  await expect(chevron).toBeVisible();
  await expect(chevron).toHaveAttribute('aria-expanded', 'true');
  await expect(mapSection).toHaveAttribute('aria-pressed', 'true');

  /* DOOR ONE: the chevron. Every part of the state has to move, not just the
     column -- the rail's pressed section is a claim about a pane that is no
     longer on the page. */
  await chevron.click();
  await expect(sidebar).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-panel', 'collapsed');
  await expect(mapSection).toHaveAttribute('aria-pressed', 'false');
  await expect(chevron).toHaveAttribute('aria-expanded', 'false');

  /* THE WAY BACK IS THE RAIL, which is the whole reason the chevron does not need
     to reopen anything. A different section than the one that was showing, so
     this cannot pass by the panel simply never having closed. */
  await layers.click();
  await expect(sidebar).toBeVisible();
  await expect(page.locator('.pane[data-pane="layers"]')).toHaveClass(/is-on/);
  await expect(layers).toHaveAttribute('aria-pressed', 'true');
  await expect(chevron).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-panel', 'expanded');

  /* DOOR TWO: the rail's own gesture, clicking the section already showing. It
     must land in exactly the state the chevron produced -- if the two write
     different things, one of them is a second copy of the fact. */
  await layers.click();
  await expect(sidebar).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-panel', 'collapsed');
  await expect(layers).toHaveAttribute('aria-pressed', 'false');
  await expect(chevron).toHaveAttribute('aria-expanded', 'false');

  await mapSection.click();
  await expect(sidebar).toBeVisible();
  await expect(chevron).toHaveAttribute('aria-expanded', 'true');
});

test('a collapsed panel survives a reload, and 820px overrides an open one', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(BALLYGUNGE);

  await page.locator('button[data-panel-toggle]').click();
  await expect(page.locator('.sidebar')).toBeHidden();

  /* REMEMBERED. Read after `load` at the SAME width, so nothing here can be the
     viewport answering instead of the preference. */
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('button[data-panel-toggle]'))
    .toHaveAttribute('aria-expanded', 'false');

  /* AND THE PANE IDENTITY IS STILL NOT REMEMBERED, which is the decision
     console-shell.ts made and this one deliberately does not overturn: bringing
     the panel back gives the DEFAULT pane, not whatever was showing when it was
     put away. Layers was never opened in this test, so Map coming back is the
     server's render rather than a restored choice. */
  await page.locator('[data-rail="reports"]').click();
  await expect(page.locator('.pane[data-pane="reports"]')).toHaveClass(/is-on/);
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('.pane[data-pane="map"]')).toHaveClass(/is-on/);

  /* THE BREAKPOINT WINS OVER A STORED *OPEN*. The panel is open at this point, so
     a hidden sidebar at 390px can only be the media query -- and it must come
     back when there is room, without the reader asking again. */
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('button[data-panel-toggle]')).toBeHidden();
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('both stored preferences are applied before any module script runs', async ({ page }) => {
  /* THE NO-FLASH GUARD, AND IT HAD TO BE WRITTEN THIS WAY. The obvious version —
     collapse, reload, assert collapsed — passes whether the preference is applied
     before first paint or three hundred milliseconds later by the shell's mount,
     because Playwright waits for the settled state either way. Measured: deleting
     the rule that applies the stored panel collapse early left that test green.
     What it costs a reader is a 300px column and a 114px rail appearing and then
     being taken away on every single load.
     So every bundled module is BLOCKED. What is left is the server's HTML and the
     one inline script the rail embeds, which is exactly the state the page is in
     at first paint — and both preferences must already be honoured in it. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.addInitScript(() => {
    try {
      localStorage.setItem('obos:rail', 'collapsed');
      localStorage.setItem('obos:panel', 'collapsed');
    } catch { /* the test cannot run without storage; the assertions below say so */ }
  });
  await page.route('**/_astro/*.js', (route) => route.abort());
  await page.goto(BALLYGUNGE, { waitUntil: 'commit' });

  const html = page.locator('html');
  await expect(html, 'the rail preference is not on the document before the '
    + 'bundle runs — the inline pre-paint script is missing or threw')
    .toHaveAttribute('data-rail', 'collapsed');
  await expect(html).toHaveAttribute('data-panel', 'collapsed');

  /* AND THE PIXELS FOLLOW, which is the half the attributes alone do not prove:
     an attribute nothing selects on is a preference recorded and ignored. */
  await expect(page.locator('.sidebar'),
    'the panel is still on screen with its collapse stored and no script running '
    + '— the attribute is set but no stylesheet reads it, so the column will '
    + 'appear on every load and vanish once the bundle mounts').toBeHidden();
  expect(await page.locator('nav.rail').evaluate((el) => el.getBoundingClientRect().width),
    'the rail is at its expanded width with the collapse stored and no script '
    + 'running, so it will be seen wide and then animate shut on every load')
    .toBeLessThan(120);

  /* THE SECTIONS ARE STILL NAMED WITH NO JAVASCRIPT AT ALL. */
  await expect(page.locator('[data-rail="layers"]')).toHaveAccessibleName(/Layers/);
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
  /* `.rig`, NOT `.read`. The top bar's readout was one three-line block; it is now
     two, split so the live half — what the instrument is running over — sits apart
     from the static half that names the page. This sentence is the live half's
     no-data form, so it moved with it. The assertion is unchanged: what must hold
     is that the page SAYS what is true here, and it is checked against the element
     that carries that fact rather than against the block it used to live in. */
  /* VISIBLE, then the text. `toContainText` alone reads `textContent`, which a
     hidden element still has — measured: adding `hidden` to this block left the
     assertion green. The claim is that a reader is TOLD what is true here, and a
     sentence present in the DOM but never painted is exactly the silent
     degradation this whole test exists against. */
  await expect(page.locator('.rig')).toBeVisible();
  await expect(page.locator('.rig')).toContainText('no artefacts · geometry tier');

  /* THE CONSOLE IS STILL AROUND THE STATEMENT, and every control in it tells the
     truth about this place. The header tab strip used to be checked here — its
     three siblings had to be <a> rather than <button>, because no instrument is
     mounted to handle a click. That strip is gone; the same claim is now made by
     the two controls that replaced it.

     THE AREA FIELD offers Dubai's three tiles and DISABLES every one of them, so
     the "not shipping" fact is announced rather than accepted-and-then-refused. */
  const areaOptions = page.locator('select[data-scope="area"] option');
  await expect(areaOptions).toHaveCount(3);
  await expect(page.locator('select[data-scope="area"] option:not([disabled])')).toHaveCount(0);

  /* AND THE SAME THING AGAIN WHERE A READER CAN SEE IT. The three assertions above
     are about the <select> that holds the value; it is invisible, and on its own
     it would go on passing over a dropdown that had quietly stopped carrying the
     refusal through. This is the page the whole disabled case exists for — Dubai's
     areas are NAMED rather than hidden because the gap between its tier and
     Kolkata's is the funding ask — so the drawn rows are checked too:

       · all three present, so none has been hidden to avoid explaining it,
       · every one aria-disabled, which is what a screen reader announces,
       · every one carrying its REASON, because a greyed row with no explanation
         reads as a bug in the page rather than as a fact about the world.

     The collapsed control says it too: this area is the one the page is standing
     on, so the note has to be legible without opening anything at all. */
  await expect(page.locator('#scope-area-trigger [data-select-note]')).toHaveText('no data yet');
  await page.locator('#scope-area-trigger').click();
  await expect(page.locator('#scope-area-trigger')).toHaveAttribute('aria-expanded', 'true');
  const areaRows = page.locator('#scope-area-list li');
  await expect(areaRows).toHaveCount(3);
  await expect(page.locator('#scope-area-list li[aria-disabled="true"]')).toHaveCount(3);
  /* `allTextContents`, NOT `allInnerTexts`: the note is uppercased in CSS, and
     innerText would hand back the RENDERED case. The string this is checking
     against is the one the registry wrote, so the comparison has to be against
     what the DOM holds rather than against what the stylesheet made of it. */
  const notes = await page.locator('#scope-area-list li .field-option-note').allTextContents();
  expect(notes.length, 'no row carried a note element at all').toBe(3);
  for (const note of notes) {
    expect(note.trim(), 'a disabled row carries no reason').toBe('no data yet');
  }
  /* AND IT REFUSES THE KEYBOARD, not just the eye. Enter on a disabled row must
     leave the list open and the value where it was — a row that closed the list
     would look exactly like one that had been accepted, which is the
     accepted-then-quietly-ignored failure this console exists not to repeat. */
  await page.keyboard.press('Enter');
  await expect(page.locator('#scope-area-trigger')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('select[data-scope="area"]')).toHaveValue('ae/dubai/al-quoz');
  await page.keyboard.press('Escape');
  await expect(page.locator('#scope-area-trigger')).toHaveAttribute('aria-expanded', 'false');

  /* THE LAYER TREE shows its rows rather than hiding them — an absent row reads as
     "this does not exist", which is a different and wronger claim than "we do not
     have it here yet" — and disables each one WITH A REASON.

     ALL SIX, INCLUDING STREET-LEVEL IMAGERY, and that is the half worth stating.
     Street depends on a Mapillary token rather than on a shipped artefact, so it
     used to be excluded here: with the token set it came back available, and this
     page shipped a live checkbox with no map under it. Production sets that token.
     `layerAvailability` now refuses at the PAGE level, before either axis — an area
     that ships nothing mounts no instrument, so nothing is drawable whatever it
     depends on — which makes this assertion hold in a token-bearing build too,
     BY CONSTRUCTION rather than by the test environment happening to lack one. */
  for (const id of ['thermal/surface', 'green/canopy', 'green/trees',
    'built/footprints', 'built/heights', 'ground/street']) {
    await expect(page.locator(`input[data-layer="${id}"]`)).toBeDisabled();
    await expect(page.locator(`input[data-layer="${id}"]`)).not.toBeChecked();
    /* AND THE REASON IS THE OPERATIVE ONE. Naming the missing artefact is true and
       incidental; a reader looking at six greyed rows needs the fact that explains
       all six. Six identical sentences is what a page-level refusal looks like. */
    await expect(page.locator(`.tree-row:has(input[data-layer="${id}"]) .tree-why`))
      .toContainText('no map is mounted');
  }

  /* NOTHING IN THE SIDEBAR RESPONDS TO A CLICK EXCEPT THE WAY OUT, and this was
     MEASURED rather than assumed. The sidebar renders on every area page, so
     composing the console moved the intervention toolbox and the ward-record link
     onto this one — three live sliders, a segmented control and a download whose
     route the build never emitted, all on the page whose entire content is a
     statement that nothing can be computed here. No instrument is mounted to hear
     any of it.
     The three scope fields are the exception and the point: they are how you
     leave. Everything else must be absent or disabled.

     THE CARVE-OUT IS SPELLED AS A FLOOR AND A CEILING, and it is the same
     carve-out rather than a loosened one. It used to read `.sidebar button` → 0,
     because the scope fields were bare <select>s and the sidebar genuinely held no
     button at all. They are dropdowns now and each opens from a <button>, so the
     exception has to be named — and it is named by BOTH a count and a remainder:
     exactly three triggers, and nothing else clickable. Asserting only the
     remainder would let the three quietly become none.

     THE PANEL'S CHEVRON IS THE SECOND NAMED EXCEPTION, and it belongs on the same
     side of this test as the scope fields: it is not a control over data that is
     not here, it is a control over how much of the screen this statement is using.
     It works on this page exactly as it works on every other, which is why it is
     counted rather than excluded — a `:not()` that merely stepped over it would
     also step over a second one arriving with nothing behind it. */
  await expect(page.locator('.sidebar button[data-select-trigger]')).toHaveCount(3);
  await expect(page.locator('.sidebar button[data-panel-toggle]')).toHaveCount(1);
  await expect(page.locator(
    '.sidebar button:not([data-select-trigger]):not([data-panel-toggle])')).toHaveCount(0);
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
