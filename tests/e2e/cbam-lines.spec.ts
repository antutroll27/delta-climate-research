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

// GREY cement clinker from Algeria on its one published route — priced, with a real
// 2026 threshold row. The baseline "good" line most tests build on.
//
// WAS '25231000', AND THE CODE MOVED WITH THE CORPUS, NOT THE CLAIM. IR (EU) 2026/1740
// re-keys the defaults onto 10-digit TARIC because white and grey clinker carry
// different figures, so the 8-digit CN above them is no longer an offered good at all:
// routesFor returns [], setLine's `#cbRoute option[value="(A)"]` never appears, and every
// test built on this fixture times out there rather than at the thing it asserts. The
// figure is preserved at the new key — 100 t on route (A) still prices at 75.865
// certificates / €5,717.19 — only the key moved. cbam-render.test.mjs pins the 8-digit
// stem's own refusal ("no value is published at 25231000 — the Commission publishes at
// 2523100010 or 2523100090"), which is the sentence a user typing their customs code now
// gets, so nothing about the old code is left unwitnessed.
//
// IT IS SINGLE-ROUTE NOW, and that is a real behavioural change, not bookkeeping: on v1,
// 25231000/DZ published (A) AND (B). The split put those two routes on two DIFFERENT
// goods — grey (2523100090) publishes only (A), white (2523100010) only (B) — so cement
// can no longer witness anything about choosing among routes. MULTI_ROUTE_LINE below
// exists for that.
const GOOD_LINE: LineInput = { cn: '2523100090', country: 'DZ', route: '(A)', mass: '30', date: '2026-03-15' };

// Unwrought aluminium from Algeria, which publishes (K) and (L) and prices on BOTH
// (30 t: (K) 31.07625 certificates / €2,341.91, (L) 9.21825 / €694.69). The route-memory
// test needs a good that genuinely offers a CHOICE — nextRoute short-circuits on
// `published.length === 1` and selects the only route whatever the previous pick was, so
// a single-route good cannot exercise the restore at all. Aluminium is where that lives
// now that the TARIC split made cement single-route: measured over the shipped pack,
// DZ's multi-route goods fall into exactly two route sets, (K)+(L) and (C)+(F).
const MULTI_ROUTE_LINE: LineInput = { cn: '76011010', country: 'DZ', route: '(L)', mass: '30', date: '2026-03-15' };

// Genuinely unpriceable in the shipped pack: route (G) is offered for this CN — the
// free-allocation benchmark resolves for it — but the Commission publishes no direct
// default value, so the defaults tier refuses with NO_DIRECT_DEFAULT. An ordinary
// engine refusal (`status: 'unavailable'`), not a thrown error, and still an
// iron_and_steel-sector line that counts toward its year's threshold mass.
//
// WAS route (C), whose refusal was "no Column B benchmark resolves for it". That is now
// precisely the condition that stops a route being OFFERED at all: a route no one can
// ever price — not even from their own verified figures — is withheld rather than shown
// and refused. 72052100 lost (C) and (E) for exactly that reason and now offers
// ['(F)','(G)','(H)','(J)']. The fixture had to move to a route that is still offered.
const REFUSED_LINE: LineInput = { cn: '72052100', country: 'IN', route: '(G)', mass: '60', date: '2026-03-15' };

// Iron & steel from India on its one published route — an ORDINARY, priceable line
// that simply has no indirect side: the Commission charges this sector direct-only in
// the definitive period and publishes no electricity default for it. Deliberately not
// REFUSED_LINE above, which is also iron & steel but ALSO unpriceable, and would
// therefore confound "no indirect default" with "no direct default either".
//
// NOT '76011000'. That heading is not an offered good — the pack classifies
// '76011010', '76011090' and '76012030/40/80', never the heading itself, and
// isOfferedGood only falls back on 4- and 6-digit prefixes. It would answer `none`
// from the unknown-good guard while appearing to prove something about aluminium,
// and routesFor gives it no route at all, so syncScope's own `!!route.value` would
// have already failed before the lookup was ever consulted.
const NO_INDIRECT_LINE: LineInput = { cn: '72083800', country: 'IN', route: '(C)', mass: '30', date: '2026-03-15' };

// The design doc's §6 worked example: semi-finished iron/steel from India on route
// (C). Priced on BOTH tiers against the shipped pack, which is what makes it the one
// line that can demonstrate the delta — a good the Commission publishes no default
// for would show the "nothing to compare against" branch instead. The Commission
// default path gives €12,420.84; 2.31 tCO₂e/t verified gives €7,944.45.
const VERIFIED_LINE: LineInput = { cn: '72061000', country: 'IN', route: '(C)', mass: '100', date: '2026-03-15' };
const VERIFIED_DIRECT = '2.31';
const VERIFIED_REF = 'DNV-2026-0042';

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

test.describe('multi-line CBAM estimate — the emissions-scope control', () => {
  test('#cbScopeRow follows the good: shown for a good with a published indirect default, hidden for one without', async ({ page }) => {
    // THE ONE GATE ON syncScope's OPERATOR. `selectIndirectFactorFromPack` returns a TAGGED UNION
    // now — `{kind:'found'|'none'|'route-mismatch'}` — never null, so the `!== null` this line used
    // to carry is silently ALWAYS TRUE, and TypeScript accepts it without a murmur because
    // comparing a non-nullable against null is legal. `astro check` stays at its 2 pre-existing
    // errors with the defect fully present.
    //
    // Nothing else in the repo can catch it. The expression is a closure inside initCbam() reached
    // only through document.getElementById, and the unit suite is node:test + tsx with no DOM —
    // cbam-render.test.mjs pins the LOOKUP's tags (steel/aluminium answer `none`, cement answers
    // `found`) and says so in its own comment, but reverting this operator leaves all 380 unit
    // tests green. Only an assertion on what the user actually perceives — whether the control is
    // on screen — fails. That is this test.
    //
    // THE ORDER IS THE POINT, not incidental. #cbScopeRow ships `hidden` in the markup, so a bare
    // "steel hides it" assertion would pass against a page that never showed the control at all,
    // and would keep passing if syncScope stopped running entirely. Priced cement FIRST proves the
    // row genuinely toggles; the steel line then has to drive it back off. Under the reverted
    // operator the cement half still passes and the steel half fails — the defect is precisely
    // "shows it everywhere", never "hides it everywhere".
    await page.goto('/cbam/cbam-calculator/');

    // Algerian cement clinker on route (A): the Commission publishes a per-route electricity
    // default for it, so the scope control can genuinely change the answer — on 100 t, including
    // indirect adds 4.4 tCO₂e and €331.59 (71.465 certificates / €5,385.60 direct-only against
    // 75.865 / €5,717.19) — and must be offered. The 6.6 tCO₂e / €497.37 this comment used to
    // pair with it on "route (B)" is now a different GOOD, not a different route of this one:
    // 2523100010 (white) publishes (B), 2523100090 (grey) publishes (A), and after the TARIC
    // split no single cement code offers both. The per-route claim still holds across the pair.
    await setLine(page, GOOD_LINE);
    await expect(page.locator('#cbScopeRow')).toBeVisible();

    // Indian iron & steel: charged direct-only, no indirect default published at any route. The
    // engine returns 0 either way here, so a control that cannot change the answer is noise on a
    // form this dense — syncScope's own doc comment forbids exactly that.
    await setLine(page, NO_INDIRECT_LINE);
    await expect(page.locator('#cbScopeRow')).toBeHidden();
  });
});

test.describe('multi-line CBAM estimate — the net-mass gate', () => {
  test('a negative net mass prompts rather than pricing — and a blank one never reaches that gate', async ({ page }) => {
    // THE ONE GATE ON run()'s MASS CHECK. Like syncScope's operator above it, the check is a closure
    // inside initCbam() reached only through document.getElementById, and the unit suite is
    // node:test + tsx with no DOM in the dependency tree. cbam-lines.test.mjs pins the PREDICATE
    // exhaustively — nonNegativeDecimal is total over '0x10', '+100', '  100  ', '-100', '1_000',
    // '5.' — but nothing in that suite can see whether cbam-app.ts still CALLS it before pricing.
    // Delete the check and lean on the markup's `min="0"`, the exact move run()'s own comment warns
    // against, and all 386 unit tests stay green. Only an assertion on what the user actually
    // perceives fails. That is this test.
    //
    // WHAT IT CANNOT DO, stated so nobody assumes otherwise: it cannot tell
    // `nonNegativeDecimal(mass.value)` from the `Number(mass.value)` check that preceded it. Measured
    // in Chrome, not reasoned from the spec: #cbMass is <input type="number">, so value sanitisation
    // collapses EVERY string the two predicates disagree about — '0x10', '+100', '5.', '  100  ',
    // '1e400' and a 400-digit integer all become '' — and '' is then absorbed by run()'s completeness
    // guard one line ABOVE the mass gate. Over everything that survives the control the two
    // predicates are behaviourally identical; their difference is only reachable by constructing a
    // `Line` in code, which is exactly where cbam-lines.test.mjs pins it.
    //
    // METHODOLOGY TRAP, in the spirit of the header's: do NOT try to prove the hex case with
    // `page.fill('#cbMass', '0x10')`. fill() does not throw on a malformed number — it falls back to
    // typing, the UA drops the characters it will not take, and the field silently ends up holding
    // '010'. '+100' lands as '100', '5.' as '5'. A test written that way asserts a refusal the page
    // was never asked to make, and would keep passing with the gate deleted.
    await page.goto('/cbam/cbam-calculator/');

    // -500 t: the figure run()'s own comment records, reachable exactly as it describes. `min="0"` on
    // #cbMass is INERT here — there is no <form> and no submit, so constraint validation never runs,
    // while the `input` event fires anyway. Historically this rendered "-682 tCO₂e embedded" and a
    // confident "0 certificates · €0.00": nonsense wearing the shape of a computed answer.
    //
    // IT PINS THE UI LAYER OF A TWO-LAYER REFUSAL, and the distinction is worth stating because the
    // failure mode has moved. The same commit that put nonNegativeDecimal on this line re-vendored
    // the engine's own guard, so deleting the check here no longer prices a negative bill — measured
    // with it deleted, estimateFromPack refuses instead and the panel fills with the card-shaped "No
    // estimate / Missing rule mass/…" state. The two layers are independent: the engine's lives under
    // src/scripts/cbam-algos/ and is hash-guarded by scripts/cbam-sync-check.mjs, this one is not.
    // Asserting the terse field-level instruction, not merely the absence of a price, is what keeps
    // this test sensitive to the layer it is actually here to protect.
    await setLine(page, { ...GOOD_LINE, mass: '-500' });
    await expect(page.locator('#cbOut')).toContainText('Net mass must be a number of tonnes, zero or greater.');
    // The instruction has to REPLACE the figure, not sit above one. A card still on screen is a
    // priced answer to the user however the text over it reads, so the absence of money is the
    // second, independent witness — the one that would still fail if BOTH layers came out.
    await expect(page.locator('#cbOut')).not.toContainText('€');

    // THE BOUNDARY, asserted because the obvious version of this test gets it wrong. A blank mass
    // never reaches the gate above: `!mass!.value` in run()'s completeness guard catches it first and
    // names every unfilled field rather than singling out the mass. Pinning which prompt each path
    // renders is what stops the two guards being reordered, merged or deduplicated unnoticed.
    // The copy names the import date too, since the same guard now gates on it — hand-typed here
    // rather than imported from production, per this file's anti-paraphrase convention, which is
    // exactly why adding the date to run()'s gate had to update this line as well.
    await page.fill('#cbMass', '');
    await expect(page.locator('#cbOut')).toContainText('Choose a good, origin, route, mass and import date');
    await expect(page.locator('#cbOut')).not.toContainText('Net mass must be a number of tonnes');
  });
});

test.describe('multi-line CBAM estimate — the single-line threshold statement', () => {
  test('the PREVIEW names a year with no published threshold rule, and still says nothing for hydrogen', async ({ page }) => {
    // THE ONE GATE ON run()'s THRESHOLD SLOT. renderDraftThreshold is a pure function and
    // cbam-render.test.mjs enumerates all four of resolveThreshold's nulls against it directly —
    // but nothing in that suite can see whether run() still CALLS it. Revert this line to the
    // `t ? renderThreshold(t) : ''` it replaced and every unit test stays green; only an
    // assertion on what the user actually sees fails. That is this test.
    //
    // NO LINE IS ADDED anywhere below, deliberately. renderAll() only calls run() while
    // `lines.length === 0` — the moment a line exists it replaces #cbOut wholesale with the
    // per-year cards — so the preview is the ONLY surface these assertions can be reading, and
    // the per-year card (already pinned above, at '…named in the announcement, not just the
    // card') cannot stand in for it.
    await page.goto('/cbam/cbam-calculator/');

    // 2026: unchanged. The ordinary verdict card, pinned first so the assertions below are known
    // to be reading a preview that renders threshold cards at all.
    await setLine(page, GOOD_LINE);
    await expect(page.locator('.cb-thresh')).toContainText('Indeterminate');

    // 2027: the pack publishes one threshold row (2026), so this year resolves to null and the
    // card used to vanish with nothing in its place.
    await page.fill('#cbDate', '2027-03-15');
    await expect(page.locator('.cb-thresh')).toContainText('No published rule');
    await expect(page.locator('.cb-thresh')).toContainText('2027');
    // ADDED TO the refusal, never instead of it — and the refusal is exactly why the silence
    // mattered: it volunteers that the good and its benchmark are fine, so the only sentence on
    // screen that could have explained the missing de minimis verdict said nothing was wrong.
    await expect(page.locator('#cbOut')).toContainText('only the price is missing');

    // THE BOUNDARY, and the reason this fix is not simply "always show a card". Hydrogen is
    // outside the 50 t exemption (Reg (EU) 2025/2083), so an "indeterminate" card would imply an
    // exemption it cannot have — and it is not a hypothetical state: 28041000 from Algeria on
    // the single published route prices cleanly, so the user sees a real euro figure with no
    // threshold card beside it, which is correct. A fix that regressed this would show a card
    // here too, and this assertion is what refuses it.
    await setLine(page, { cn: '28041000', country: 'DZ', route: 'default', mass: '30', date: '2026-03-15' });
    await expect(page.locator('#cbOut')).toContainText('€');
    await expect(page.locator('.cb-thresh')).toHaveCount(0);
  });
});

test.describe('multi-line CBAM estimate — an import year the corpus does not cover', () => {
  test('the route control names the year, not the good and origin', async ({ page }) => {
    // WHAT ACTUALLY HAPPENS ON THIS PAGE FOR AN OUT-OF-CORPUS YEAR, measured rather than
    // reasoned: the engine's `default/<cn>/<origin>/<route>/<year>` refusal is NOT reachable
    // through the date field at all. #cbDate fires `change`, onPick runs syncRoutes, routesFor
    // filters on the reporting year and returns [], and the <select> is emptied and disabled — so
    // run()'s completeness guard sees route.value === '' and renders the idle prompt. The panel
    // never reaches estimateFromPack, and no misleading RULES sentence is shown there.
    //
    // The misleading sentence is on the ROUTE CONTROL instead. "no route published for this
    // pairing" is about the good and the origin (the branch above it says "Choose a good and
    // origin first"); the date is in no pairing. Outside a covered year it is false for every
    // pairing the form can build — measured through routesFor on the shipped pack, all 69,784
    // (572 goods x 122 origins) return [] at 2029, and every one of them publishes routes inside
    // 2026-2028 — so it sends the user to change the two controls that are not the problem.
    //
    // (This comment used to add "within a covered year it is true, and true for 46,686 of the
    // pack's 68,880 selectors". That was v1's corpus. Re-measured here: 0 of 69,784 at 2026 —
    // see the last block of this test.)
    //
    // syncRoutes is a closure inside initCbam(), so this is the only place its use of
    // noRouteReason can be observed; cbam-render.test.mjs pins the function itself.
    await page.goto('/cbam/cbam-calculator/');
    await setLine(page, GOOD_LINE);
    await expect(page.locator('#cbRoute')).toBeEnabled();

    // 2027 and 2028 ARE covered — the route list must survive, and the panel must still reach the
    // engine's own honest refusal about the certificate price. Asserted first so a fix that
    // simply refused every year but 2026 would fail here rather than look like a pass.
    await page.fill('#cbDate', '2027-06-15');
    await expect(page.locator('#cbRoute')).toBeEnabled();
    await expect(page.locator('#cbOut')).toContainText('only the price is missing');

    // 2029: outside the corpus. The old copy blamed the pairing.
    await page.fill('#cbDate', '2029-06-15');
    await expect(page.locator('#cbRoute')).toBeDisabled();
    await expect(page.locator('#cbRoute')).toContainText('no rules published for 2029');
    await expect(page.locator('#cbRoute')).not.toContainText('this pairing');

    // 0001, the year the brief chased — and the one a user reaches WITHOUT meaning to. Measured
    // in Chrome: retyping the year segment of an <input type="date"> commits 0002, 0020, 0202 and
    // then 2026, firing `change` at each step, so a user simply typing their year passes through
    // three out-of-corpus years on the way to a good one. The year is echoed back padded to four
    // digits, because that is what their date field is showing them.
    await page.fill('#cbDate', '0001-01-01');
    await expect(page.locator('#cbRoute')).toContainText('no rules published for 0001');

    // ...and a covered year still gets a NON-year sentence, which is the branch that must not be
    // lost in the fix: the year arm has to answer for the year and nothing else.
    //
    // THE WITNESS CHANGED BECAUSE THE CORPUS REMOVED THE OLD ONE, AND THE CLAIM CHANGED WITH IT.
    // This block used to assert the PAIRING sentence, on 25070080 (calcined clay) from Algeria —
    // "one of 15 of the pack's 574 goods with none for that origin". Re-measured through routesFor
    // over the shipped v2 pack, that is now 0 of 69,784 pairings (572 goods x 122 origins) at
    // 2026, 2027 and 2028: pack v2 ships a residual "OTHER third countries" row that every offered
    // good resolves against, so an empty route list at a covered year is not a state a user can
    // reach by choosing a good and an origin any more. The pairing arm is still the function's
    // correct answer for the state it names and cbam-render.test.mjs still pins it directly
    // ('an empty route list blames the year when the year is the reason, not the pairing', which
    // records the same 0-of-69,784 measurement) — it simply has no live UI witness left, and an
    // e2e assertion is the wrong place to keep pretending it has one.
    //
    // 25070080 STAYS, because the corpus gave it a better job. It is one of exactly three 8-digit
    // stems the TARIC re-key stranded (25070080, 25231000, 25239000), so at a covered year it now
    // reaches the code-too-short arm — the sentence that names the deeper codes instead of blaming
    // the pairing. That is a live user path: it is what an importer typing the code off their own
    // customs paperwork sees. The block still proves exactly what it was here to prove, that a
    // covered year is not answered with "no rules published".
    await page.fill('#cbDate', '2026-03-15');
    await page.fill('#cbCn', '25070080');
    await page.dispatchEvent('#cbCn', 'change');
    await expect(page.locator('#cbRoute')).toContainText(
      'no value is published at 25070080 — the Commission publishes at 2507008080');
    await expect(page.locator('#cbRoute')).not.toContainText('no rules published');
    await expect(page.locator('#cbRoute')).not.toContainText('this pairing');
  });

  test('a route chosen on a multi-route good survives a trip through an uncovered year', async ({ page }) => {
    // THE PICK USED TO BE DESTROYED ON THE WAY OUT, not on the way back. syncRoutes reads the
    // current pick from `route.value` and hands it to nextRoute so a still-published route
    // survives a rebuild — but when the list comes back EMPTY it replaces innerHTML with the one
    // explanatory option and returns, which sets `route.value` to ''. By the time the user fixes
    // the year, there is nothing left to restore, and nextRoute correctly declines to guess.
    //
    // Only MULTI-ROUTE goods lose anything, which is why this hid: nextRoute auto-selects when a
    // good publishes exactly one route, so single-route lines self-heal and look fine.
    //
    // THE WITNESS MOVED FROM CEMENT TO ALUMINIUM, AND IT HAD TO. This test used to run on
    // 25231000/DZ, which published (A) and (B). The TARIC re-key split that good in two and gave
    // each half one route, so cement offers no choice to remember any more — run against
    // GOOD_LINE now, `#cbRoute option[value="(B)"]` never appears and setLine times out.
    // MULTI_ROUTE_LINE (76011010/DZ, routes (K) and (L)) is the same shape of case: several
    // published routes, both priceable, so a pick is a real user decision the rebuild can lose.
    //
    // And it is reached by TYPING, not by pasting: committing a year digit-by-digit in an
    // <input type="date"> fires `change` at 0002, 0020 and 0202 before 2026, so a user entering
    // their own year passes through three uncovered years — the first of which already wiped it.
    await page.goto('/cbam/cbam-calculator/');
    await setLine(page, MULTI_ROUTE_LINE);
    await expect(page.locator('#cbRoute')).toHaveValue('(L)');
    await expect(page.locator('#cbOut')).toContainText('tCO');

    await page.fill('#cbDate', '0001-01-01');
    await expect(page.locator('#cbRoute')).toBeDisabled();

    await page.fill('#cbDate', '2026-03-15');
    await expect(page.locator('#cbRoute')).toBeEnabled();
    await expect(page.locator('#cbRoute')).toHaveValue('(L)');
    // The panel prices again on its own — the user should not have to re-pick a route they never
    // un-picked. Without the fix this sits on the idle prompt with the route control empty.
    await expect(page.locator('#cbOut')).toContainText('tCO');

    // The restore must not INVENT a pick: a remembered '(L)' must not be resurrected onto a good
    // that never offered it. nextRoute's `published.includes(previous)` is what holds this, and it
    // has to keep holding now that `previous` can come from memory rather than from the live
    // control. 72051000/DZ publishes (C) and (F) — neither of them (L) — so nextRoute must return
    // '' and syncRoutes must fall back to the disabled placeholder.
    //
    // THE TARGET MUST ITSELF BE MULTI-ROUTE, which the old version of this block got wrong even on
    // the corpus it was written for. It switched to 25070080, a good with NO routes: that takes
    // syncRoutes' `if (!rs.length)` early return, which replaces the whole <select> and never calls
    // nextRoute at all. So the assertion could not have failed if `published.includes(previous)`
    // were deleted — it was pinning the empty-list branch under that line's name. A multi-route
    // target with the pick absent is the state that actually reaches the guard: measured, deleting
    // the `includes` check leaves '(L)' selected here and this block goes red.
    await page.fill('#cbCn', '72051000');
    await page.dispatchEvent('#cbCn', 'change');
    await expect(page.locator('#cbRoute')).toBeEnabled();
    await expect(page.locator('#cbRoute')).toContainText('Select a production route…');
    await expect(page.locator('#cbRoute')).not.toHaveValue('(L)');
    await expect(page.locator('#cbRoute')).toHaveValue('');
  });
});

test.describe('multi-line CBAM estimate — the verified tier', () => {
  test('the whole verified flow: reveal the panel, refuse a half-made claim, attest, and carry the claim into the CSV', async ({ page }) => {
    // Every unit test around this feature calls parseVerifiedFields / renderLineCard / csvRows
    // DIRECTLY. Nothing until now proved the form actually reaches them: that #cbTier reveals the
    // panel, that a missing tick stops the Add rather than quietly pricing at the wrong tier, and
    // that the tier and reference survive all the way out to the exported file. This is the one
    // test that walks the path an importer actually walks.
    await page.goto('/cbam/cbam-calculator/');
    await setLine(page, VERIFIED_LINE);

    // 1. The panel is revealed by the tier control, not present from the start — the defaults
    //    path must not ask an importer for figures they are not claiming.
    const panel = page.locator('#cbVerifiedRow');
    await expect(panel).toBeHidden();
    await page.selectOption('#cbTier', 'actual-verified');
    await expect(panel).toBeVisible();

    // 2. A figure without the attestation is a half-made claim, and Add must REFUSE it. This is
    //    the tool's central rule: it transcribes an attested claim, so an unattested figure has
    //    nothing to transcribe. The refusal must also SAY which field is missing — #cbStatus is
    //    the only channel a screen-reader user has here.
    await page.fill('#cbSeeDirect', VERIFIED_DIRECT);
    await expect(page.locator('#cbAttest')).not.toBeChecked();
    await page.click('#cbAdd');
    await expect(page.locator('.cb-line')).toHaveCount(0);
    await expect(page.locator('#cbStatus')).toContainText('Tick the attestation');
    // ...and the button is released again, so the refusal is recoverable rather than terminal.
    await expect(page.locator('#cbAdd')).toBeEnabled();

    // 3. Tick it, cite a reference, and the same click now commits the line.
    await page.check('#cbAttest');
    await page.fill('#cbRef', VERIFIED_REF);
    await page.click('#cbAdd');
    await expect(page.locator('.cb-line')).toHaveCount(1);

    const card = page.locator('.cb-line');
    // The provenance row states WHICH corpus priced the line...
    await expect(card).toContainText('Verified actual');
    // ...and the attestation paragraph states WHOSE claim the number is, plus the reference as
    // transcribed. The two are complementary, not duplicates (renderLineCard's own doc).
    await expect(card).toContainText('your own attested claim');
    await expect(card).toContainText('This tool has not confirmed them');
    await expect(card).toContainText(`Ref: ${VERIFIED_REF}`);
    // The pinned arithmetic, both figures on screen: the verified estimate, and the Commission
    // default it is measured against. "saves" — this line's verified figure really is the
    // cheaper one, and the card must say so in that direction (the "adds" direction is covered
    // by the unit tests, which can reach a producer dirtier than the marked-up default).
    await expect(card).toContainText('€7,944.45');
    await expect(card).toContainText('The Commission default would give €12,420.84');
    await expect(card).toContainText('your verified data saves €4,476.39');

    // 4. The claim reaches the exported file — the artefact that leaves the browser. A tier that
    //    were lost here would export a verified line indistinguishable from a Commission-priced
    //    one, which is precisely the mark-up-skipping row an auditor needs to be able to find.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#cbCsv'),
    ]);
    const filePath = await download.path();
    if (!filePath) throw new Error('download produced no local file path');
    const [headerLine, ...rowLines] = readFileSync(filePath, 'utf8').trim().split('\n');
    const header = parseCsvRow(headerLine!);
    expect(header).toContain('data_tier');
    expect(header).toContain('verified_reference');
    const row = parseCsvRow(rowLines[0]!);
    expect(row[header.indexOf('data_tier')]).toBe('actual-verified');
    expect(row[header.indexOf('verified_reference')]).toBe(VERIFIED_REF);
  });

  test('switching tier away and back keeps the typed claim, but never keeps an indirect figure behind a hidden row', async ({ page }) => {
    // THE PANEL-CLEARING ASYMMETRY, which has no unit coverage at all: syncVerifiedRows is a
    // closure over the form's own elements, so it cannot be imported and called — only driven.
    //
    // #cbTier has exactly two options, and a CLOSED <select> fires `change` on every arrow step,
    // so ↓ then ↑ is one keystroke pair a keyboard user performs by accident. Destroying the
    // panel on that round trip would silently delete a typed figure, a ticked attestation and a
    // verifier reference, with no undo — and buy nothing, since parseVerifiedFields returns on
    // the tier alone and reads no other field on the defaults branch.
    await page.goto('/cbam/cbam-calculator/');
    await setLine(page, VERIFIED_LINE);
    await page.selectOption('#cbTier', 'actual-verified');
    await expect(page.locator('#cbVerifiedRow')).toBeVisible();

    await page.fill('#cbSeeDirect', VERIFIED_DIRECT);
    await page.check('#cbAttest');
    await page.fill('#cbRef', VERIFIED_REF);

    // The one field that IS destroyed, seeded through the DOM rather than typed: #cbSeeIndirect
    // sits behind #cbSeeIndirectRow, which this good never shows (the Commission publishes no
    // indirect default for 72061000), so no click can fill it here. That is exactly the state
    // the guard exists for — a figure typed for a good that HAD an indirect side, stranded when
    // the good changed. On the verified path the engine adds that number on scope alone, with no
    // pack lookup to fall back on, so a value the user can no longer see would keep inflating
    // every later estimate. Fail closed: it must not survive.
    await page.evaluate(() => {
      (document.getElementById('cbSeeIndirect') as HTMLInputElement).value = '0.4';
    });

    // The arrow-step round trip, through the real control both ways.
    await page.selectOption('#cbTier', 'default+markup');
    await expect(page.locator('#cbVerifiedRow')).toBeHidden();
    await page.selectOption('#cbTier', 'actual-verified');
    await expect(page.locator('#cbVerifiedRow')).toBeVisible();

    // Three survive — the user's work is still there, exactly as typed.
    await expect(page.locator('#cbSeeDirect')).toHaveValue(VERIFIED_DIRECT);
    await expect(page.locator('#cbAttest')).toBeChecked();
    await expect(page.locator('#cbRef')).toHaveValue(VERIFIED_REF);
    // One does not — and the line still prices, from the direct figure alone.
    await expect(page.locator('#cbSeeIndirect')).toHaveValue('');
    await page.click('#cbAdd');
    await expect(page.locator('.cb-line')).toHaveCount(1);
    await expect(page.locator('.cb-line')).toContainText('€7,944.45');
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
    //
    // The delay is SWITCHABLE, and that matters. Slowing every digest for the whole test also
    // slowed the final sequential add, which needs no widened window — it just has to add a
    // line. That is the assertion that was timing out on CI (and only on CI: it passed locally,
    // which is exactly the margin this comment warned about before). Raising its budget again
    // would have bought silence, not correctness. The switch removes the cause instead: the
    // race window is still genuinely widened where the race is, and nowhere else.
    await page.addInitScript(() => {
      const real = crypto.subtle.digest.bind(crypto.subtle);
      (window as unknown as { __slowDigest: boolean }).__slowDigest = true;
      crypto.subtle.digest = (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> =>
        (window as unknown as { __slowDigest: boolean }).__slowDigest
          ? new Promise((resolve, reject) => {
              setTimeout(() => { real(algorithm, data).then(resolve, reject); }, 1000);
            })
          : real(algorithm, data);
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
    //
    // The digest delay is switched off first. Every assertion that needed it has already run;
    // this one only needs a real click to produce a real second line. The pack-v2 port put more
    // digests on this path — loadPack verifies the served bytes against the bundled manifest,
    // and packSnapshotHash covers the pack's contents rather than only its metadata — so at
    // 1000 ms a call this step alone carried several seconds of injected latency for no
    // assertional purpose. Off, it runs at native speed and needs no raised budget.
    await page.evaluate(() => {
      (window as unknown as { __slowDigest: boolean }).__slowDigest = false;
    });

    // REFILLED, not re-clicked bare. onAdd clears the form on success — the CI failure snapshot
    // caught it mid-reset, with origin back to "Select origin…", #cbRoute disabled, and #cbStatus
    // reading "Complete the line first: good, origin, route, a non-negative mass and a valid
    // import date." A bare second click was therefore racing the reset: it won locally and lost
    // on a slower runner, which is why this test failed on CI while passing on every developer
    // machine. Refilling is also what the claim actually describes — a second shipment is a
    // second line the user enters, not a button pressed twice.
    //
    // Refilling unconditionally rather than waiting for the reset to finish, because the reset is
    // NOT observable the same way on both machines: locally #cbRoute stays enabled after a
    // successful add, so a wait for it to disable hangs (measured — it failed 12/12). setLine
    // re-establishes every field from scratch and waits on the country option being attached, so
    // it is correct whether the reset has landed, is mid-flight, or never clears this control.
    await setLine(page, GOOD_LINE);
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

  test('a cleared import date refuses both surfaces rather than pricing year 0', async ({ page }) => {
    // THE DEFECT: syncRoutes reads the year as `Number(date.value.slice(0, 4)) || 2026`. An empty
    // field gives Number('') === 0 — falsy — so it falls back to 2026 and offers routes, and
    // nextRoute auto-selects for a single-route good. run()'s gate never looked at the date, so
    // estimateFromPack got `date: ''`, the engine's year was 0, no published row is keyed on 0,
    // and the panel rendered a rule-refusal over a line whose only problem was a blank date.
    //
    // WHAT THIS TEST ACTUALLY PINS, stated precisely because the obvious reading overclaims.
    // run()'s half is load-bearing: revert `!date!.value` there alone and the 'import date'
    // assertion below goes red. draftLine()'s half is NOT — revert it alone and this test stays
    // green, because `Number.isNaN(yearOf(l))` further down draftLine already refused every
    // cleared date the form can produce. Only removing BOTH adds a blank-dated line (measured:
    // it does, and the .cb-line assertion catches it). So the ADD path was never pricing year 0;
    // it was refusing silently, with no draftReason, while the PREVIEW refused loudly and wrongly.
    // The date in draftLine's gate is there to keep the two gates textually identical, which is
    // that function's own stated rule — not because this test can hold it there.
    //
    // This is the only place either gate can be reached: both are closures inside initCbam(),
    // reachable only through document.getElementById, so the unit suite cannot see them at all.
    await page.goto('/cbam/cbam-calculator/');
    await setLine(page, GOOD_LINE);
    await expect(page.locator('#cbOut')).toContainText('tCO');

    await page.fill('#cbDate', '');

    // run(): the PREVIEW path must go idle, and must not name a rule the date is not the reason for.
    await expect(page.locator('#cbOut')).toContainText('import date');
    // WHICH refusal shipped depends on the TIER, measured through estimateFromPack rather than
    // assumed: on THIS line (default+markup) a cleared date refused on `default/2523100090/DZ/(A)/0`
    // — "The Commission publishes no default value for this good, origin, production route or
    // year" — because the defaults lookup is keyed on year and runs first. `cbam-factor/0` and its
    // "free-allocation factor schedule" sentence are the VERIFIED tier's version of the same bug,
    // where the defaults lookup is skipped. Both are asserted: the first is the one this line can
    // actually produce, the second would fire if the line or the tier ever changed.
    await expect(page.locator('#cbOut')).not.toContainText('The Commission publishes no default value');
    await expect(page.locator('#cbOut')).not.toContainText('free-allocation factor schedule');
    await expect(page.locator('#cbOut')).not.toContainText('tCO');

    // draftLine(): the ADD path must refuse too, and the two must agree.
    const before = await page.locator('.cb-line').count();
    await page.click('#cbAdd');
    await expect(page.locator('.cb-line')).toHaveCount(before);

    // ...and restoring a date brings both back, so the gate is not simply always-closed.
    await page.fill('#cbDate', '2026-03-15');
    await expect(page.locator('#cbOut')).toContainText('tCO');
    await page.click('#cbAdd');
    await expect(page.locator('.cb-line')).toHaveCount(before + 1);
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

test.describe('multi-line CBAM estimate — the widened route list', () => {
  test('a good with three published routes offers all three, and none it cannot price', async ({ page }) => {
    // routesFor used to keep only routes with a published DEFAULT value, so this good offered
    // (C) alone while the engine prices (D) and (E) perfectly well from the user's own verified
    // figures. Worse, (C) carried the LARGEST free-allocation deduction of the three — 64.42
    // certificates against 148.66 and 187.37 — so the one reachable route under-charged.
    //
    // Asserted through the real form because the dropdown is what a user meets; the engine-level
    // list is pinned separately in the unit suite.
    // Deliberately NOT setLine(): that helper selects a route, and this test is about what the
    // control offers BEFORE one is chosen. Passing route: '' to it hangs on the disabled
    // placeholder option.
    await page.goto('/cbam/cbam-calculator/');
    await page.fill('#cbCn', '72061000');
    await page.dispatchEvent('#cbCn', 'change');
    await page.fill('#cbDate', '2026-03-15');
    await expect(page.locator('#cbCountry option[value="IN"]')).toBeAttached();
    await page.selectOption('#cbCountry', 'IN');
    await expect(page.locator('#cbRoute')).toBeEnabled();
    for (const route of ['(C)', '(D)', '(E)']) {
      await expect(page.locator(`#cbRoute option[value="${route}"]`)).toBeAttached();
    }
    // (K) is an aluminium route. No benchmark resolves for it on a steel good, so no figure
    // could ever be produced — it is withheld rather than offered and refused.
    await expect(page.locator('#cbRoute option[value="(K)"]')).toHaveCount(0);
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
