# CBAM calculator: lift the 2027 and 2028 refusal (plan 2 of 3)

**Date:** 2026-10-13
**Spec:** `docs/superpowers/specs/2026-10-10-cbam-three-year-view-design.md`, sections 4.1, 4.2 and 9.
**Branches:** upstream `feat/pending-price-rows-2027-28`; this repo `feat/cbam-three-year-view-2`.
Local commits only. Nothing is pushed and no pull request is opened by this plan.

## Goal

A 2027 or 2028 import date returns a certificate count with no cost, instead of a refusal. The
count is already computable: the default values, benchmarks and free-allocation factor for both
years are in the pack. Only a certificate-price row was missing, and the engine refuses a quarter
that has no row.

Fixed at the source: eight `pending` price rows, 2027-Q1 to 2028-Q4, with no value, added in the
upstream generator and synced here. No local shim. No change to how the engine decides anything.

## What the rows are, read from the regulation

Implementing Regulation (EU) 2025/2548, read on 2026-10-13 (EUR-Lex itself sits behind a script
challenge, so the articles were read from a third-party copy of the text and from the Commission's
certificate-price page; neither was hashed):

- Art 1: for 2026 the Commission calculates one price per quarter, in the first week after the
  quarter ends. It applies by the quarter in which the goods were imported.
- Art 5: from 1 January 2027 the price is calculated every calendar week, as the volume-weighted
  average of the auction clearing prices since the last calculation.
- Art 8: that weekly price is published on the first working day of the following week.
- Art 5(5): it applies to the certificates sold in that week.

So a 2027 or 2028 row is **not** a quarterly price awaiting publication, and no per-quarter figure
will ever fill it. It is the engine's quarter key carrying "no price published". Every sentence a
person can read about it must come from the row's own `sourceLocator`, never from the quarter key.

The Commission's price page on 2026-10-13 shows no 2027 price. It also shows a Q3 2026 price,
published 5 October 2026. Recording that is out of scope here (spec section 7). The owner agreed on
2026-10-14 that it is added as its own later change.

## Measured before writing this plan

| Fact | Measured |
|---|---|
| Upstream starts green | 575 of 575 unit tests, typecheck clean, on the branch point |
| Both upstream generators reproduce committed data | byte for byte, workbook SHA-256 matches the pinned one |
| Eight rows added | +80 lines in the golden package, nothing else moves |
| Upstream tests that react | 9, in 6 files (the earlier dry run counted 10 in 7) |
| Tests here that react | 6 calculator unit tests, plus the pack-hash pin |
| Engine note on a pending row | reads "has not published the 2027-Q1 certificate price" |

The last row conflicts with the spec. Section 4.1 says no vendored file changes. But the engine
attaches that note to every line whose price row is pending, the page prints notes verbatim, and
"the 2027-Q1 certificate price" names a figure that will never exist. The safer reading is taken:
one sentence in the engine is reworded so it is true of a pending row in either regime. No figure,
status or selector moves. It is its own upstream commit so it can be reviewed alone. The owner approved the
reworded sentence on 2026-10-14.

## Traps that bind this plan

1. `priceNoteFor` may not decide anything by comparing a year with 2027. Its wording comes from
   the pack.
2. With 2027-28 rows present, `priceNoteFor` must not tell a 2029 date that "the goods, routes and
   benchmarks are published". It speaks only for a year the default values cover.
3. No 2027 or 2028 row is called a quarterly price anywhere a person reads.
4. Tests that need "a refusal on the missing price after the electricity substitution" lose their
   only fixture. They run against the pack with the eight rows removed. They are not weakened.
5. `cbam-app.ts` closures are not reachable from unit tests. Changed paths are proved in a browser.
6. A date gate must parse with the function its consumer parses with.
7. Mutation proofs run on a copy outside the repository.
8. `git add` and `git commit` are chained with `&&`, and `git status` is read afterwards.

## Part A: upstream

### Task A1. The rows

- `scripts/build-fa-package.py`: `PRICES` gains a fifth field, a locator override. Eight rows are
  generated for 2027 and 2028 with status `pending`, no value and no publication date. Their
  locator reads "From 2027 the Commission sets a weekly certificate price, applying to
  certificates sold in that week (IR (EU) 2025/2548 Arts 5 and 8); none published as at <date>".
  The date is the certificate-price source's own `retrievedAt`, read from `SOURCES`, so the
  sentence cannot claim a later reading than the hash on record.
- Regenerate `golden/rule-packages/eu-cbam-2026-free-allocation.json`, then
  `public/estimator-pack.json` and its manifest with `--deterministic`.
- Update the pack hash in `src/stores/estimator.ts` and `lib/estimator/load-pack.test.ts`.

**Check:** the golden package diff is +80 lines and no deletions.

### Task A2. Tests

| File | Change |
|---|---|
| `lib/regulatory/fa-package.test.ts` | new: the eight rows, whole locator sentence, date equals the source's, no "quarter" wording, 12 rows in all |
| `lib/cbam/message-reachability.test.ts` | the sweep gains `2029-02-15`, so the price refusal is still produced by shipped data (an attested line; the defaults tier refuses earlier) |
| `lib/estimator/refusal-reason.test.ts` | price refusal asserted on the pack without the eight rows, with a count guard; a second assertion on the shipped pack at 2029; new test that 2027 and 2028 return a count, a null price and a null cost; the selector-agreement sweep walks both packs |
| `lib/estimator/estimate-from-pack.test.ts` | "the 2027 price wall" becomes: no cost at 2027, refusal at 2029 |
| `lib/estimator/mixed-tier.test.ts` | the refused mixed line runs on the pack without the eight rows |

### Task A3. The note wording (separate commit)

- `lib/cbam/certificate-estimate.ts`: "has not published the <quarter> certificate price" becomes
  "has not published a certificate price for imports in <quarter>". Three comments that record
  measurements from the old corpus each gain a line saying the corpus changed.
- `src/components/case/cards/WhatIfCard.vue`: the same wording.
- `lib/estimator/refusal-reason.test.ts`: the note is pinned whole.

### Gates, upstream

`npm test`, `npm run typecheck`, and both generators run again on the committed tree with no diff.
The database suite needs Docker, which this machine does not have: reported as not run.

## Part B: this repo

### Task B1. Sync

- Copy `public/estimator-pack.json` and its manifest to `public/cbam/`.
- Copy `lib/cbam/certificate-estimate.ts` to `src/scripts/cbam-algos/cbam/`. Confirm the other 13
  vendored files are byte-identical to upstream.
- `CBAM_UPSTREAM_COMMIT=<sha> node scripts/cbam-sync-check.mjs --update`, then run it plainly.
- Update the pack hash in `src/scripts/cbam-algos/cbam-app.ts` and `tests/unit/cbam-pack.test.mjs`.

The recorded upstream commit is local and unpushed. If upstream is squash-merged its hash changes,
and `UPSTREAM.json` must be recorded again against the merged commit before this branch ships.

`tests/fixtures/cbam-golden.json` is not regenerated. No test reads it, and it was already out of
date before this change (regenerating moves about 4,400 lines unrelated to this work). Reported.

### Task B2. `priceNoteFor`

`src/scripts/cbam-algos/cbam-app.ts`.

- Parse with `parseRegulatoryDate`, the function the engine parses with.
- Return null when a price row exists for the quarter (unchanged).
- Return null when no default value has that reporting year. The route control already says "no
  rules published for <year>" there.
- Otherwise the sentence, reworded so it does not name a quarterly price.

On the shipped pack this returns null for every date: 2026 to 2028 have rows, and no other year is
covered. It stays because it is the data-driven guard for a pack that has a covered year without a
price row, and it is tested on such a pack.

### Task B3. The price row in the result card

`renderWater`: "Certificate price 2027-Q1 · not published (pending)" reads as a quarterly price
that is on its way. It becomes "Certificate price · imports in 2027-Q1" and "none published". The
same words serve 2026-Q3. A published price is unchanged apart from the label.

### Task B4. The banner (option A approved 2026-10-14)

`src/pages/cbam/cbam-calculator.astro` and `BANNER_71` in `tests/unit/cbam-render.test.mjs`. The
two sentences beginning "This tool prices 2026 imports" are replaced. Three options went to the
owner, who approved option A as drafted on 2026-10-14. The banner is markup and cannot read the
pack, so its "as at" date is typed, and a test fails if it is not the pack manifest's own date.

**The options.** Each replaces the sentences from "This tool prices 2026 imports" to "labelled
what-if". The date is the pack's own and is checked by a test.

- **A (implemented; approved 2026-10-14).** "This tool counts certificates for 2026, 2027 and 2028
  imports, and shows a cost only where the Commission has published a certificate price. For 2026
  the price is set per quarter. From 2027 it is set weekly: none published as at 18 August 2026,
  so a 2027 or 2028 import shows certificates and no cost. No final figure exists for any of these
  years — the cross-sectoral correction factor is unpublished — so any number below is a labelled
  what-if."
- **B (shorter).** "This tool counts certificates for 2026, 2027 and 2028 imports. A cost appears
  only for the 2026 quarters the Commission has priced. For 2027 and 2028 the price is weekly,
  with none published as at 18 August 2026, so those imports show certificates and no cost. The
  cross-sectoral correction factor is unpublished for all three years, so any number below is a
  labelled what-if."
- **C (closest to the spec's draft).** "This tool counts certificates for 2026, 2027 and 2028
  imports, and shows a cost only for the quarters the Commission has priced. From 2027 the
  certificate price is published weekly; none published as at 18 August 2026. For every year
  shown, no final figure exists — the cross-sectoral correction factor is unpublished — so any
  number below is a labelled what-if."

A was recommended and chosen: it is the only one that says in so many words what a 2027 or 2028 import
returns, which is the sentence the old banner got wrong.

### Task B5. Unit tests

`tests/unit/cbam-render.test.mjs`:

| Test | Change |
|---|---|
| a 2027 date refuses on the PRICE | asserted on the pack without the eight rows; new test for the shipped pack: count, null cost |
| a verified-path refusal carries the tier the engine attempted | pack without the rows |
| renderAttestation: a refused mixed line drops the electricity clause | pack without the rows |
| a refused mixed line drops the residual-indirect note | pack without the rows |
| the date note fires only where the corpus carries no price row | shipped pack: silent 2026 to 2028; pack without the rows: speaks for 2027 and 2028; 2029: silent on both |
| the date note says what is published | pack without the rows |
| `BANNER_71` | the new text |
| new | the price row wording for a pending and a published row |
| new | no rendered card for a 2027 or 2028 line contains "quarterly" or "<quarter> certificate price" |

### Task B6. Browser tests

`tests/e2e/cbam-lines.spec.ts`: the two tests that expect a warning at a 2027 date become: no
warning, the route control enabled, and a 2027 line shows a certificate count, "none published"
and no euro figure. A 2029 date keeps the date note empty and the route control disabled.

### Task B7. Documents

`docs/cbam-policy-assumptions.md` and its `.html` twin: three statements say the pack prices 2026
quarters only (the spec counted two). Each is corrected, and the claim "published per quarter, in
arrears" is limited to 2026.

Stale comments in `cbam-app.ts` that describe the wall are corrected in the same commit as the
code beside them.

### Gates, this repo

`npm run check`, `npm run typecheck`, `npm run test:py`, `npm run build`, `npm run test:unit`,
`npm run check:publication`, and the CBAM browser spec in Chromium, Firefox and WebKit only.

### Proof on the page

Worked example: 100 t of welded tube, CN 73063077, India, route (C), default values. Derive the
three counts by hand from the pack's rows and the regulation's formula, then read them off the
page at a date in each year.

### Mutation proofs (on a copy outside the repository)

1. Drop the coverage condition from `priceNoteFor`: the 2029 assertion must fail.
2. Restore a `year >= 2027` test in `priceNoteFor`: the shipped-pack assertion must fail.
3. Restore the old price-row wording: the wording test must fail.

Each mutation is confirmed present in the copy before its run is believed.

## Not in this plan

The three-year strip (plan 3). The Q3 2026 price. The de-minimis threshold for 2027 and 2028: a
2027 line still shows the existing "no published rule" threshold card above its count.
