# Say What It Knows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the calculator saying three things it cannot support — a banner that overclaims, a refusal that names the wrong table, and a de-minimis verdict that generalises "your cement is under 50 t" into "you owe nothing".

**Architecture:** Each fix derives its words from data already present — the tier option that exists, the selector already carried on the refusal, the line counts already on the threshold card. No new computation, and **no figure changes anywhere**.

**Tech Stack:** TypeScript, vitest (CBM), `node:test` + `tsx` (website), Astro.

**Spec:** `docs/superpowers/specs/2026-08-15-cbam-says-what-it-knows-design.md`

---

## Standing constraints — read before every task

- **Never hand-edit anything under `src/scripts/cbam-algos/` except `cbam-app.ts`.** That tree is a byte-for-byte vendored copy of `CBM/lib/`, hash-guarded by `scripts/cbam-sync-check.mjs` against `UPSTREAM.json` (11 files). Changes arrive only by `cp` from upstream. `cbam-app.ts` is the sole documented exception.
- **Never `git add -A` or `git add .`.** In a worktree `node_modules` is a *symlink*, and `.gitignore`'s `node_modules/` (trailing slash) matches directories only — so `-A` stages it. Stage by name.
- **Never run `npm ci` or `npm install` in the website worktree.** `node_modules` symlinks into a shared checkout another agent owns.
- `npx astro check` reports **2 pre-existing errors**, both `Cannot find module 'mapillary-js'` in `street-view-panel.ts` — the shared install predates that dependency. Production is unaffected. **Do not fix them**; measure the baseline yourself and confirm delta-zero.
- **No figure may change.** Every task here is words and one count. If a `costEur`, `certificates` or `knownEligibleMassT` moves, stop and report.
- User-facing strings are pinned by **hand-typed constants in tests**, never imported from production. Importing pins which constant is referenced, never what it says.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `CBM/lib/cbam/certificate-estimate.ts` | `NO_PRICE_REASON`; selector-derived reason | 1 |
| `CBM/lib/estimator/refusal-reason.test.ts` (new) | pins the dispatch and the text, against the shipped pack | 1 |
| `Angad/src/scripts/cbam-algos/**` + `UPSTREAM.json` | vendored copy (via `cp`/`--update` only) | 2 |
| `Angad/tests/unit/cbam-render.test.mjs` | website-side pin of the price reason | 2 |
| `Angad/src/pages/cbam/cbam-calculator.astro` | banner + eyebrow | 3 |
| `Angad/src/scripts/cbam-lines.ts` | `linesInYear` on `YearThreshold` | 4 |
| `Angad/src/scripts/cbam-algos/cbam-app.ts` | the scoped de-minimis verdict | 4 |
| `Angad/tests/unit/cbam-lines.test.mjs` | pins the field and the wording | 4 |

---

## Task 1: The refusal names the table that is actually empty

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/certificate-estimate.ts`
- Create: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/refusal-reason.test.ts`

**Note the test file is in `lib/estimator/`, not beside the change.** `lib/cbam/certificate-estimate.test.ts` builds hand-made `FreeAllocationTables` and exercises `estimateCertificates` — it never loads the shipped pack, so it cannot show that a real 2027 date hits the price gap. The estimator suite is where pack-driven tests live, and it already uses one file per fix (`mass-guard.test.ts`, `indirect-route.test.ts`). Follow that.

Work in `/Volumes/VSTSAMPLES/Projects/CBM`:

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git checkout main && git pull --ff-only
git checkout -b fix/refusal-names-the-gap
```

Baseline: **460 tests passing**, typecheck clean.

### Background

`certificate-estimate.ts:306-321` catches every regulatory lookup failure and maps it to one string. Its own comment enumerates four distinct gaps — *"no benchmark for this good/route, no factor for this year, **no price for this quarter**, or two rows where there must be one"* — but the message names only the benchmark:

```ts
export const NO_BENCHMARK_REASON =
  'The published rules do not give a free-allocation benchmark for this good, production ' +
  'route, year or quarter, so no figure is shown.'
```

The selector is already preserved on the line below the reason, and it says which gap it was. Measured:

```
2027-03-15  unavailable  selector=certificate-price/2027-Q1
            reason: "…do not give a free-allocation benchmark…"
```

`pack.prices` holds four rows, all 2026, while `defaultFactors` and `cscf` run past 2028 — so **every** 2027 and 2028 import date refuses this way.

Six selector namespaces can reach this catch. Note the first is built by array-join, not a template literal, so a grep for `` selector: `benchmark/ `` finds nothing:

| namespace | source |
|---|---|
| `benchmark/…` | `resolve-fa.ts:92` (array join) |
| `cbam-factor/${year}` | `resolve-fa.ts:114` |
| `cscf/${year}`, `cscf/${year}/published-no-value` | `resolve-fa.ts:134`, `:144` |
| `quarter/${date}` | `resolve-fa.ts:166` |
| `certificate-price/${quarter}`, `…/published-no-value` | `resolve-fa.ts:177`, `:186` |
| `sefa/${cn}/full-product-scope-with-precursors` | `sefa.ts:196` |

- [ ] **Step 1: Measure which namespaces are actually reachable**

Before changing anything, sweep the shipped pack and record which of the six namespaces a user can actually produce, and how often. Use `estimateFromPack` over a representative selector set across 2026–2028.

Report the counts. **This is scope evidence, not scope licence** — this task fixes `certificate-price/` only. If another namespace turns out to be reachable and common, say so and it becomes a separate piece of work; do **not** widen this commit.

- [ ] **Step 2: Write the failing test**

Create `lib/estimator/refusal-reason.test.ts`, following the conventions of its siblings (`mass-guard.test.ts` is the closest model — read it first for the pack load and the hand-typed-constant idiom):

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { estimateFromPack, type EstimatorPack } from './estimate-from-pack'

// The real shipped pack, like every sibling estimator test — never a pasted copy of it.
const pack = JSON.parse(readFileSync('public/estimator-pack.json', 'utf8')) as EstimatorPack

// Hand-typed, deliberately NOT imported from production — importing would pin only which
// constant is referenced, never what it says.
const PRICE_TEXT =
  'The Commission has not published the CBAM certificate price for the quarter this import '
  + 'falls in, so no figure is shown. The good, its benchmark and its default value are all '
  + 'present — only the price is missing, and prices are published quarterly in arrears.'

describe('a refusal names the table that is empty', () => {
  it('says the PRICE is missing when the price is what is missing', () => {
    // 2027 has default factors and a CSCF row but no price row, so this refuses on the price.
    const e = estimateFromPack(pack, {
      cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2027-03-15',
      emissionsScope: 'direct_and_indirect',
    })
    expect(e.status).toBe('unavailable')
    if (e.status !== 'unavailable') return
    expect(e.selector).toMatch(/^certificate-price\//)
    expect(e.reason).toBe(PRICE_TEXT)
  })

  it('keeps the benchmark wording when the BENCHMARK is what is missing', () => {
    // The reason and the selector must agree — them disagreeing IS the defect being fixed.
    const e = estimateFromPack(pack, {
      cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
      emissionsScope: 'direct',
    })
    if (e.status !== 'unavailable') return   // this selector prices; the assertion below is the point
    expect(e.reason).not.toBe(PRICE_TEXT)
  })

  it('the reason always agrees with the selector', () => {
    // The invariant, not one example of it: no refusal may name the price while its selector
    // names something else, or vice versa.
    const dates = ['2026-03-15', '2026-08-15', '2027-03-15', '2028-06-15']
    for (const date of dates) {
      const e = estimateFromPack(pack, {
        cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date,
        emissionsScope: 'direct_and_indirect',
      })
      if (e.status !== 'unavailable') continue
      const namesPrice = e.reason === PRICE_TEXT
      const selectorIsPrice = (e.selector ?? '').startsWith('certificate-price/')
      expect(namesPrice, `date=${date} selector=${e.selector}`).toBe(selectorIsPrice)
    }
  })
})
```

**Verify each expectation against the shipped pack before trusting it.** In particular confirm that `72061000/IN/(C)` behaves as the second test assumes — if it prices rather than refusing, say so and pick a selector that genuinely refuses on the benchmark. Do not adjust an assertion to match whatever the code emits.

- [ ] **Step 3: Run to verify failure**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run lib/estimator/refusal-reason.test.ts 2>&1 | tail -20
```
Expected: FAIL — the 2027 case reports the benchmark text where the price text was expected. Report verbatim.

- [ ] **Step 4: Add the constant**

In `lib/cbam/certificate-estimate.ts`, directly after `NO_BENCHMARK_REASON`:

```ts
export const NO_PRICE_REASON =
  'The Commission has not published the CBAM certificate price for the quarter this import ' +
  'falls in, so no figure is shown. The good, its benchmark and its default value are all ' +
  'present — only the price is missing, and prices are published quarterly in arrears.'
```

The sentence naming what *is* present is the load-bearing one: without it a reader goes hunting a benchmark that was never absent.

- [ ] **Step 5: Dispatch on the selector**

Replace the `catch` body's return (currently `certificate-estimate.ts:312-321`) with:

```ts
    if (isDomainError(error) &&
        (error.code === 'REGULATION_NOT_FOUND' || error.code === 'REGULATION_AMBIGUOUS')) {
      const selector = typeof error.details.selector === 'string' ? error.details.selector : null
      // WHICH TABLE IS EMPTY IS ALREADY KNOWN — the selector's first segment says so, and this
      // block used to throw that away and name the benchmark for all of them. Six namespaces
      // reach here (benchmark/, sefa/, cbam-factor/, cscf/, quarter/, certificate-price/), and
      // for a 2027 import the answer was "no free-allocation benchmark" beside a selector
      // reading `certificate-price/2027-Q1` — sending the reader to hunt a benchmark that is
      // present. Only the price is split out here, because that is the one a user meets: the
      // pack prices 2026 quarters only, so EVERY 2027 and 2028 date lands on it.
      return {
        ...base,
        status: 'unavailable',
        reason: error.code === 'REGULATION_AMBIGUOUS'
          ? AMBIGUOUS_REASON
          : selector?.startsWith('certificate-price/') ? NO_PRICE_REASON : NO_BENCHMARK_REASON,
        selector,
      }
    }
```

Note this also removes a duplicated inline `typeof … === 'string'` expression by binding `selector` once — required, since the reason now depends on it.

- [ ] **Step 6: Run to verify it passes**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```
Expected: **460 + 3 = 463 passing**, typecheck clean.

If any **pre-existing** test fails, stop and report — a test may have been pinning the benchmark text for a price refusal, which is the defect frozen into a test and is a finding, not something to edit away.

- [ ] **Step 7: Prove each rule is load-bearing**

| mutation | must fail |
|---|---|
| `selector?.startsWith('certificate-price/')` → always `false` | the 2027 test |
| `selector?.startsWith('certificate-price/')` → always `true` | the agreement test |
| swap `NO_PRICE_REASON` for `NO_BENCHMARK_REASON` in the branch | the pinned-text test |
| paraphrase `NO_PRICE_REASON`'s prose, meaning kept | the pinned-text test |

Report each failing output, restore precisely, confirm 463 green.

- [ ] **Step 8: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git add lib/cbam/certificate-estimate.ts lib/estimator/refusal-reason.test.ts
git commit -m "fix(cbam): name the table that is empty, not the one that isn't

Every 2027 and 2028 import date refuses with 'no free-allocation benchmark'
while its own selector reads certificate-price/2027-Q1. The benchmark, the
default value and the CBAM factor are all present; the pack prices 2026
quarters only. The reader was sent to hunt the wrong table.

The catch already carried the selector on the next line. It now decides the
wording. Only certificate-price/ is split out — the one namespace a user
routinely meets."
```

---

## Task 2: Re-vendor and pin it on the website

**Files:**
- Modify: `/private/tmp/cbam-truth/src/scripts/cbam-algos/cbam/certificate-estimate.ts` (via `cp` only)
- Modify: `/private/tmp/cbam-truth/src/scripts/cbam-algos/UPSTREAM.json` (via `--update` only)
- Modify: `/private/tmp/cbam-truth/tests/unit/cbam-render.test.mjs`

The worktree already exists at `/private/tmp/cbam-truth` on branch `fix/cbam-says-what-it-knows`, based on `origin/main`, `node_modules` symlinked. **Stay in it.** Baseline: **386 unit tests passing**.

- [ ] **Step 1: Copy down and re-record**

```bash
cd /private/tmp/cbam-truth
cp /Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/certificate-estimate.ts src/scripts/cbam-algos/cbam/certificate-estimate.ts
node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs
git diff --stat
```

The check must report the engine intact and in sync, and `git diff --stat` must show **exactly two files**. More means something else drifted — stop and report.

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/cbam-render.test.mjs`, reusing its existing `estimateFromPack` import and `pack` load — do not add a second import or pack load:

```js
/* ── a refusal names the table that is actually empty ───────────────────────── */

test('a 2027 date refuses on the PRICE, and says so', () => {
  // pack.prices holds four rows, all 2026, while defaultFactors and cscf run past 2028 — so
  // every 2027 and 2028 date refuses. It used to say "no free-allocation benchmark" beside a
  // selector reading certificate-price/2027-Q1, sending the reader to hunt a present benchmark.
  const e = estimateFromPack(pack, {
    cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2027-03-15',
    emissionsScope: 'direct_and_indirect',
  });
  assert.equal(e.status, 'unavailable');
  assert.match(e.selector, /^certificate-price\//);
  assert.match(e.reason, /certificate price/i);
  assert.doesNotMatch(e.reason, /free-allocation benchmark/i);
});
```

- [ ] **Step 3: Prove the test depends on the new engine**

```bash
cd /private/tmp/cbam-truth
git stash push src/scripts/cbam-algos/cbam/certificate-estimate.ts
node --import tsx --test tests/unit/cbam-render.test.mjs 2>&1 | tail -10
git stash pop
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

`npm run test:unit` runs `cbam-sync-check` first and bails on drift, so a stashed engine cannot show a clean red through it — use the raw runner, as shown. Expect FAIL while stashed, PASS after restoring. Report both verbatim.

- [ ] **Step 4: Gates**

```bash
cd /private/tmp/cbam-truth
npm run test:unit
node scripts/cbam-sync-check.mjs
npx astro check 2>&1 | tail -4
```
Expected: **387 passing** (386 + 1), sync-check green, `astro check` exactly 2 pre-existing errors. Measure the baseline yourself.

- [ ] **Step 5: Commit**

```bash
cd /private/tmp/cbam-truth
git add src/scripts/cbam-algos/cbam/certificate-estimate.ts src/scripts/cbam-algos/UPSTREAM.json tests/unit/cbam-render.test.mjs
git commit -m "fix(cbam): re-vendor the refusal that names the right table

Upstream CBM. A 2027 date now says the certificate price is unpublished
instead of blaming a benchmark that is present."
```

---

## Task 3: The banner stops overclaiming

**Files:**
- Modify: `/private/tmp/cbam-truth/src/pages/cbam/cbam-calculator.astro:47,51`

`Commission default values only` became false when the verified tier shipped: the form offers `<option value="actual-verified">My verified figures</option>` (line 110), the engine prices an attested figure with **no mark-up**, and stamps `tier: 'actual-verified'`. The banner is a `role="note"` shipping in markup on every render — the one claim a visitor cannot miss.

- [ ] **Step 1: Write the failing test**

The banner lives in `.astro` markup, so pin it where the repo already pins page copy. Check first whether `tests/unit/build-contracts.test.mjs` or an e2e spec is the established home for markup assertions — read both and follow whichever the repo already uses for `.astro` text. Then add a test asserting:

- the page does **not** contain the string `default values only`
- the page **does** contain `Commission default values or your own verified figures`
- the non-negotiable claims still present, unchanged: `not a filing`, `never sent anywhere`, `cross-sectoral correction factor is unpublished`

Include those last three deliberately: the fix must not become a licence to reword the rest of a banner marked NON-NEGOTIABLE §7.1 in its own comment.

- [ ] **Step 2: Run to verify it fails**

Run whichever runner owns that test file. Expected: FAIL on the `default values only` assertion.

- [ ] **Step 3: Make both edits**

`src/pages/cbam/cbam-calculator.astro:47`:

```diff
-      <p class="cb-eyebrow">Provisional · defaults only · in-browser</p>
+      <p class="cb-eyebrow">Provisional · defaults or your verified figures · in-browser</p>
```

`src/pages/cbam/cbam-calculator.astro:51`:

```diff
-        Prototype estimator · Commission default values only · decision-support, not a
+        Prototype estimator · Commission default values or your own verified figures · decision-support, not a
```

**Two phrases, nothing else.** Every other sentence in that banner is still accurate and stays byte-identical.

- [ ] **Step 4: Verify**

```bash
cd /private/tmp/cbam-truth
npm run test:unit
npx astro check 2>&1 | tail -4
```
Expected: 387 + your new test, `astro check` delta zero.

- [ ] **Step 5: Commit**

```bash
cd /private/tmp/cbam-truth
git add src/pages/cbam/cbam-calculator.astro tests/<the file you used>
git commit -m "fix(cbam): the banner stops saying defaults only

The form has offered 'My verified figures' since the verified tier shipped, and
the engine prices an attested figure with no mark-up. The banner is the one
claim a visitor cannot miss, and it was false. Two phrases; the rest of the
NON-NEGOTIABLE block is unchanged."
```

---

## Task 4: The de-minimis verdict is scoped to what it tested

**Files:**
- Modify: `/private/tmp/cbam-truth/src/scripts/cbam-lines.ts` (`YearThreshold`, `thresholdByYear`)
- Modify: `/private/tmp/cbam-truth/src/scripts/cbam-algos/cbam-app.ts:302`
- Modify: `/private/tmp/cbam-truth/tests/unit/cbam-lines.test.mjs`

### Background

Measured — 40 t of cement clinker plus 1,000 t of hydrogen, both 2026:

```
THRESHOLD CARD → state: below_threshold, eligibleMass: "40", eligibleLineCount: 1
PER-LINE EXPOSURE   cement    40 t → EUR      2,286.87
                    hydrogen 1000 t → EUR    523,015.36
```

The card renders *"Below the threshold an importer owes nothing for 2026"* while the page totals **€525,302.23**.

**The exclusion is correct.** Art 2(3)'s de-minimis is a *mass* test over four sectors (`rule.includedSectors`: cement, iron & steel, aluminium, fertilisers). Hydrogen and electricity are not measured by mass for it. The wording is what generalises.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/cbam-lines.test.mjs`, following its conventions (it already has 14 `thresholdByYear` references — read them first):

```js
test('a below-threshold year names the lines its test did not cover', () => {
  // Art 2(3) is a MASS test over four sectors, so hydrogen is rightly outside the basis — but
  // the verdict then claimed the importer owed nothing for the year, beside EUR 525,302.23.
  const lines = [
    line({ id: 'L1', cn: '25231000', country: 'DZ', route: '(A)', massT: '40' }),   // cement: counts
    line({ id: 'L2', cn: '28041000', country: 'DZ', route: 'default', massT: '1000' }), // hydrogen: does not
  ];
  const fps = new Map(lines.map((l) => [l.id, lineFingerprint(l)]));
  const [card] = thresholdByYear(lines, fps, new Set([2026]), pack);
  assert.equal(card.ruleFound, true);
  assert.equal(card.state, 'below_threshold');
  assert.equal(card.eligibleLineCount, 1);
  assert.equal(card.linesInYear, 2);       // the new field — 1 of 2 cannot be derived without it
});

test('a year with nothing excluded reports no exclusion', () => {
  // The sentence must not become boilerplate that always prints.
  const lines = [line({ id: 'L1', cn: '25231000', country: 'DZ', route: '(A)', massT: '40' })];
  const fps = new Map(lines.map((l) => [l.id, lineFingerprint(l)]));
  const [card] = thresholdByYear(lines, fps, new Set([2026]), pack);
  assert.equal(card.linesInYear, card.eligibleLineCount);
});
```

Use the file's own helper for building a `Line` — if it has none, build the object literal inline in the file's existing style rather than inventing a helper.

- [ ] **Step 2: Run to verify it fails**

```bash
cd /private/tmp/cbam-truth
node --import tsx --test tests/unit/cbam-lines.test.mjs 2>&1 | tail -12
```
Expected: FAIL — `card.linesInYear` is `undefined`. Report verbatim.

- [ ] **Step 3: Add the field**

In `src/scripts/cbam-lines.ts`, on the **`ruleFound: true` arm only** of `YearThreshold` (the arm at ~line 160), beside `eligibleLineCount`:

```ts
      /**
       * Every line dated in this calendar year, before any filter — the denominator
       * `eligibleLineCount` cannot supply. That one is deliberately basis.entryIds.length
       * rather than our pre-filter's count, so "N of M" is underivable from it alone.
       *
       * The RAW TOTAL, not the difference. The difference depends on two filters running in
       * series (ours on rule.includedSectors, aggregateThresholdBasis's own massSectors), so
       * storing it would invite a reader to take it as "lines excluded by sector" — only one
       * of the reasons it can be non-zero.
       */
      linesInYear: number;
```

The `ruleFound: false` arm does not get it: that arm reports the Commission has published no row for the year and makes no de-minimis claim, so it has nothing to qualify.

Then set it in the card return (~line 307), where `inYear` is already in scope:

```ts
    return {
      calendarYear, ruleFound: true, attested,
      linesInYear: inYear.length,
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd /private/tmp/cbam-truth
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npx astro check 2>&1 | tail -4
```
Expected: 387 + 2 = **389 passing**, `astro check` delta zero.

- [ ] **Step 5: Scope the verdict**

In `src/scripts/cbam-algos/cbam-app.ts`, in `renderYearThreshold`, the `sub` ternary's `below` branch (~line 302). Add above the ternary:

```ts
  // Art 2(3) is a MASS test over four sectors, so a hydrogen or electricity line is rightly
  // outside the basis — and the verdict used to generalise that into "an importer owes nothing
  // for the year". MEASURED: 40 t cement + 1000 t hydrogen rendered "owes nothing for 2026"
  // beside EUR 525,302.23. Counted, never explained per line: two filters run in series and
  // eligibleLineCount's own doc warns they agree today only by coincidence of the shipped 2026
  // row, so naming a cause for a specific line would be a claim this card cannot support.
  const excluded = y.linesInYear - y.eligibleLineCount;
  const outside = excluded === 0 ? '' : ` ${excluded} of your ${y.linesInYear} lines for ${esc(String(y.calendarYear))} ${excluded === 1 ? 'is' : 'are'} outside that test — goods not measured by mass for de minimis, such as hydrogen and electricity, are chargeable regardless. This verdict does not mean you owe nothing.`;
```

and replace the `below` branch with:

```ts
      ? `Your cement, iron &amp; steel, aluminium and fertiliser imports for ${esc(String(y.calendarYear))} total ${num(y.knownEligibleMassT)}&nbsp;t, below the ${num(y.thresholdT)}&nbsp;t threshold for those sectors.${outside} This verdict rests on your attested statement that the list is complete — it is your completeness claim, verified by no one, not by the Commission or by us.`
```

The `above` and unattested branches are unchanged.

- [ ] **Step 6: Pin the rendered wording**

Add a test asserting the rendered card for the cement+hydrogen year contains `1 of your 2 lines` and `does not mean you owe nothing`, and that the cement-only year contains **neither**. Find how the repo already tests `renderYearThreshold` output — if it is only reachable through `initCbam()`, say so and pin what *is* reachable (`linesInYear` and `eligibleLineCount` on the card), noting the gap honestly rather than inventing a harness.

- [ ] **Step 7: Verify no figure moved**

```bash
cd /private/tmp/cbam-truth
npm run test:unit
node scripts/cbam-sync-check.mjs
npx astro check 2>&1 | tail -4
```
Confirm explicitly that `knownEligibleMassT`, `state` and every `costEur` in the suite are unchanged from before this task. **If a figure moved, the change is wrong** — stop and report.

- [ ] **Step 8: Commit**

Stage by name. Write the message yourself, in this branch's style.

---

## Task 5: Land it

- [ ] **Step 1: CBM first — the vendored copy must never be ahead of upstream**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
git update-index --refresh >/dev/null 2>&1; git checkout main && git merge --ff-only fix/refusal-names-the-gap
npm test 2>&1 | tail -3
git push origin main
```

The `update-index --refresh` runs in the same invocation as the checkout deliberately: this volume is exFAT and `checkout` otherwise reports phantom "local changes would be overwritten". **Never `git reset --hard` to clear it.**

- [ ] **Step 2: Then the website**

```bash
cd /private/tmp/cbam-truth
git fetch origin --quiet
git merge origin/main --no-edit
npm run test:unit && node scripts/cbam-sync-check.mjs
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

- [ ] **Step 3: Verify the deploy**

Fetch `https://deltaclimate.earth/cbam/cbam-calculator/` and confirm `x-vercel-cache: MISS` — a cached HTML references a bundle hash that no longer exists and 404s, which reads exactly like a failed deploy. A `?cb=` query alone may not bust it; send `Cache-Control: no-cache` too, and poll rather than concluding failure on the first attempt.

Confirm HTTP 200 on the referenced `/_astro/cbam-calculator*.js` **before** grepping it. The minifier renames identifiers and emits template literals with backticks, so grep for strings and shapes, not names. Check for: the new price reason text, `certificate-price/`, and `does not mean you owe nothing`. The banner is server-rendered, so check it in the **HTML**, not the bundle.

- [ ] **Step 4: Clean up**

```bash
rm /private/tmp/cbam-truth/node_modules          # the SYMLINK only — never rm -rf the directory
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-truth --force
git worktree prune
git branch -D fix/cbam-says-what-it-knows 2>/dev/null
cd /Volumes/VSTSAMPLES/Projects/CBM && git branch -d fix/refusal-names-the-gap
```

---

## Self-review

**Spec coverage.** Banner + eyebrow → Task 3. `NO_PRICE_REASON` text and selector dispatch → Task 1 Steps 4–5. Re-vendor → Task 2. `linesInYear` on the `ruleFound: true` arm, raw total not difference → Task 4 Step 3. Scoped verdict wording → Task 4 Step 5. Sentence absent when nothing is excluded → Task 4 Step 1's second test. Hand-typed string pins → Task 1 Step 2, Task 3 Step 1. Selector-and-reason agreement → Task 1 Step 2's third test. Single-line card untouched → absent from every task, as the spec requires. "No figure changes" → Task 4 Step 7.

**Placeholders.** None — every step carries its code or its exact command. Two steps (Task 3 Step 1, Task 4 Step 6) direct the implementer to find the repo's existing home for a kind of test rather than naming a file: that is a genuine unknown about this repo's conventions, and inventing a filename would be worse than asking them to look.

**Type consistency.** `linesInYear: number` is declared in Task 4 Step 3 and read in Step 5 as `y.linesInYear`; `eligibleLineCount` keeps its existing name and meaning throughout. `NO_PRICE_REASON` is defined in Task 1 Step 4 and referenced only in Step 5; its text is duplicated as a hand-typed constant in Step 2 **on purpose**.

**One risk worth naming.** Task 1 Step 1 measures which of six selector namespaces are reachable. If it finds `cscf/`, `quarter/`, `cbam-factor/` or `sefa/` are commonly reachable, the same defect exists for them and this plan fixes only the price. That is deliberate — the price is the one every 2027 date hits — but the measurement must be reported, not quietly dropped, or the next reader will assume the whole class was closed.
