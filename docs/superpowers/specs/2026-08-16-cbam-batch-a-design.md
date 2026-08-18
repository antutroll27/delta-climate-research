# Batch A — five mechanical defects

**Date:** 2026-08-16
**Status:** approved, ready for planning
**Scope:** five known defects whose fixes need no new design. Grouped because each is small and the techniques are already proven; kept in one spec so the golden fixture can be regenerated once, at the end, capturing every behaviour change in a single reviewed diff.

## 1. A second catch site, on a production path

`CBM/api/services/certificate-estimate.ts:120-126` hardcodes `NO_BENCHMARK_REASON` for every `REGULATION_NOT_FOUND` it catches. Its own comment names both things it actually catches:

> Resolving the benchmark scope (from the basis) and the precursors (from the DB) can each fail closed: **an old snapshot with no frozen scope**, or **a precursor the rules do not price**.

Neither is a benchmark. This is the same defect fixed in `lib/cbam/certificate-estimate.ts` — but it is a **different site with different selectors**, and it serves the SaaS rather than the marketing calculator.

**It is not the same fix.** The two selectors are:

- `verified-actual-snapshot-without-intensity-scope` (`api/services/certificate-estimate.ts:174`) — **no namespace prefix**, so the `startsWith('certificate-price/')` dispatch cannot reach it
- `precursor/${cnCodeVersionId}/${defaultFactorVersionId}` (`:202`)

So this site needs **two new reason constants and its own local dispatch**. Reusing `NO_PRICE_REASON` here would be the same mistake pointing a different way.

Proposed text, following the house idiom (name the gap, name the harm of guessing):

```ts
export const NO_SNAPSHOT_SCOPE_REASON =
  'This case\'s frozen snapshot predates the intensity-scope field, so the rules cannot tell ' +
  'whether the figure covers the whole product or the process only, and no figure is shown. ' +
  'The two are priced against different benchmark columns, so guessing the scope would pick ' +
  'a benchmark the importer never declared.'

export const NO_PRECURSOR_REASON =
  'One of this good\'s precursors has no published default value for its own good, origin, ' +
  'production route or year, so no figure is shown. Pricing that precursor at zero would ' +
  'understate the embedded emissions without saying so.'
```

Both must read differently from `NO_BENCHMARK_REASON`, `NO_PRICE_REASON` and `AMBIGUOUS_REASON`.

Note this catch handles only `REGULATION_NOT_FOUND`, not `REGULATION_AMBIGUOUS` — unchanged.

## 2. `quarter/` names the wrong thing

`quarterOf` (`lib/cbam/resolve-fa.ts:166`) throws `REGULATION_NOT_FOUND` with selector `quarter/${date}` when the month is outside 1–12. The gap is an **unreadable import date**, not a missing rule.

Reachable through `estimateFromPack` (a valid year with an out-of-range month clears the year gate and dies in `quarterOf`); **not** reachable through the site's `<input type="date">`. Measured at 49 hits in the Task 1 sweep.

One more branch on the dispatch added in `lib/cbam/certificate-estimate.ts`:

```ts
export const BAD_DATE_REASON =
  'The import date is not a readable calendar date, so the quarter it falls in cannot be ' +
  'determined and no figure is shown. Every figure here is quarter-specific — the certificate ' +
  'price and the benchmark in force both depend on it.'
```

## 3. The §4 paraphrase pin admits a fifth caveat

`tests/unit/cbam-render.test.mjs` pins four `CAVEAT_*` constants with `assert.ok(html.includes(CAVEAT_X))`, plus an order check. That catches an **edit** to any caveat — its docblock explains at length why hand-typed transcripts beat regexes, and it is right.

It does not catch an **addition**. A fifth `<li>` contradicting the other four leaves every `includes()` true and the order intact: 133/133 green on a §4 block that has just been undone.

**Fix:** assert the set is complete, not merely present — anchor to the enclosing container and pin the full list, so an added item has to be deliberate. This is exactly the hole found in the banner pin on 2026-08-15 and closed the same way (`edd705f` anchored `BANNER_71` to its `<div class="cb-banner">…</div>`); the `CAVEAT_*` constants are individually immune to *appending* only because each ends in `</li>`.

The existing per-caveat assertions stay. This adds a containment assertion; it does not replace them.

## 4. The de-minimis verdict hardcodes four sectors

`cbam-app.ts`'s below-threshold verdict reads *"Your cement, iron & steel, aluminium and fertiliser imports for ${year}…"* as a baked-in string, while the card carries no `includedSectors`.

`eligibleLineCount`'s own docblock anticipates a future threshold row that includes hydrogen or electricity, and the test suite already simulates one (`widerPack`). The day the Commission widens that row, this sentence names the wrong sectors with nothing to catch it.

`rule.includedSectors` is on the threshold rule (`estimate-from-pack.ts:66`, read at `:258`), so it is in scope where the card is built. **Fix:** put it on the `ruleFound: true` arm of `YearThreshold` and render the prose from it.

Rendering detail: the sectors are stored as `iron_and_steel`-style keys, and the current prose reads `iron & steel`. The renderer must produce the same human form it produces today for the sectors shipped today — a rendering change that alters the visible sentence for the *current* pack is a defect, not an improvement.

## 5. The golden parity fixture is stale three ways

`tests/fixtures/cbam-golden.json` — 175 cases, `packGeneratedAt: 2026-07-29T11:01:09.056Z`. Its own header:

> GENERATED from the audited TypeScript engine — the parity contract for the Go port. Regenerate with `node --import tsx scripts/gen-cbam-fixtures.mjs` **ONLY when a rule package legitimately changes, and review the diff as a regulatory change.**

It currently encodes:

1. `indirect 6.6` for **both** routes — the over-charge fixed by the indirect-route work
2. the **old refusal text** on 3 cases with selector `certificate-price/2027-Q2`
3. a pack generated `2026-07-29`, against a shipped pack of `2026-08-07`

Nothing reads it today (the Go oracle at `go/parity/oracle_test.go` covers the *geo* fixture), so nothing is broken. But it is the contract a Go CBAM port would be written against, and a correct port would **fail parity against it**.

**Fix:** regenerate, last in the batch, so one diff captures every behaviour change from Batch A and everything before it.

**The review is the work, not the command.** One regeneration folds three kinds of change into a single diff. Before regenerating, write down what *should* move; then check the diff against that list and account for anything else. Expected:

- indirect values on route-keyed goods, all **downward** (the over-charge correction)
- refusal `reason` strings where the selector is `certificate-price/`
- `packGeneratedAt`, `packRules` if the version changed, and any figure the newer pack legitimately moves

**Anything outside that list is a finding, not a rubber stamp.** If the diff cannot be accounted for, stop and report rather than committing it.

## Testing

- New reason constants pinned by **hand-typed constants in tests**, never imported — the convention already used for §4 and the banner.
- Each new dispatch branch mutation-verified: force it false, force it true, swap its constant. Note that a dispatch test whose corpus only ever exercises one branch cannot detect a hard-wired `true`; the sweep must include a selector that lands on each branch.
- The §4 containment assertion must be proven against the actual attack: add a contradicting fifth `<li>`, watch it fail, remove it.
- The sector rendering must be proven not to change the current visible sentence.

## Out of scope

The remaining open defects, each tracked separately: the half-verified mixed tier; 2027/28 price coverage; the silently vanishing threshold card and the print document's unnamed excluded line; `aggregate.ts`/`evaluate.ts` remaining ungated and `CalculationsView`'s raw render; `differential.test.ts`'s missing indirect arm; and the deferred regulatory work (IR 2026/1740 rebuild, `Art 2(2)` → `Art 1(2)`, placeholder source hashes, Annex IV tier, UK CBAM, the audit PDF's worked example).

**No figure may change** except in the regenerated fixture, where the changes are the point and must be accounted for one by one.
