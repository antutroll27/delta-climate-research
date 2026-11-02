# CBAM audit fixes (phase 0) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five site-side defects from `docs/research/2026-11-02-cbam-audit.md` on **today's** calculator UI: H1, C2, H2, M2 and M3. This ships before the rail redesign (roadmap phase 0).

**Architecture:** Every fix lives in our own files: `cbam-app.ts`, `cbam-lines.ts`, `cbam-graphs.ts`, `cbam-outlook.ts` and the page. **No vendored engine file changes** (`UPSTREAM.json`); C1 and C3 are fixed upstream in CBM. Each fix is test-first: a unit test where the logic is pure, and an e2e test where only the page can show it.

**Tech stack:** TypeScript, Decimal.js, `node --test` via tsx, Playwright.

**Out of scope, deliberately:**
- C1 and C3 (upstream).
- H3 (it needs a legal read first).
- M1 (sync-check hardening).
- The Low items and the test-gap items. The roadmap carries those, and the audit's "Suggested order" step 3 covers the tests.

> **Environment notes (measured 2 Nov 2026):** macOS has no `timeout` command, so run Playwright in the foreground through the Bash tool's own timeout. The Chromium project is `chromium-tier0`; there is no `chromium`. `npm run test:unit` must run **after** `npm run build`, because about 59 OBOS and heat-map unit tests read `dist/`.

---

## What each fix is, measured against today's code (origin/main `1805afb`)

| Id | Defect | Root cause | Fix |
|---|---|---|---|
| **H1** | `0,85` in a number field becomes `085`, and the figure goes up tenfold | `#cbMass`, `#cbSeeDirect` and `#cbSeeIndirect` are `type="number"`, and the browser sanitises the string. The verified gate parses with `Number()` (`verifiedFigure`, cbam-app.ts:1577) rather than the engine's parser | Make the three fields `type="text" inputmode="decimal"`. One classifier, `decimalProblem()`, wraps the engine's `parseNonNegativeDecimal`; a comma is refused **by name**; both gates use the classifier. The mass is trimmed before it is stored |
| **C2** | A year ruled below the threshold still shows its lines in "Total exposure" | `sumTotals` takes every priced line (cbam-app.ts:2745; print document at :3020) | `exemptLineIds(years)` returns the ids counted in an attested `below_threshold` year's basis. Those lines are summed **separately** and shown as "Exempt if your list is complete", outside the total. Hydrogen and electricity lines are never in a basis, so they stay owed |
| **H2** | The dot chart draws `mass/unit` dots with no cap: 11,340 dots at 1e10 t, and an out-of-memory crash at 1e15 | `cascadeUnit` tops out at 1e7, and its fallback is a constant (cbam-graphs.ts:535) | The unit becomes the smallest power of ten that keeps the tallest column ≤ 52 dots, for any finite max; every column is clamped to ≤ 52 and NaN goes to 0 |
| **M2** | 2027/28 wording calls the certificate price per-quarter | Two sentences attribute the **price** to the quarter: cbam-outlook.ts:679 and cbam-graphs.ts:954 | Both now say "the import's date". The quarter stays where it names the period the import falls in, as the earlier decision in cbam-render.test.mjs ("The quarter may appear only as the period the import falls in") intends |
| **M3** | With no rules for the year (e.g. a 2029 date), the reason sits only inside a disabled `<select>`, and the live region tells a user who filled everything to "Choose a good, origin, route…" | `syncRoutes` writes the reason into an `<option>` only. `runPreview`'s first gate sees `route.value === ''` | `syncRoutes` records the reason, and `runPreview` renders "No estimate: <reason>." in `#cbOut` (the live region) |

---

### Task 0: Worktree

- [ ] **Step 1:** Create the worktree and branch, then get a baseline.

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad && git fetch origin
git worktree add -b fix/cbam-audit-p0 /Volumes/OBOSLab/worktrees/cbam-p0 origin/main
cd /Volumes/OBOSLab/worktrees/cbam-p0 && npm ci && npm run check && npm run test:unit 2>&1 | tail -4
```

Expected: everything passes. Record `# pass N`.

---

### Task 1: H1, text decimal fields with one parser

**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro` (three inputs)
- Modify: `src/scripts/cbam-algos/cbam-app.ts`:
  - the `parseNonNegativeDecimal` import;
  - delete `verifiedFigure`;
  - add `decimalProblem`, `COMMA_HINT` and `massRefusal`;
  - change `parseVerifiedFields`, `runPreview`'s mass gate and `draftLine`'s mass gate.
- Test: `tests/unit/cbam-render.test.mjs` (append), `tests/e2e/cbam-lines.spec.ts` (append)

- [ ] **Step 1: Failing unit tests.** Append them to `tests/unit/cbam-render.test.mjs`, and add `decimalProblem, massRefusal` to its existing import from `cbam-app.ts`:

```js
/* ── H1 (audit 2026-11-02): a decimal comma is refused by name, never silently re-read ── */

test('H1: decimalProblem classifies with the engine parser', () => {
  assert.equal(decimalProblem('0.85'), null);
  assert.equal(decimalProblem(' 2.31 '), null, 'the engine trims; so does this');
  assert.equal(decimalProblem('0'), null);
  assert.equal(decimalProblem('0,85'), 'comma');
  assert.equal(decimalProblem('1,000'), 'comma', 'a thousands separator is a comma too');
  assert.equal(decimalProblem('-1'), 'negative');
  for (const bad of ['0x10', '+100', '5.', '1_000', 'Infinity', 'abc']) {
    assert.equal(decimalProblem(bad), 'unreadable', bad);
  }
});

test('H1: a comma in the verified direct figure is refused, naming the comma', () => {
  const r = parseVerifiedFields(vf({ direct: '0,85' }));
  assert.equal(r.ok, undefined, '0,85 must never become a priceable 85 or 085');
  assert.match(r.error, /decimal point/);
  assert.match(r.error, /0\.85, not 0,85/);
});

test('H1: a comma in the verified indirect figure is refused, naming the comma', () => {
  const r = parseVerifiedFields(vf({ indirect: '0,4' }));
  assert.equal(r.ok, undefined);
  assert.match(r.error, /indirect/i);
  assert.match(r.error, /decimal point/);
});

test('H1: the verified gate reads what the engine reads (A5): hex is refused, not priced as 16', () => {
  const r = parseVerifiedFields(vf({ direct: '0x10' }));
  assert.equal(r.ok, undefined);
  assert.match(r.error, /is not one/);
});

test('H1: the mass refusal names the comma, or keeps its existing sentence', () => {
  assert.equal(massRefusal('100'), null);
  assert.match(massRefusal('2,5'), /decimal point/);
  assert.equal(massRefusal('-5'), 'Net mass must be a number of tonnes, zero or greater.');
  assert.equal(massRefusal('0x10'), 'Net mass must be a number of tonnes, zero or greater.');
});
```

`vf` is the file's existing helper for `parseVerifiedFields` input. Confirm it with `grep -n "const vf" tests/unit/cbam-render.test.mjs`; it must default the panel to the verified tier, attested, with `direct: '2.31'`. If its defaults differ, pass the missing fields explicitly in the tests above. **Do not change `vf`.**

- [ ] **Step 2:** Run `node --import tsx --test tests/unit/cbam-render.test.mjs 2>&1 | tail -8`. Expected: FAIL, because `decimalProblem` is not exported.

- [ ] **Step 3: Implement in `cbam-app.ts`.**
  - Change line 34 to `import { parseNonNegativeDecimal, parseRegulatoryDate } from './cbam/input.ts';`.
  - Replace `function verifiedFigure` and its doc comment with:

```ts
/**
 * H1 (audit 2026-11-02). The three figure fields are type="text" inputmode="decimal", because
 * type="number" re-read '0,85' as '085' in Chromium and priced 8,500 tCO₂e beside "transcribed
 * exactly as entered". So every figure field is now read by the ENGINE's own parser and nothing
 * else: what this accepts is exactly what the engine prices. The comma is the one mistake common
 * enough to name: it is the decimal mark in most of the exporting world, and a thousands separator
 * in the rest.
 */
export type DecimalProblem = 'comma' | 'negative' | 'unreadable';
export function decimalProblem(text: string): DecimalProblem | null {
  const parsed = parseNonNegativeDecimal(text);
  if (parsed.ok) return null;
  if (text.includes(',')) return 'comma';
  return parsed.code === 'NEGATIVE_NUMBER' ? 'negative' : 'unreadable';
}

export const COMMA_HINT = 'Use a decimal point and no thousands separators: 0.85, not 0,85, and 1000, not 1,000.';

/** The mass field's refusal, shared by the preview and the Add path so the two say one thing. */
export function massRefusal(text: string): string | null {
  const p = decimalProblem(text);
  if (p === null) return null;
  return p === 'comma' ? `Net mass: ${COMMA_HINT}` : 'Net mass must be a number of tonnes, zero or greater.';
}
```

  - In `parseVerifiedFields`, replace the block from `const d = verifiedFigure(direct);` through the indirect `if (i < 0) { … }` block with:

```ts
  const dp = decimalProblem(direct);
  if (dp === 'comma') return { error: `Verified direct emissions: ${COMMA_HINT}` };
  if (dp === 'unreadable') {
    return { error: `Verified direct emissions must be a number of tCO₂e per tonne — `
      + `“${direct}” is not one.` };
  }
  if (dp === 'negative') {
    return { error: 'Verified direct emissions cannot be negative — enter zero if the '
      + 'verified figure really is nil.' };
  }

  if (indirect) {
    const ip = decimalProblem(indirect);
    if (ip === 'comma') return { error: `Verified indirect emissions: ${COMMA_HINT}` };
    if (ip === 'unreadable') {
      return { error: `Verified indirect emissions must be a number of tCO₂e per tonne — `
        + `“${indirect}” is not one. Leave the field empty if you are not claiming one.` };
    }
    if (ip === 'negative') {
      return { error: 'Verified indirect emissions cannot be negative — enter zero, or leave '
        + 'the field empty if you are not claiming one.' };
    }
  }
```

  - In `runPreview`, replace `if (!nonNegativeDecimal(mass!.value)) { out!.innerHTML = '<p class="cb-idle">Net mass must be a number of tonnes, zero or greater.</p>'; return null; }` with:

```ts
    const massProblem = massRefusal(mass!.value);
    if (massProblem) {
      out!.innerHTML = `<p class="cb-idle">${esc(massProblem)}</p>`;
      return null;
    }
```

    and in the `input` object below it, change `massT: mass!.value` to `massT: mass!.value.trim()`.
  - In `draftLine`, replace `if (!nonNegativeDecimal(mass!.value)) return null;` with:

```ts
    const massProblem = massRefusal(mass!.value);
    if (massProblem) { draftReason = massProblem; return null; }
```

    and in the `Line` literal, change `massT: mass!.value` to `massT: mass!.value.trim()`. Text fields admit surrounding spaces, so the line's fingerprint and the CSV must not carry them.
  - Run `grep -n "nonNegativeDecimal" src/scripts/cbam-algos/cbam-app.ts`. If the import is now unused (only the import line hits), drop it from the import list. **Grep for every remaining caller first.**

- [ ] **Step 4: The markup.** In `cbam-calculator.astro`:
  - replace `type="number" min="0" step="any"` on `#cbSeeDirect`, `#cbSeeIndirect` and `#cbMass` with `type="text" inputmode="decimal" autocomplete="off" spellcheck="false"`;
  - keep `value="100"` on `#cbMass`;
  - under the mass input, add `<p class="cb-hint">Use a decimal point: 0.85, not 0,85.</p>`.

  Grep the old attributes to confirm three hits before and zero after: `grep -c 'type="number"' src/pages/cbam/cbam-calculator.astro`.

- [ ] **Step 5: Update the comments that are now false.**
  - The e2e comment at `tests/e2e/cbam-lines.spec.ts`, "#cbMass is <input type="number">, so value sanitisation collapses EVERY string…", and the "METHODOLOGY TRAP" paragraph after it, describe the old control. Replace both with one sentence: since H1 (audit 2026-11-02) the field is text, so `'0x10'`, `'+100'` and `'2,5'` now reach the gate, and the tests below assert they are refused.
  - Make the same change to the comment in `cbam-render.test.mjs`'s Infinity test: "sanitises the string away in a browser" is no longer true. The field is text, so Infinity is reachable, and this test is what holds it.

- [ ] **Step 6: Failing e2e.** Append to the describe block that holds the `-500` test in `cbam-lines.spec.ts`:

```ts
  test('H1: a decimal comma is refused by name, and nothing is priced', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await setLine(page, { ...GOOD_LINE, mass: '2,5' });
    await expect(page.locator('#cbOut')).toContainText('Use a decimal point');
    await expect(page.locator('#cbOut')).not.toContainText('€');
    for (const bad of ['0x10', '+100', '1_000']) {
      await page.fill('#cbMass', bad);
      await expect(page.locator('#cbOut')).toContainText('Net mass must be a number of tonnes, zero or greater.');
    }
    await page.fill('#cbMass', '  100  ');
    await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
  });

  test('H1: a decimal comma in the verified direct figure is refused, never re-read as 085', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await setLine(page, VERIFIED_LINE);
    await page.selectOption('#cbTier', 'actual-verified');
    await page.fill('#cbSeeDirect', '0,85');
    await page.check('#cbAttest');
    await expect(page.locator('#cbOut')).toContainText('Verified direct emissions: Use a decimal point');
    await expect(page.locator('#cbOut')).not.toContainText('€');
  });
```

- [ ] **Step 7:** Run `npm run check && npm run test:unit`. Expected: all pass, including the 5 new tests. Then:

```bash
npm run build && npx playwright test tests/e2e/cbam-lines.spec.ts --project=chromium-tier0 --reporter=line
```

Expected: all pass. If an existing test fails, read it and decide whether it pinned the old control's behaviour (update the comment and expectation, and say so in the commit) or a real regression (fix the code).

- [ ] **Step 8: Commit.**

```bash
git add -- src/pages/cbam/cbam-calculator.astro src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-render.test.mjs tests/e2e/cbam-lines.spec.ts
git commit -m "fix(cbam): H1 — figure fields are text read by the engine's parser; a decimal comma is refused by name"
```

---

### Task 2: C2, exempt years leave the total

**Files:**
- Modify: `src/scripts/cbam-lines.ts` (add `exemptLineIds`)
- Modify: `src/scripts/cbam-algos/cbam-app.ts`:
  - `renderTotals` gains an `exempt` parameter;
  - `renderAll` and the `#cbStatus` summary;
  - `onDoc`'s `buildPrintDocument` call and the totals paragraph in `buildPrintDocument`.
- Test: `tests/unit/cbam-lines.test.mjs`, `tests/unit/cbam-render.test.mjs`, `tests/e2e/cbam-lines.spec.ts`

**The legal shape.** Art 2a exempts an importer whose eligible mass in the four sectors (cement, aluminium, fertilisers, iron & steel) does not exceed 50 t in the year. That covers **only the goods counted in that basis**; hydrogen and electricity are outside it. `thresholdByYear` already lists exactly those lines in `entryIds`, and gives `state: 'below_threshold'` only when the user has attested the list complete. So the exempt set is exactly that list.

- [ ] **Step 1: Failing unit test** (`tests/unit/cbam-lines.test.mjs`; add `exemptLineIds` to the import from `cbam-lines.ts`):

```js
test('C2: exemptLineIds is the basis of attested below-threshold years, and nothing else', () => {
  const steel = { ...LINE_BASE, id: 'steel', cn: '72061000', country: 'IN', route: '(C)', massT: '30', date: '2026-03-15' };
  const h2 = { ...LINE_BASE, id: 'h2', cn: '28041000', country: 'IN', route: 'default', massT: '1000', date: '2026-04-01' };
  const fps = new Map([['steel', 'a'.repeat(64)], ['h2', 'b'.repeat(64)]]);
  const attested = thresholdByYear([steel, h2], fps, new Set([2026]), pack);
  assert.deepEqual([...exemptLineIds(attested)], ['steel'], 'hydrogen is outside the basis and stays owed');
  const unattested = thresholdByYear([steel, h2], fps, new Set(), pack);
  assert.deepEqual([...exemptLineIds(unattested)], [], 'not attested is indeterminate, never exempt');
  const big = { ...steel, massT: '60' };
  assert.deepEqual([...exemptLineIds(thresholdByYear([big], fps, new Set([2026]), pack))], [], 'above threshold is owed');
});
```

`LINE_BASE` and `pack` must be the file's existing fixtures: run `grep -n "^const .*= {" tests/unit/cbam-lines.test.mjs | head` and use the existing base `Line` object's name. Before writing the test, confirm with a one-off `routesFor(pack, '28041000', 'IN', 2026)` that `28041000` is a hydrogen code the pack offers, and use its real route. If it is not offered, pick the first hydrogen code that is (`sectorForCn(code) === 'hydrogen'`). **Measure; do not assume.**

- [ ] **Step 2:** Run `node --import tsx --test tests/unit/cbam-lines.test.mjs 2>&1 | tail -5`. Expected: FAIL (`exemptLineIds` is not exported).

- [ ] **Step 3: Implement** in `cbam-lines.ts`, directly after `thresholdByYear`:

```ts
/**
 * C2 (audit 2026-11-02): the lines a year's de minimis verdict exempts, so the total can leave
 * them out. Only a year the user ATTESTED complete can be `below_threshold` (evaluateThreshold
 * returns 'indeterminate' for a partial list), and only the lines in that year's basis
 * (`entryIds`, the four sectors Art 2a counts) are exempt. A hydrogen or electricity line in
 * the same year is outside the basis and stays owed. A year whose card failed to compute
 * contributes nothing, so a failure can only over-state the total, never hide a bill.
 */
export function exemptLineIds(years: readonly YearThreshold[]): Set<string> {
  return new Set(years.flatMap((y) => (y.ruleFound && y.state === 'below_threshold' ? y.entryIds : [])));
}
```

- [ ] **Step 4: Failing render tests** (`cbam-render.test.mjs`):

```js
test('C2: renderTotals shows exempt lines OUTSIDE the total, with their own figures', () => {
  const owed = { certificates: '100', costEur: '7536.00', chargeableTco2e: '100', pricedLines: 1, refusedLines: 0, anyPending: true };
  const exempt = { certificates: '98.948', costEur: '7456.74', chargeableTco2e: '98.948', pricedLines: 1, refusedLines: 0, anyPending: true };
  const html = renderTotals(owed, exempt);
  assert.match(html, /Total exposure · 1 line/);
  assert.match(html, /Exempt if your list is complete/);
  assert.match(html, /1 line below the de minimis threshold/);
  assert.match(html, /98\.948/);
  assert.match(html, /not included in the total/);
});

test('C2: when every priced line is exempt, the total is a stated zero, not "No lines yet"', () => {
  const none = { certificates: '0', costEur: null, chargeableTco2e: '0', pricedLines: 0, refusedLines: 0, anyPending: false };
  const exempt = { certificates: '98.948', costEur: '7456.74', chargeableTco2e: '98.948', pricedLines: 1, refusedLines: 0, anyPending: true };
  const html = renderTotals(none, exempt);
  assert.doesNotMatch(html, /No lines yet/);
  assert.match(html, /Nothing owed on the lines listed/);
  assert.match(html, /Exempt if your list is complete/);
});

test('C2: without exempt lines, renderTotals is unchanged', () => {
  const t = { certificates: '100', costEur: '7536.00', chargeableTco2e: '100', pricedLines: 1, refusedLines: 0, anyPending: true };
  assert.equal(renderTotals(t), renderTotals(t, null));
  assert.doesNotMatch(renderTotals(t), /Exempt/);
});
```

- [ ] **Step 5: Implement `renderTotals(t, exempt = null)`.**
  - The signature becomes `export function renderTotals(t: Totals, exempt: Totals | null = null): string`.
  - Build the exempt paragraph once:

```ts
  const exemptNote = exempt && exempt.pricedLines > 0
    ? `<p class="cb-sub cb-exempt"><b>Exempt if your list is complete:</b> ${exempt.pricedLines} line${
        exempt.pricedLines === 1 ? '' : 's'} below the de minimis threshold for the year you attested, ${
        num(exempt.certificates)} certificates${exempt.costEur ? ` · ${eur(exempt.costEur)}` : ''} — not included in the total.</p>`
    : '';
```

  - Insert `${exemptNote}` before `</section>` in the priced branch and in the "Nothing priced" branch.
  - In the first branch (`pricedLines === 0 && refusedLines === 0`), when `exemptNote` is non-empty, return this instead of "No lines yet":

```ts
    if (exemptNote) return `
    <section class="cb-card cb-res cb-total">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Total exposure</h3>
        <span class="cb-tag ok">Below threshold</span>
      </div>
      <p class="cb-sub">Nothing owed on the lines listed, on your statement that they are all your imports for the year.</p>
      ${exemptNote}
    </section>`;
```

- [ ] **Step 6: Wire it.**
  - **In `renderAll`:**
    - Move the `const totals = sumTotals(…)` line to **after** the `try { years = thresholdByYear(…) }` block.
    - Replace it with:

```ts
    const exemptIds = exemptLineIds(years);
    const totals = sumTotals(ok.filter((p) => !exemptIds.has(p.l.id)).map((p) => p.e!));
    const exempt = sumTotals(ok.filter((p) => exemptIds.has(p.l.id)).map((p) => p.e!));
```

    - Change the render call to `renderTotals(totals, exempt)`.
    - In the `#cbStatus` summary, append ``+ (exempt.pricedLines ? ` ${exempt.pricedLines} line${exempt.pricedLines === 1 ? ' is' : 's are'} exempt if your list is complete and not in the total.` : '')`` after `totalsHeadline`.
  - **In `onDoc`:**
    - compute `exemptIds` from the same `years` it already has;
    - pass `totals: sumTotals(priced.filter(…not exempt…))` and a new `exempt: sumTotals(priced.filter(…exempt…))` to `buildPrintDocument`.
    - `priced` holds results, not lines, so filter on the paired line ids it was built from. Read how `priced` is built (around cbam-app.ts:2990) and keep the pairing.
  - **In `buildPrintDocument`:**
    - add `exempt?: Totals` to its input type;
    - append the same exempt sentence after the `Total:` paragraph (cbam-app.ts:1301–1309) when `exempt?.pricedLines`.
  - Import `exemptLineIds` from `../cbam-lines.ts` at cbam-app.ts:35–36.
  - **Before finishing, grep `renderTotals(` and `buildPrintDocument(` across `src` and `tests`, and list every hit.** The tests that call `buildPrintDocument` without `exempt` must still pass; that is why `exempt` is optional.

- [ ] **Step 7: Failing e2e, then green.** Add the test below. Use the file's existing attest-checkbox locator pattern (`[data-attest="2026"]`).

```ts
  test('C2: an attested below-threshold year leaves the total', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await addLine(page, { mass: '30' });
    await page.locator('[data-attest="2026"]').check();
    const total = page.locator('.cb-total');
    await expect(total).toContainText('Nothing owed on the lines listed');
    await expect(total).toContainText('Exempt if your list is complete');
    await expect(page.locator('#cbStatus')).toContainText('exempt if your list is complete');
  });
```

`GOOD_LINE` must be a de minimis-sector good; check its `cn` with `sectorForCn`. Run the unit and the e2e suites, as in Task 1 step 7.

- [ ] **Step 8: Commit.**

```bash
git add -- src/scripts/cbam-lines.ts src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-lines.test.mjs tests/unit/cbam-render.test.mjs tests/e2e/cbam-lines.spec.ts
git commit -m "fix(cbam): C2 — lines an attested below-threshold year exempts are shown apart, not in the total"
```

---

### Task 3: H2, cap the dot chart

**Files:** `src/scripts/cbam-graphs.ts` (`cascadeUnit` and `plotCascade`); test `tests/unit/cbam-graphs-more.test.mjs`

- [ ] **Step 1: Failing tests:**

```js
test('H2: cascadeUnit keeps 52 dots or fewer for ANY finite size, not just up to 1e7 units', () => {
  for (const max of [0.5, 52, 53, 1e4, 5.2e8, 1e10, 1e15, 1e300]) {
    const u = cascadeUnit(max);
    assert.ok(max / u <= 52, `${max}: ${max / u} dots at unit ${u}`);
  }
  assert.equal(cascadeUnit(1e10), 1e9);
});

test('H2: an absurd mass draws a bounded chart, quickly', () => {
  for (const massT of ['1e10', '1e15', '1e400']) {
    const t0 = Date.now();
    const svg = plotCascade(modelOf(line({ massT })), 600).svg;
    assert.ok(Date.now() - t0 < 2000, `${massT}: took ${Date.now() - t0} ms`);
    const dots = [...svg.matchAll(/data-dots="(\d+)"/g)].map((m) => Number(m[1]));
    assert.ok(dots.every((d) => d <= 52), `${massT}: columns ${dots}`);
    assert.ok(svg.length < 200_000, `${massT}: ${svg.length} bytes of SVG`);
  }
});
```

Add `cascadeUnit` to the import. If `modelOf(line({ massT: '1e400' }))` throws or the model is refused (the engine may refuse it), the test must say which: replace that iteration with `assert.throws` or an `if (!m) continue` **only after** measuring what happens, and record the measured result in a comment.

- [ ] **Step 2:** Run it and confirm it fails (`1e10` gives unit 1e7, i.e. 1,000 dots).

- [ ] **Step 3: Implement:**

```ts
/** The dot unit: the smallest round number that keeps the tallest column within 52 dots. Above the
 * hand-picked steps it is the smallest power of ten that does (H2, audit 2026-11-02: the old fixed
 * fallback drew 11,340 dots at 1e10 t and exhausted the heap at 1e15 t). */
export function cascadeUnit(maxCertificates: number): number {
  return [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 100000, 1000000]
    .find((u) => maxCertificates / u <= 52) ?? 10 ** Math.ceil(Math.log10(maxCertificates / 52));
}
```

  In `plotCascade`, change both `Math.round(Number(…) / unit)` expressions (`base0` and `total`) to `Math.min(52, Math.round(Number(…) / unit) || 0)`. The `|| 0` maps NaN (Infinity / Infinity) to zero dots, and `min(52)` is the backstop if the unit ever under-shoots.

- [ ] **Step 4:** Run `npm run test:unit`. Expected: all pass, including the existing 3,000-line cascade sweep.

- [ ] **Step 5: Commit.**

```bash
git add -- src/scripts/cbam-graphs.ts tests/unit/cbam-graphs-more.test.mjs
git commit -m "fix(cbam): H2 — the dot chart's unit scales with any mass; columns capped at 52 dots"
```

---

### Task 4: M2, the price is never "the quarter's"

**Files:** `src/scripts/cbam-outlook.ts:679`, `src/scripts/cbam-graphs.ts:954`; tests `tests/unit/cbam-outlook.test.mjs:462` and a new graphs assertion

- [ ] **Step 1:** Change the pinned sentence first, so it fails. In `cbam-outlook.test.mjs:462`, change the expectation to `/Fills the cost for 2026, 2027 and 2028, where no certificate price is published for the import's date\./`. In `cbam-graphs.test.mjs`, add:

```js
test('M2: no legend calls the price the quarter\'s', () => {
  const html = renderGraphs(/* use the file's existing TUBE fixture call that renders the cost card */);
  assert.doesNotMatch(text(html), /price for this import's quarter/);
});
```

Fill the call from the existing test that renders the cost card. Find it with `grep -n "renderGraphs(" tests/unit/cbam-graphs.test.mjs`, then copy its arguments **verbatim**.

- [ ] **Step 2:** Run both and confirm both fail.

- [ ] **Step 3: Implement.**
  - At `cbam-outlook.ts:679`, change `where no price is published for the import's quarter.` to `where no certificate price is published for the import's date.`
  - At `cbam-graphs.ts:954`, change `Published price for this import's quarter` to `Published price for this import's date`.
  - Leave every `imports in ${…Quarter}` phrase alone. Those name the period the import falls in, which the earlier decision allows; the comment at cbam-render.test.mjs (around line 3305) records it.

- [ ] **Step 4:** Run the unit suite and the e2e spec (any e2e pin on these two strings: `grep -rn "import's quarter" tests/`). Commit:

```bash
git add -- src/scripts/cbam-outlook.ts src/scripts/cbam-graphs.ts tests/unit/cbam-outlook.test.mjs tests/unit/cbam-graphs.test.mjs
git commit -m "fix(cbam): M2 — no sentence calls the certificate price the quarter's; from 2027 it is weekly"
```

---

### Task 5: M3, a year with no rules is said out loud

**Files:** `src/scripts/cbam-algos/cbam-app.ts` (`syncRoutes` and `runPreview`); test `tests/e2e/cbam-lines.spec.ts`

- [ ] **Step 1: Failing e2e:**

```ts
  test('M3: a year with no rules is explained in the result, not only inside a disabled select', async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await page.fill('#cbCn', GOOD_LINE.cn);
    await page.dispatchEvent('#cbCn', 'change');
    await expect(page.locator(`#cbCountry option[value="${GOOD_LINE.country}"]`)).toBeAttached();
    await page.selectOption('#cbCountry', GOOD_LINE.country);
    await page.fill('#cbDate', '2029-03-15');
    await page.dispatchEvent('#cbDate', 'change');
    await expect(page.locator('#cbOut')).toContainText('No estimate: no rules published for 2029.');
    await expect(page.locator('#cbOut')).not.toContainText('Choose a good, origin, route');
  });
```

- [ ] **Step 2:** Build and run it. Expected: FAIL; `#cbOut` shows "Choose a good…".

- [ ] **Step 3: Implement.**
  - Add `let noRoute: string | null = null;` next to `lastRoutePick`.
  - In `syncRoutes`, set `noRoute = null;` at the top. In the `if (!rs.length)` branch, set `noRoute = noRouteReason(pack, year, cn!.value);` and write that variable into the option.
  - In `runPreview`, before its first `if (!pack || !cn!.value …)` gate, add:

```ts
    // M3 (audit 2026-11-02): when no route CAN be offered, the reason must reach the live region.
    // Inside the disabled <select> it was invisible to keyboard and screen-reader users, while this
    // panel told someone who had filled every field to "choose a route".
    if (pack && cn!.value && country!.value && noRoute) {
      out!.innerHTML = `<p class="cb-idle">No estimate: ${esc(noRoute)}.</p>`;
      return null;
    }
```

- [ ] **Step 4:** Run check, unit and e2e. Then grep the e2e spec for any test that expected the "Choose a good" prompt in a no-route state (`grep -n "Choose a good" tests/e2e/cbam-lines.spec.ts`), and read each one. Commit:

```bash
git add -- src/scripts/cbam-algos/cbam-app.ts tests/e2e/cbam-lines.spec.ts
git commit -m "fix(cbam): M3 — a year or pairing with no route says why in the live result, not only in a disabled select"
```

---

### Task 6: Gate, independent audit, PR

- [ ] **Step 1: The full local gate:**

```bash
npm run check && npm run test:unit && npm run build && npx playwright test tests/e2e/cbam-lines.spec.ts --project=chromium-tier0 --project=firefox-cbam --reporter=line
```

- [ ] **Step 2: Mutation check.** For each fix, revert only its code change (keeping its tests), and confirm that at least one new test goes red. Then restore it. **Confirm each revert actually landed** (`git diff --stat`) before trusting the red result.

- [ ] **Step 3: An independent Opus audit** of `git diff origin/main...HEAD`, given the audit's H1, C2, H2, M2 and M3 text. It checks:
  - that each is closed in the live code path (not only in the tested function);
  - that no assertion was loosened;
  - that the §7.1 banner is byte-identical.

- [ ] **Step 4: On the user's word**, push the branch and open a PR to `main` titled "CBAM: audit fixes H1, C2, H2, M2, M3". The body lists each fix with its measured before/after and ends with the attribution line. CI runs the full browser matrix.
