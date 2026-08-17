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

// Iron & steel from India on its one published route — an ORDINARY, priceable line
// that simply has no indirect side: the Commission charges this sector direct-only in
// the definitive period and publishes no electricity default for it. Deliberately not
// REFUSED_LINE above, which is also iron & steel but ALSO unpriceable, and would
// therefore confound "no indirect default" with "no benchmark at all".
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
    // default for it, so the scope control can genuinely change the answer (6.6 tCO₂e / €497 on
    // route (B), 4.4 / €332 on route (A)) and must be offered.
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
    // assumed: on THIS line (default+markup) a cleared date refused on `default/25231000/DZ/(A)/0`
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
