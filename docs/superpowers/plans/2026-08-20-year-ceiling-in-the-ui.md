# Pricing Ceiling in the UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the user a 2027/28 import date cannot be priced at the moment they enter it, instead of after they have built the whole line.

**Architecture:** One predicate that asks the engine's own question — does the pack carry a certificate-price row for this date's quarter — and one new status element beside the date field that renders its answer. No engine change; no blocking; no new dependency.

**Tech Stack:** TypeScript, Astro, `node:test` + `tsx`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-year-ceiling-in-the-ui-design.md`

---

## Repo, branch, baseline

| | |
|---|---|
| path | `/Volumes/VSTSAMPLES/Projects/angad-allroutes` |
| branch | `fix/year-ceiling-ui` (exists, off `main`; spec committed at `2f18028`) |
| baseline | `npm run build` clean · `npm run test:unit` **491 pass** · `npx astro check` **0 errors, 6 hints** · `npm run test:e2e` **111 pass** |

`npm run test:unit` needs `dist/`, so build first.

## What the engine already does — measured, do not re-derive

Grey clinker, Algeria, 100 t, route `(A)`, shipped pack:

| import date | certificates | euro cost | status |
|---|---|---|---|
| 2026 Q1–Q2 | 71.465 | €5,385.60 | `cscf_pending` |
| 2026 Q3–Q4 | 71.465 | **none** | `cscf_pending` + a note naming the unpublished quarter |
| 2027, 2028 | none | none | `unavailable` · `NO_CERTIFICATE_PRICE` · `certificate-price/2027-Q1` |
| 2029+ | — | — | route control already disabled: "no rules published for 2029" |

**Only the 2027/28 row is the defect**, and it is a funnel problem: every control works, so the user completes the line before learning it can never be priced.

## Two decisions already settled by measurement — do not revisit

1. **The predicate is row EXISTENCE, not `status === 'published'`.** `resolveCertificatePrice` (`src/scripts/cbam-algos/cbam/resolve-fa.ts:188`) throws `REGULATION_NOT_FOUND` only when no row matches the quarter; a `status: 'pending'` row returns `{ status: 'pending' }` and the engine continues. That is precisely why 2026 Q3/Q4 still produce certificates. A published-only test would fire a **false warning on ordinary near-future dates**.
2. **Never test the year number.** `year >= 2027` hardcodes today's corpus and would keep warning after the Commission publishes 2027 prices — turning the fix into the class of false claim it exists to prevent.

## One deliberate change from the spec

The spec said to reuse `#cbStatus`. **Do not.** `cbam-app.ts` documents a single-writer invariant for that element — *"This keeps ONE writer of #cbStatus on the add path (onAdd)"* (around `:2212`) — and the warning fires on a different trigger (`date` change, via `onPick`). A second writer would break a deliberate rule and create a precedence problem the spec left open.

Instead: a dedicated `#cbDateNote` beside the date field. It removes the precedence question entirely, sits next to the field it describes, and leaves `#cbStatus`'s discipline intact.

## Standing constraints

1. **`src/scripts/cbam-algos/` is vendored** and hash-guarded by `scripts/cbam-sync-check.mjs`. **Only `cbam-app.ts` is hand-editable.** Run the check before finishing.
2. **Never judge a run by its trailing summary — check exit codes.** A Playwright run here printed "32 passed" while 75 of 107 failed.
3. **Mutation-verify, and grep the file to confirm the mutation landed first.** A substitution in this project twice silently failed to match and produced a green suite that looked like a passing mutation.
4. **Never state a count from memory — measure it.**
5. Locate code by text, not line number.

---

## Task 1: the predicate

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts`
- Test: `tests/unit/cbam-render.test.mjs`

- [ ] **Step 1: Confirm the baseline**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-allroutes
npm run build >/dev/null 2>&1 && echo "BUILD: PASS" || echo "BUILD: FAIL"
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected 491 pass / 0 fail. If it differs, stop and report.

- [ ] **Step 2: Write the failing test**

Add to `tests/unit/cbam-render.test.mjs`, following the file's existing idiom (read a neighbouring test first — it uses `node:test` and `node:assert/strict`, and loads the real pack):

```js
test('the date note fires only where the corpus carries no price row at all', () => {
  // The predicate must ask what resolveCertificatePrice asks: is there a ROW for this quarter.
  // Not "is it published" — 2026 Q3 and Q4 rows are status:'pending' and those dates still
  // produce certificates, so a published-only test would warn on ordinary near-future dates.
  // Not "is the year >= 2027" — that hardcodes today's corpus and would keep warning after the
  // Commission publishes 2027 prices, becoming the false claim this exists to prevent.
  assert.equal(priceNoteFor(pack, '2026-03-15'), null);
  assert.equal(priceNoteFor(pack, '2026-08-15'), null);   // Q3: row is pending, still prices
  assert.equal(priceNoteFor(pack, '2026-12-31'), null);   // Q4: same
  assert.match(priceNoteFor(pack, '2027-01-01'), /2027 Q1/);
  assert.match(priceNoteFor(pack, '2028-12-31'), /2028 Q4/);
});

test('the date note says what IS published, not that the year is unsupported', () => {
  // The Commission HAS published the goods, routes and benchmarks for 2027/28. Saying "2027 is
  // not covered" would be false, and false refusals are the defect class this calculator has
  // spent weeks removing. Asserted as a property so a reword cannot quietly drop it.
  const note = priceNoteFor(pack, '2027-03-15');
  assert.match(note, /goods, routes and benchmarks are published/i);
  assert.doesNotMatch(note, /not covered|unsupported|not supported/i);
});

test('an unreadable date produces no price note — that is a different problem', () => {
  // quarterOf THROWS REGULATION_NOT_FOUND (selector quarter/<date>) for anything it cannot
  // parse: '', 'not-a-date', and '2027-1-15' (rejected on length — a single-digit month once
  // produced the string '2027-QNaN', a bug fixed and documented in resolve-fa.ts). Claiming
  // "no certificate price is published" for a date nobody can read states something we do not
  // know, and the date already has its own handling.
  for (const bad of ['', 'not-a-date', '2027-1-15']) {
    assert.equal(priceNoteFor(pack, bad), null);
  }
});

test('a full UTC timestamp resolves to its day, not to nothing', () => {
  // quarterOf accepts both shapes; callers pass '2026-03-15T00:00:00.000Z' as well as a bare day.
  assert.equal(priceNoteFor(pack, '2026-03-15T00:00:00.000Z'), null);
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)|priceNoteFor"
```
Expected: failures with `priceNoteFor is not defined` (or an import error). Record the actual message.

- [ ] **Step 4: Implement**

In `cbam-app.ts`, add `quarterOf` to the existing import from the vendored engine — check whether `./cbam/resolve-fa.ts` is already imported and extend that statement rather than adding a second one. Then:

```ts
/**
 * The sentence to show beside the import date, or null when there is nothing to say.
 *
 * ASKS THE ENGINE'S OWN QUESTION. resolveCertificatePrice (cbam/resolve-fa.ts) throws
 * REGULATION_NOT_FOUND only when NO row matches the quarter; a row with status 'pending' returns
 * { status: 'pending' } and pricing continues — which is why 2026 Q3 and Q4 still produce
 * certificates, with the euro figure withheld and a note naming the quarter. So the test here is
 * row EXISTENCE. Two other predicates were drafted and measurement killed both: 'is the price
 * published' (would warn on 2026 Q3/Q4, which work) and 'is the year >= 2027' (hardcodes today's
 * corpus and would keep warning after the Commission publishes 2027 prices — the exact class of
 * false claim this warning exists to prevent).
 *
 * Silent on an unreadable date: quarterOf throws for '', 'not-a-date' and '2027-1-15', and
 * asserting anything about a certificate price for a date nobody can read would state something
 * we do not know. The date field has its own handling for that.
 *
 * Naming what IS published is not decoration. The Commission has published the goods, the
 * production routes and the free-allocation benchmarks for 2027 and 2028; only the quarterly
 * price is missing. "2027 is not covered" would be false.
 */
export function priceNoteFor(pack: EstimatorPack, date: string): string | null {
  let quarter: string;
  try { quarter = quarterOf(date); } catch { return null; }
  if (pack.prices.some((row) => row.quarter === quarter)) return null;
  const pretty = quarter.replace('-', ' ');
  return `No certificate price is published for ${pretty}, so no figure can be produced for `
    + 'this date. The goods, routes and benchmarks are published — only the price is missing.';
}
```

**Confirm before writing:** that `pack.prices` rows carry a `quarter` field of the form `2026-Q1` (measured: they do, four rows, Q1/Q2 `published`, Q3/Q4 `pending`), and that `EstimatorPack` is already imported in this file (it is). If the test file cannot import `priceNoteFor` from `cbam-app.ts`, follow how the file's other exported helpers are reached in `cbam-render.test.mjs` rather than inventing a new path — **`cbam-app.ts` has historically been hard to reach from unit tests**, so if it genuinely cannot be imported, STOP and report rather than moving the function somewhere it does not belong.

- [ ] **Step 5: Run and confirm green**

```bash
npm run build >/dev/null 2>&1 && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npx astro check 2>&1 | tail -3
```
Expected: 495 pass, 0 fail; `astro check` 0 errors (6 hints pre-existing — report what you see).

- [ ] **Step 6: Mutation-verify**

Three mutations, each grep-confirmed before running (use Python with `assert count == 1`, verify with `diff`):
1. Change the predicate to `row.status === 'published'` → the 2026 Q3/Q4 assertions must redden.
2. Change it to `Number(date.slice(0, 4)) >= 2027` → the corpus tests still pass, so **report that this mutation SURVIVES on today's data** and say why it is still wrong (it hardcodes the corpus). That surviving mutant is the honest result, not a failure of the test.
3. Delete the `catch { return null }` → the unreadable-date test must redden.

Restore after each; confirm `git diff` is clean of stray edits.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-render.test.mjs
git commit -m "feat(cbam): a predicate for dates the corpus cannot price"
```
Body: the measured price-row table, and the two rejected predicates with why.

---

## Task 2: render it beside the date

**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro` (markup + one style rule)
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (wire it into `onPick`)

- [ ] **Step 1: Add the element**

In `cbam-calculator.astro`, the date field currently reads:

```html
            <div>
              <label class="cb-label" for="cbDate">Import date</label>
              <input id="cbDate" class="cb-field" type="date" value="2026-03-15" />
            </div>
```

Add a note element after the input, inside the same `div`:

```html
              <p class="cb-datenote" id="cbDateNote" role="status" aria-live="polite"></p>
```

**Its own `role="status"`, deliberately not `#cbStatus`.** `cbam-app.ts` documents a single-writer invariant for that element — "This keeps ONE writer of #cbStatus on the add path (onAdd)" — and this warning fires on `date` change instead. A second writer would break a deliberate rule and force a precedence decision. The two never fire on the same interaction, so two polite regions do not compete.

- [ ] **Step 2: Style it**

Add beside the existing `.cb-note` rule, reusing the file's own tokens:

```css
  .cb-datenote {
    margin: 0.4rem 0 0; font-size: 0.72rem; line-height: 1.6;
    color: var(--color-bronze); max-width: 46ch;
  }
  .cb-datenote:empty { display: none; }
```

`--color-bronze` is the file's existing warning colour (`.cb-out .cb-warn` already mixes it). `:empty { display: none }` keeps the layout from reserving space when there is nothing to say. **Check the contrast of bronze on the page background before settling on it** — if it fails, use the mix `.cb-out .cb-warn` already applies rather than inventing a colour.

- [ ] **Step 3: Wire it in**

`onPick` already runs on `cn`, `country` and `date` change:

```ts
  const onPick = async () => {
    if (await ensurePack()) { syncRoutes(); syncScope(); syncVerifiedRows(); refresh(); }
  };
```

Add a `syncDateNote()` alongside the other sync calls, defined near them:

```ts
  // Beside the other sync* helpers, and called from onPick for the same reason they are: the
  // fact becomes knowable the moment the date changes, and that is the whole point — the user
  // used to complete the entire line before learning the year cannot be priced.
  const syncDateNote = () => {
    const note = $('cbDateNote');
    if (note) note.textContent = pack ? (priceNoteFor(pack, date.value) ?? '') : '';
  };
```

**Confirm the real names before writing this**: how the loaded pack is referenced in that scope, and how other helpers obtain elements (`$(...)` vs a captured const). Follow the file; do not assume this snippet's shape.

Also call it once on initial render so a page loaded with a 2027 date in the field is correct before any interaction — find where the other `sync*` helpers run at init and join them.

- [ ] **Step 4: Verify by hand**

```bash
npm run build >/dev/null 2>&1 && npm run preview -- --host 127.0.0.1 --port 4399 &
```
Load `/cbam/cbam-calculator/`, set the date to 2027-03-15, and confirm: the note appears immediately, no other field needs touching, the route control stays enabled, and Add still works and still produces the existing refusal. Then set it back to 2026-03-15 and confirm the note clears. Kill the server.

- [ ] **Step 5: Commit**

```bash
git add src/pages/cbam/cbam-calculator.astro src/scripts/cbam-algos/cbam-app.ts
git commit -m "feat(cbam): warn at the date field when the corpus cannot price the quarter"
```

---

## Task 3: the banner sentence

**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro` (the `cb-banner` div)

- [ ] **Step 1: Rewrite one clause**

The banner currently says:

> …For a 2026 import no final figure exists — the cross-sectoral correction factor is unpublished — so any number below is a labelled what-if. …

*"For a 2026 import"* reads as an example, implying other years behave differently. State the coverage instead, and **keep the CSCF sentence intact** — it is true and load-bearing. Something of this shape, but write it against what you measure:

> …This tool prices 2026 imports; the Commission has not published certificate prices beyond that year. For a 2026 import no final figure exists either — the cross-sectoral correction factor is unpublished — so any number below is a labelled what-if. …

**Check the pinning tests first.** A prior task recorded that §7.1 banner content is pinned "against *additions* not just edits". Find the test that pins this banner, read what it asserts, and update it deliberately — if it hand-types the whole string, re-type it; do not import it.

- [ ] **Step 2: Verify**

```bash
npm run build >/dev/null 2>&1 && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
If a banner pin fails, that is expected — classify it as a stale expectation, say so, and update it. If any *other* test fails, that is a regression: stop and report.

- [ ] **Step 3: Commit**

```bash
git add src/pages/cbam/cbam-calculator.astro tests/
git commit -m "docs(cbam): the banner states what the tool prices, not an example year"
```

---

## Task 4: e2e, land, verify

- [ ] **Step 1: Add an e2e pin**

Add to `tests/e2e/cbam-lines.spec.ts`, inside a `test.describe` you locate by name:

```ts
test('a 2027 date warns at the field, before any other input, and blocks nothing', async ({ page }) => {
  // The defect this fixes was a funnel, not a missing disclosure: every control worked, so the
  // user built the whole line and only then learned the year can never be priced.
  await page.goto('/cbam/cbam-calculator/');
  await page.fill('#cbDate', '2027-03-15');
  await page.dispatchEvent('#cbDate', 'change');
  await expect(page.locator('#cbDateNote')).toContainText('2027 Q1');
  // Nothing is blocked: 2029 disables the route control because no rules exist, but 2027 has
  // goods, routes and benchmarks — only the price is missing.
  await expect(page.locator('#cbRoute')).toBeEnabled();
  // And it clears when the date returns to a priceable quarter.
  await page.fill('#cbDate', '2026-03-15');
  await page.dispatchEvent('#cbDate', 'change');
  await expect(page.locator('#cbDateNote')).toHaveText('');
});
```

**Verify the selector ids and the `change` dispatch against neighbouring tests before running** — `fill()` alone dispatches only `input`, and this file's helpers dispatch `change` explicitly for exactly that reason.

- [ ] **Step 2: Full gates**

```bash
npm run build >/dev/null 2>&1 && echo "BUILD: PASS" || echo "BUILD: FAIL"
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run test:e2e >/tmp/e2e.log 2>&1; echo "E2E_EXIT=$?"; grep -E "^\s+[0-9]+ (passed|failed)" /tmp/e2e.log | tail -2
npx astro check 2>&1 | tail -3
node scripts/cbam-sync-check.mjs >/dev/null 2>&1 && echo "SYNC_OK" || echo "SYNC_FAIL"
```
Expected: 112 e2e passed, exit 0; `astro check` 0 errors; sync green. **Check the exit code, not the summary line.** If webkit is missing, `npx playwright install webkit` — a missing browser reads as ~27 failures and is not one.

- [ ] **Step 3: PR and CI**

```bash
git add tests/e2e/cbam-lines.spec.ts
git commit -m "test(cbam): pin that a 2027 date warns at the field and blocks nothing"
git push -u origin fix/year-ceiling-ui
gh pr create --base main --head fix/year-ceiling-ui \
  --title "feat(cbam): say at the date field when the corpus cannot price the quarter" \
  --body "<the measured tier table, the two rejected predicates, and that nothing is blocked>"
gh pr checks --watch
```
**Do not merge on a red CI without first establishing whether the failure pre-exists on `main`** — compare against `main`'s latest run for the same job.

- [ ] **Step 4: Verify the deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator` with `Cache-Control: no-cache` and a delay between attempts. **Check for HTTP 200 before grepping** — a 404 greps as string-absent, which reads as a finding and is not one. Confirm the entry chunk's hash matches the local `dist/` build, then grep it for a string this change introduces. Grep for **strings, not identifiers** — the minifier renames those.

---

## Self-review

**Spec coverage.** The predicate → Task 1. The rendered warning and its placement → Task 2. The banner → Task 3. Testing at boundaries, the malformed-date case, the timestamp form, and "must not fire on a priceable date" → Task 1 Steps 2 and 6. The e2e → Task 4.

**The one deliberate divergence from the spec**, argued rather than taken silently: the warning gets its own `#cbDateNote` element instead of reusing `#cbStatus`, because `cbam-app.ts` documents a single-writer invariant for `#cbStatus` on the add path. This also dissolves the precedence question the spec left open — the two elements never fire on the same interaction, so neither has to win.

**Out of scope, per the spec:** pricing 2027/28 at an assumed certificate price (CSCF's assumption has a legal ceiling; a certificate price has none); blocking 2027/28 the way 2029 is blocked; changing tier 2's certificates-without-euros behaviour; the CSCF disclosure, which is already explicit per-line and in the banner.

**Type consistency.** `priceNoteFor(pack, date)` returns `string | null` and is defined once in Task 1, consumed once in Task 2's `syncDateNote`. `quarterOf` is imported from the vendored `./cbam/resolve-fa.ts`; `EstimatorPack` is already imported in `cbam-app.ts`. The element id `cbDateNote` is written in Task 2's markup and read in Task 2's wiring and Task 4's e2e — one spelling throughout.

**A surviving mutant is expected and is the honest result.** Task 1 Step 6's second mutation (`year >= 2027`) passes every test on today's corpus. It is still the wrong predicate, for a reason no test on this pack can express: it would keep warning once 2027 prices are published. Report it as surviving rather than contriving a test that only appears to kill it.
