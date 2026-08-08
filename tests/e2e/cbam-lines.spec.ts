import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

// ── the DOM contract ─────────────────────────────────────────────────────────
// #cbCn #cbCountry #cbRoute #cbScope #cbMass #cbDate build the NEXT line; #cbAdd
// commits it. #cbCsv/#cbDoc start disabled and unlock once a line exists. #cbOut
// (inside #cbOutWrap, which carries aria-live) is the delegate target for both
// `click` (Remove, `[data-remove="<id>"]`) and `change` (attest checkboxes,
// `[data-attest="<year>"]`), via closest(). #cbStatus is the screen-reader
// channel while the panel's own aria-live is turned OFF in multi-line mode —
// several tests below assert THAT text, not just the visible card, because it
// is the only thing a screen-reader user hears after an add/remove/attest.
//
// METHODOLOGY TRAP: never `page.dispatchEvent(...)` a `click` at a button, and
// never `elementHandle.dispatchEvent(new MouseEvent('click'))`. The HTML spec
// gates disabled-state activation behaviour BELOW the level a raw dispatched
// event reaches, so a dispatched click still invokes listeners on a disabled
// #cbAdd — a false failure (or false pass) waiting to happen. `.click()`,
// `page.click()`, `page.dblclick()` and `page.mouse.click()` all respect the
// gate; every click below uses one of those. `page.dispatchEvent(el, 'change')`
// on an <input> is a different, safe case — `change` is not an activation event
// — and is used exactly once below, to fire #cbCn's change listener after
// `fill()` (which only ever dispatches `input`).
//
// #cbDate is filled explicitly in every test (via setLine), never left at the
// form's own default: the threshold cards are keyed by calendar year, and a
// default that later drifts would silently change which year a test asserts.

interface LineInput {
  cn: string;
  country: string;
  route: string;
  mass: string;
  date: string;
}

// A cement clinker import from Algeria on its one published route — priced,
// with a real 2026 threshold row. The baseline "good" line most tests build on.
const GOOD_LINE: LineInput = { cn: '25231000', country: 'DZ', route: '(A)', mass: '30', date: '2026-03-15' };

// Genuinely unpriceable in the shipped pack: the defaults corpus declares route
// (C) for this CN, but no Column B benchmark resolves for it — an ordinary
// engine refusal (`status: 'unavailable'`), not a thrown error, and still an
// iron_and_steel-sector line that counts toward its year's threshold mass.
const REFUSED_LINE: LineInput = { cn: '72052100', country: 'IN', route: '(C)', mass: '60', date: '2026-03-15' };

async function setLine(page: Page, line: LineInput): Promise<void> {
  await page.fill('#cbCn', line.cn);
  // fill() only ever dispatches `input`; #cbCn's route/country sync listens on `change`.
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', line.date);
  // Waiting for the option to exist is proof the pack (and the country list built from it)
  // has actually loaded, rather than trusting selectOption's own retry behaviour to cover it.
  await expect(page.locator(`#cbCountry option[value="${line.country}"]`)).toBeAttached();
  await page.selectOption('#cbCountry', line.country);
  await expect(page.locator(`#cbRoute option[value="${line.route}"]`)).toBeAttached();
  await page.selectOption('#cbRoute', line.route);
  await page.fill('#cbMass', line.mass);
}

/**
 * Fills the form and clicks Add, then waits for the line to actually render. onAdd is async — it
 * awaits ensurePack() and then lineFingerprint() before pushing — so a caller that didn't wait
 * here before filling the NEXT line could race draftLine()'s read of the form against this one.
 */
async function addLine(page: Page, overrides: Partial<LineInput> = {}): Promise<void> {
  const before = await page.locator('.cb-line').count();
  await setLine(page, { ...GOOD_LINE, ...overrides });
  await page.click('#cbAdd');
  await expect(page.locator('.cb-line')).toHaveCount(before + 1);
}

/**
 * Minimal RFC 4180 reader — handles quoted fields and doubled internal quotes, both of which real
 * rows from csvRows carry (72052100's own pack description contains commas and literal quotes),
 * so a naive `.split(',')` would silently misalign columns for that line.
 */
function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

test.describe('multi-line CBAM estimate — add, remove, attest, totals', () => {
  test('add two lines, remove one, totals and line count follow', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '30' });
    await addLine(page, { mass: '100' });
    await expect(page.locator('.cb-line')).toHaveCount(2);
    await expect(page.locator('.cb-total')).toContainText('2 lines');

    await page.locator('[data-remove]').first().click();
    await expect(page.locator('.cb-line')).toHaveCount(1);
    await expect(page.locator('.cb-total')).toContainText('1 line');
  });

  test('attestation flips indeterminate to below-threshold and back, restoring checkbox focus', async ({ page }) => {
    // Pins item 2 of the brief: renderAll rebuilds #cbOut via innerHTML on every toggle,
    // destroying the checkbox just interacted with — the fix (re-find by data-attest value,
    // refocus) is currently correct and this pins it as a regression test.
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '30' });
    await expect(page.locator('.cb-thresh')).toContainText('Indeterminate');

    const attest = page.locator('[data-attest="2026"]');
    await attest.check();
    await expect(page.locator('.cb-thresh')).toContainText('Below threshold');
    await expect(attest).toBeFocused();

    await attest.uncheck();
    await expect(page.locator('.cb-thresh')).toContainText('Indeterminate');
    await expect(attest).toBeFocused();
  });

  test('attesting a year, then adding another line to that year, drops the attestation', async ({ page }) => {
    // ATTESTATION-INVALIDATION RULE (cbam-app.ts's own doc comment above onOutClick): a calendar
    // year's "these are all my imports" tick is a claim about ONE specific list of lines. onAdd
    // drops any existing attestation for the year the new line joins (`attested.delete(year)`) —
    // this is the tool's core honesty mechanism, and nothing before this test caught it
    // regressing: a reviewer deleted that one call and all 77 unit and 17 e2e tests stayed green.
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '20', date: '2026-03-15' });
    await expect(page.locator('.cb-thresh')).toContainText('Indeterminate');

    const attest = page.locator('[data-attest="2026"]');
    await attest.check();
    await expect(page.locator('.cb-thresh')).toContainText('Below threshold');
    await expect(attest).toBeChecked();

    // A second 2026 line — still under the 50 t threshold on its own, but the LIST the user
    // attested to a moment ago no longer exists; a second line joined it without any fresh
    // statement of completeness.
    await addLine(page, { mass: '10', date: '2026-03-15' });
    await expect(page.locator('.cb-line')).toHaveCount(2);
    await expect(page.locator('.cb-thresh')).toContainText('Indeterminate');
    await expect(page.locator('[data-attest="2026"]')).not.toBeChecked();
  });

  test('attesting a year, then removing a line from that year, drops the attestation', async ({ page }) => {
    // The symmetric half of the rule above, on onOutClick's remove branch: removing a line from
    // an attested year is just as much a change to the list the user swore was complete as adding
    // one is. Two lines both in 2026 so the year still has content (and still shows a threshold
    // card with a checkbox) after one is removed — this is not the "the year emptied out"
    // case, it is "the list changed while other lines from it remain".
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '20', date: '2026-03-15' });
    await addLine(page, { mass: '10', date: '2026-03-15' });
    await expect(page.locator('.cb-line')).toHaveCount(2);

    const attest = page.locator('[data-attest="2026"]');
    await attest.check();
    await expect(page.locator('.cb-thresh')).toContainText('Below threshold');
    await expect(attest).toBeChecked();

    await page.locator('[data-remove]').first().click();
    await expect(page.locator('.cb-line')).toHaveCount(1);
    await expect(page.locator('.cb-thresh')).toContainText('Indeterminate');
    await expect(page.locator('[data-attest="2026"]')).not.toBeChecked();
  });

  test('a 60 t line reports above threshold, with no checkbox to gate a fact', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '60' });
    await expect(page.locator('.cb-thresh')).toContainText('Above threshold');
    await expect(page.locator('[data-attest]')).toHaveCount(0);
  });

  test('#cbStatus does not go stale when the last line is removed', async ({ page }) => {
    // Pins de5eb2e: a stale announcement left behind here (still naming the removed line's
    // figures) would mislead exactly the screen-reader users who have no other channel, since
    // the panel's own aria-live is turned off for the duration of multi-line mode.
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '30' });
    const status = page.locator('#cbStatus');
    await expect(status).toContainText('1 line');
    await expect(status).not.toHaveText('');

    await page.locator('[data-remove]').first().click();
    await expect(page.locator('.cb-line')).toHaveCount(0);
    await expect(status).toHaveText('');
  });

  test('a year with no published threshold rule is named in the announcement, not just the card', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { date: '2027-03-15' });
    await expect(page.locator('.cb-thresh')).toContainText('No published rule');
    // #cbStatus is the only channel a screen-reader user has once the panel's own aria-live is
    // off — a year silently missing from this sentence is a gap, not just a milder one.
    await expect(page.locator('#cbStatus')).toContainText('2027');
    await expect(page.locator('#cbStatus')).toContainText(/no published rule/i);
  });

  test('remove-focus lands on the button that slid into the removed line\'s index', async ({ page }) => {
    // Pins item 1 of the brief, all three cases in one deterministic chain:
    //   1. remove the FIRST of three  -> focus lands on the button now at index 0
    //   2. remove the LAST of the remaining two -> focus lands on the sole remaining button
    //   3. remove the ONLY remaining line -> focus falls to #cbAdd
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '10' });
    await addLine(page, { mass: '20' });
    await addLine(page, { mass: '30' });
    await expect(page.locator('.cb-line')).toHaveCount(3);

    await page.locator('[data-remove]').first().click();
    await expect(page.locator('.cb-line')).toHaveCount(2);
    await expect(page.locator('[data-remove]').first()).toBeFocused();

    await page.locator('[data-remove]').last().click();
    await expect(page.locator('.cb-line')).toHaveCount(1);
    await expect(page.locator('[data-remove]').first()).toBeFocused();

    await page.locator('[data-remove]').first().click();
    await expect(page.locator('.cb-line')).toHaveCount(0);
    await expect(page.locator('#cbAdd')).toBeFocused();
  });

  test('delegation via closest(): a click on a child element inside Remove still removes the line', async ({ page }) => {
    // Pins item 9. The Remove button is text-only today — onOutClick's own comment names this as
    // "an accident of today's markup, not a guarantee". Wrap the label in a child <span> to
    // reproduce exactly the future-markup scenario that comment describes, and prove
    // ev.target.closest('[data-remove]') still finds the button rather than requiring
    // ev.target to BE it.
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '30' });
    await expect(page.locator('.cb-line')).toHaveCount(1);

    await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>('[data-remove]');
      if (btn) btn.innerHTML = '<span class="injected-child">Remove</span>';
    });
    await page.locator('[data-remove] .injected-child').click();
    await expect(page.locator('.cb-line')).toHaveCount(0);
  });
});

test.describe('multi-line CBAM estimate — exports', () => {
  test('CSV exports carry the full header and a real snapshot digest, not the placeholder', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '100' });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#cbCsv'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^cbam-estimate-\d{4}-\d{2}-\d{2}\.csv$/);

    const filePath = await download.path();
    if (!filePath) throw new Error('download produced no local file path');
    const csv = readFileSync(filePath, 'utf8').trim();
    const [headerLine, ...rowLines] = csv.split('\n');
    const header = parseCsvRow(headerLine!);
    for (const col of ['direct_tco2e', 'indirect_tco2e', 'embedded_tco2e', 'pack_snapshot']) {
      expect(header, `header is missing ${col}`).toContain(col);
    }
    const row = parseCsvRow(rowLines[0]!);
    const snapshot = row[header.indexOf('pack_snapshot')]!;
    expect(snapshot).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot).not.toBe('browser-prototype');
  });

  test('exports reflect the committed line, not an unsaved edit to the form', async ({ page }) => {
    // Pins item 10: the form is the editor for the NEXT line, not a live binding to one already
    // committed — editing #cbMass after Add, without clicking Add again, must not leak into the
    // export of the line already on screen.
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '30' });
    await expect(page.locator('.cb-line')).toHaveCount(1);

    await page.fill('#cbMass', '999');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#cbCsv'),
    ]);
    const filePath = await download.path();
    if (!filePath) throw new Error('download produced no local file path');
    const [headerLine, ...rowLines] = readFileSync(filePath, 'utf8').trim().split('\n');
    const header = parseCsvRow(headerLine!);
    const row = parseCsvRow(rowLines[0]!);
    expect(row[header.indexOf('mass_t')]).toBe('30');
  });

  test('the print document fills #cbPrint with the §4 caveats', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '100' });
    // window.print() is a genuine no-op in headless Chromium — stubbed so onDoc's synchronous
    // call cannot hang or throw. The afterprint/matchMedia/timeout cleanup paths are covered
    // separately below, each driven explicitly rather than left to a print dialog that never opens.
    await page.evaluate(() => { window.print = () => {}; });
    await page.click('#cbDoc');
    const print = page.locator('#cbPrint');
    await expect(print).toContainText('What this does not tell you');
    await expect(print).toContainText('inputs as entered');
  });
});

test.describe('multi-line CBAM estimate — cb-printing always comes off <html>', () => {
  // Pins item 8. Three independent paths remove the class (onDoc's own comment names all three:
  // afterprint, a matchMedia('print') change, and a 30s hard timeout as the last-resort net).
  // Each is driven explicitly here since headless Chromium's window.print() itself fires none of
  // them on its own.
  test.beforeEach(async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '30' });
    await page.evaluate(() => { window.print = () => {}; });
  });

  test('the afterprint event removes it', async ({ page }) => {
    await page.click('#cbDoc');
    await expect(page.locator('html')).toHaveClass(/cb-printing/);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('html')).not.toHaveClass(/cb-printing/);
  });

  test('a matchMedia("print") transition back to screen removes it', async ({ page }) => {
    await page.click('#cbDoc');
    await expect(page.locator('html')).toHaveClass(/cb-printing/);
    // emulateMedia genuinely fires `change` on any live MediaQueryList matching the query it
    // toggles — the real listener onDoc registers via matchMedia('print'), not a synthetic event
    // dispatched at an object of our own. print() first so the query genuinely starts matched,
    // then screen() to trigger the "no longer matches" transition onMqlChange reacts to. The two
    // calls need a beat between them: issued back-to-back, Chromium coalesces the pair into a
    // no-op (screen -> screen) and dispatches no `change` event at all — confirmed by a throwaway
    // diagnostic against this exact page before adding the wait.
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(150);
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('html')).not.toHaveClass(/cb-printing/);
  });

  test('the 30s fallback removes it when nothing else fires', async ({ page }) => {
    // Genuinely exercises the same `window.setTimeout(cleanup, 30_000)` call onDoc registers —
    // just compressed, so the test does not sit on a real 30s wall-clock wait. Deliberately NOT
    // Playwright's Clock API here: faking Date/rAF would also freeze the page's own scroll and
    // menu animation tickers, which this test has no reason to touch. Every OTHER timeout on the
    // page is compressed the same way, harmlessly (the mass-input debounce, the nav's hover-close
    // delay) — none of them run during this test.
    await page.addInitScript(() => {
      const real = window.setTimeout.bind(window);
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        real(handler, Math.min(timeout ?? 0, 50), ...args)) as typeof window.setTimeout;
    });
    // Re-navigate under the compressed timer, replacing this describe block's own beforeEach
    // (which ran before the init script existed).
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '30' });
    await page.evaluate(() => { window.print = () => {}; });

    await page.click('#cbDoc');
    await expect(page.locator('html')).toHaveClass(/cb-printing/);
    await expect(page.locator('html')).not.toHaveClass(/cb-printing/, { timeout: 2000 });
  });
});

test.describe('multi-line CBAM estimate — the Add guard and failure surfacing', () => {
  test('#cbAdd disables for the duration of onAdd: an overlapping click cannot activate it; a sequential one legitimately adds a second line', async ({ page }) => {
    // Pins item 6. Widens onAdd's async window (ensurePack + lineFingerprint) well past the
    // couple of milliseconds a real overlapping click needs — the reviewer's own technique,
    // named in the brief, for making the race genuinely observable rather than hoping two
    // Playwright actions land in the right order by luck.
    await page.addInitScript(() => {
      const real = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> =>
        new Promise((resolve, reject) => {
          setTimeout(() => { real(algorithm, data).then(resolve, reject); }, 1000);
        });
    });
    await page.goto('/cbam/cbam-calculator/');
    await setLine(page, GOOD_LINE);

    const addBtn = page.locator('#cbAdd');
    // Fired, not awaited — this is the click whose in-flight window is under test.
    const firstClick = addBtn.click();
    await expect(addBtn).toBeDisabled();

    // A GENUINE second click — .click(), never a raw dispatch (see the file-level trap note) —
    // attempted while the button is disabled. Per the HTML spec, disabled-state gating lives in
    // the activation-behaviour layer below JS listeners, so a real click cannot invoke onAdd here
    // at all; Playwright's own actionability wait cannot find the button clickable within a
    // window far shorter than the slowed digest, so the action times out. That timeout IS the
    // assertion — it proves the guard, not a flake.
    await expect(addBtn.click({ timeout: 300 })).rejects.toThrow();

    await firstClick;
    await expect(addBtn).toBeEnabled();
    await expect(page.locator('.cb-line')).toHaveCount(1);

    // Sequential, deliberate, AFTER settling: two shipments of the same good is a legitimate
    // second line, not a duplicate to be blocked.
    await addBtn.click();
    await expect(page.locator('.cb-line')).toHaveCount(2);
  });

  test('a failure inside onAdd surfaces to #cbStatus and re-enables #cbAdd', async ({ page }) => {
    // Pins item 7 (quality review item 1): with crypto.subtle.digest forced to reject, clicking
    // Add used to do nothing visible at all.
    await page.goto('/cbam/cbam-calculator/');
    await setLine(page, GOOD_LINE);
    // Let the pack load for real first — ensurePack must succeed so onAdd actually reaches
    // lineFingerprint, the call this test cripples. The route options populating is proof the
    // pack round-trip (and its own digest call) already completed.
    await expect(page.locator('#cbRoute')).toBeEnabled();

    await page.evaluate(() => {
      crypto.subtle.digest = () => Promise.reject(new Error('digest unavailable in this test'));
    });

    const addBtn = page.locator('#cbAdd');
    await addBtn.click();
    await expect(page.locator('#cbStatus')).toContainText('Could not add the line:');
    await expect(addBtn).toBeEnabled();
    await expect(page.locator('.cb-line')).toHaveCount(0);
  });
});

test.describe('multi-line CBAM estimate — soft navigation', () => {
  test('the double-init guard survives a genuine client-side soft navigation', async ({ page }) => {
    // Pins item 5 — unverified by both the implementer and the reviewer. Navigates away and back
    // via real in-page link clicks (astro:page-load fires again on each), never page.goto() (a
    // hard reload, which would never exercise the soft-nav guard at all). Both hops stay off the
    // home page on purpose: '/' runs its own first-visit loader gate, an unrelated timing surface
    // this test has no reason to cross.
    await page.goto('/cbam/cbam-calculator/');
    await expect(page.locator('#cbAdd')).toBeVisible();

    // focus(), not hover(): it triggers the mega-menu's own `focus` listener directly, without
    // depending on synthesized mouse-trajectory/hover-bridge timing.
    await page.getByRole('button', { name: 'Interactive Tools', exact: true }).focus();
    await page.locator('a.menu-item[href="/cbam"]').click();
    await expect(page).toHaveURL(/\/cbam\/?$/);

    // ...and back, via the explainer page's own link to the estimator — a second, independent
    // soft nav, with no nav-menu interaction needed for the return leg.
    const backLink = page.locator('a.cbam-btn[href="/cbam/cbam-calculator"]');
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL(/\/cbam\/cbam-calculator\/?$/);
    await expect(page.locator('#cbAdd')).toBeVisible();

    // If the guard failed (two initCbam() closures wired to the same DOM), one Add click would
    // push into both closures' arrays and — per the guard's own doc — whichever renders last
    // would still show one line, but a second Remove or a second Add would reveal two divergent
    // line lists. Asserting a clean single line after one click is the observable half of that;
    // it is what the referenced defect actually broke (double lines from ONE click) if it recurs.
    await addLine(page, { mass: '30' });
    await expect(page.locator('.cb-line')).toHaveCount(1);
  });
});

test.describe('multi-line CBAM estimate — accessibility', () => {
  test('axe: a populated multi-line state (two years, a refused line) has no automated WCAG violations', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    // A refused line still counts toward its year's eligible mass — Art 2(3) counts imported
    // mass regardless of whether a certificate price can be computed for it — so 2026's two
    // in-scope lines here (20 t + 25 t) are kept under the 50 t threshold on purpose, to reach
    // the below-threshold, checkbox-bearing card rather than accidentally tipping it above.
    await addLine(page, { mass: '20', date: '2026-03-15' }); // indeterminate, 2026
    await addLine(page, { mass: '25', date: '2027-03-15' }); // no published rule, 2027
    await addLine(page, { ...REFUSED_LINE, mass: '25' }); // refused, still counted, 2026
    await expect(page.locator('.cb-line')).toHaveCount(3);
    await page.check('[data-attest="2026"]');
    await expect(page.locator('.cb-thresh').first()).toContainText('Below threshold');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
