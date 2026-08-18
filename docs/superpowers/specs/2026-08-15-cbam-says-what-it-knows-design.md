# Say what it knows — design

**Date:** 2026-08-15
**Status:** approved, ready for planning
**Scope:** three user-facing claims that are false or misattributed. No change to any figure.

## The thesis

The calculator now computes honestly. It still **says** three things that are not true — and in every case the information needed to say something true is already present and simply not used.

| defect | what the code knows | what it tells the user |
|---|---|---|
| banner | `<option value="actual-verified">My verified figures</option>` exists | "Commission default values only" |
| 2027/28 refusal | `selector` is `certificate-price/2027-Q1` | "no free-allocation **benchmark**" |
| de-minimis card | `eligibleLineCount` is 1 of 2 lines | "an importer owes nothing **for the year**" |

So every fix derives its words from data already in hand. None adds a computation, and **none changes a figure**.

## 1. The banner overclaims

`src/pages/cbam/cbam-calculator.astro:51` opens:

> Prototype estimator · **Commission default values only** · decision-support, not a declaration.

That was true until the verified-emissions tier shipped. The form now offers `<option value="actual-verified">My verified figures</option>`, the engine prices an attested figure with **no mark-up**, and the result stamps `tier: 'actual-verified'`. The banner is a `role="note"` that ships in markup on every render — the one claim a visitor cannot miss — and it is false.

**Fix:** narrowest replacement that becomes true.

- Banner (line 51): `Commission default values only` → `Commission default values or your own verified figures`
- Eyebrow (line 47): `Provisional · defaults only · in-browser` → `Provisional · defaults or your verified figures · in-browser`

Everything else in the banner stands: the CSCF what-if caveat, "computed in your browser… never sent anywhere", "not a filing, not validated by the EU CBAM Registry" are all still accurate and stay untouched. The banner is marked NON-NEGOTIABLE §7.1 in its own comment, so the edit is surgical — two phrases, nothing else.

## 2. The refusal names the wrong table

`lib/cbam/certificate-estimate.ts:316` maps every `REGULATION_NOT_FOUND` to a single string:

```ts
reason: error.code === 'REGULATION_AMBIGUOUS' ? AMBIGUOUS_REASON : NO_BENCHMARK_REASON,
selector: typeof error.details.selector === 'string' ? error.details.selector : null,
```

where

```ts
export const NO_BENCHMARK_REASON =
  'The published rules do not give a free-allocation benchmark for this good, production ' +
  'route, year or quarter, so no figure is shown.'
```

The comment directly above that block already enumerates four distinct gaps — *"no benchmark for this good/route, no factor for this year, **no price for this quarter**, or two rows where there must be one"*. Only one of them is a benchmark.

Measured on the shipped pack:

```
2026-03-15  cscf_pending
2027-03-15  unavailable  selector=certificate-price/2027-Q1
            reason: "…do not give a free-allocation benchmark…"
2028-03-15  unavailable  selector=certificate-price/2028-Q1
```

`pack.prices` holds four rows, all 2026, while `defaultFactors` and `cscf` run past 2028 — so **every** 2027 and 2028 import date refuses, and the message sends the reader to hunt a benchmark that is present. `cbam-calculator.astro:141` is a bare `<input type="date">` with no `min`/`max`, and CBAM's definitive period begins in 2026, so a user picking 2027 is entirely ordinary.

**Fix:** derive the reason from the selector's namespace, which line 317 already preserves. This is the same shape as the `inputRefusal` caption added in `09f0277`: the selector's first segment is the discriminator.

- `certificate-price/…` → a new `NO_PRICE_REASON`
- `benchmark/…` → `NO_BENCHMARK_REASON`, unchanged
- anything else → `NO_BENCHMARK_REASON`, unchanged

The new constant, exported alongside its siblings so the estimator's own refusals can be checked against it:

```ts
export const NO_PRICE_REASON =
  'The Commission has not published the CBAM certificate price for the quarter this import ' +
  'falls in, so no figure is shown. The good, its benchmark and its default value are all ' +
  'present — only the price is missing, and prices are published quarterly in arrears.'
```

It must read differently from `NO_BENCHMARK_REASON` and `AMBIGUOUS_REASON`: the point is that a reader can tell which table is empty. The sentence naming what *is* present is the part that stops the reader hunting a benchmark.

**This changes the message, never the coverage.** 2027 still refuses; refusing is correct. The missing price rows are a separate, larger piece of work and stay out of scope.

`certificate-estimate.ts` is **vendored** — it lives under `src/scripts/cbam-algos/` on the website, hash-guarded against `UPSTREAM.json`. So this is a change in `/Volumes/VSTSAMPLES/Projects/CBM` followed by a re-vendor, never a hand-edit of the website copy.

## 3. "An importer owes nothing" beside a real liability

`src/scripts/cbam-algos/cbam-app.ts:302`, the multi-line year card:

> Below the threshold an importer owes nothing for ${year}. This verdict rests on your attested statement that the list is complete…

Measured — 40 t of cement clinker plus 1,000 t of hydrogen, both 2026:

```
THRESHOLD CARD → state: below_threshold, eligibleMass: "40", eligibleLineCount: 1
PER-LINE EXPOSURE   cement    40 t → EUR      2,286.87
                    hydrogen 1000 t → EUR    523,015.36
```

The card says the importer owes nothing for 2026 while the same page totals **€525,302.23**.

**The exclusion itself is correct.** Art 2(3)'s de-minimis is a *mass* test over four sectors — cement, iron & steel, aluminium, fertilisers (`rule.includedSectors`). Hydrogen and electricity are not measured by mass for it, so `thresholdByYear` rightly drops them from the basis. The defect is that the verdict's **wording** then generalises from "your cement is under 50 t" to "you owe nothing".

**Fix:** scope the verdict to what the test covers, and state how many lines fell outside it.

The card must say the count **factually** without claiming *why* any particular line did not count. Two filters run in series — this repo's `rule.includedSectors` check and `aggregateThresholdBasis`'s own hardcoded `massSectors` — and `eligibleLineCount`'s docblock already warns they agree today only because the shipped 2026 row happens to make them agree. So the wording names the count, and names the sector rule generically, rather than asserting a cause per line.

**One new field is required.** `YearThreshold` carries `eligibleLineCount` but not the year's total, and `eligibleLineCount` is deliberately `basis.entryIds.length` rather than the pre-filter count — so "1 of 2" cannot be derived from what exists.

Add `linesInYear: number` — every line dated in that calendar year, before any filter — to the **`ruleFound: true` arm only**. That is the sole arm rendering a verdict; the `ruleFound: false` arm reports that the Commission has published no row for the year and makes no de-minimis claim, so it has nothing to qualify.

`linesInYear − eligibleLineCount` is then the excluded count. Naming the raw total rather than storing the difference is deliberate: the difference is a derived number whose meaning depends on both filters, and storing it would invite a future reader to treat it as "lines excluded by sector", which is only one of the reasons it can be non-zero.

The proposed wording, for a year where the difference is non-zero:

> Your cement, iron & steel, aluminium and fertiliser imports for 2026 total 40 t, below the 50 t threshold for those sectors. **1 of your 2 lines for 2026 is outside that test** — goods not measured by mass for de minimis, such as hydrogen and electricity, are chargeable regardless. This verdict does not mean you owe nothing.

When the difference is zero, the excluded sentence does not print, and the verdict keeps its existing completeness caveat.

**Out of scope:** the single-line card at `cbam-app.ts:236`. It already says *"This is ONE line, not your annual total, so it cannot show you are under the threshold… Add your other imports for ${year} before relying on the exemption."* That is careful, and its good is in a threshold sector by construction, since a good outside one produces no card at all.

## Testing

- Every user-facing string pinned by a **hand-typed constant in the test**, never imported from production — the anti-paraphrase convention already used for the §4 legal prose. Importing pins which constant is referenced, never what it says.
- Mutation-verified: swapping the new price reason for `NO_BENCHMARK_REASON` must fail; deleting the excluded-line sentence must fail; reverting the banner must fail.
- The 2027 fix needs a test that the **selector still matches the reason** — the whole defect was those two disagreeing.
- A test that a below-threshold year with **no** excluded lines does *not* grow the new sentence, so the addition cannot become boilerplate that always prints.

## Explicitly not in scope

- Extending `pack.prices` to cover 2027/2028, or clamping the date input. Refusing is correct; only the message is wrong.
- The half-verified / mixed-tier fallback (its own spec).
- The remaining audit items: §4 paraphrase pin, `differential.test.ts`'s missing indirect arm, IR 2026/1740 rebuild, `Art 2(2)` → `Art 1(2)`, placeholder source hashes, Annex IV tier, UK CBAM, the audit PDF's worked example.
- Any change to a computed figure. If a figure moves, the change is wrong.
