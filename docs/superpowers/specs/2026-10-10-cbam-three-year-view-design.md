# CBAM calculator: benchmark cross-check and the three-year view

**Date:** 2026-10-10
**Status:** design approved 2026-10-10; amended after dry runs (section 9) and a pre-PR audit (section 3). Part 1 (section 3) is implemented on this branch. Parts 2 and 3 are not started.
**Preview:** layout C of the three-year view, agreed with the founder on 2026-10-10.

## 1. Goal

Two additions to the CBAM calculator at `/cbam/cbam-calculator`.

1. **Benchmark cross-check.** A test that compares the calculator's free-allocation benchmarks,
   Column A and Column B, with the Annex to IR (EU) 2025/2620 as printed in the Official Journal.
2. **Three-year view.** For the shipment the user has entered, show the certificates to surrender
   in 2026, 2027 and 2028, and why the count rises.

Neither addition forecasts anything. Every figure comes from law that is already published and
from the engine the calculator already uses.

## 2. Background, as measured on 2026-10-10

### 2.1 The calculator refuses every 2027 and 2028 date

The estimator pack holds four certificate-price rows, all for 2026. `resolveCertificatePrice`
throws `REGULATION_NOT_FOUND` when no row matches the quarter, so every 2027 and 2028 import date
returns `unavailable`. This is the "price wall" on the calculator's open list.

The rest of the law for those years is already in the pack:

| Table | Coverage |
|---|---|
| Default values and their mark-up | 2026, 2027, 2028 (mark-up 10%, 20%, 30%; 1% for some rows) |
| Free-allocation factor (`cbamFactors`) | 2026 to 2034 (0.975, 0.95, 0.90, …, 0) |
| Benchmarks | 2026–27 and 2028–30 |
| Cross-sectoral correction factor | pending for 2026 to 2030 |

### 2.2 A pending price row is enough to lift the refusal

The engine already treats a price row with `status: 'pending'` as "price not published": it
returns certificates and a `null` cost. That is how 2026-Q3 and 2026-Q4 work today.

Measured with the real engine and eight pending rows (2027-Q1 to 2028-Q4) added to a copy of the
pack in memory: 2027 and 2028 dates stop refusing and return the same `cscf_pending` shape as 2026.
No engine code changed.

For 100 t from India on default values, direct emissions only:

| Good | Route | 2026 | 2027 | 2028 | Rise |
|---|---|---|---|---|---|
| Welded tube, `73063077` | (C) | 329.8275 | 376.755 | 427.41 | +29.6% |
| Seamless line pipe, `73041910` | (C) | 340.3575 | 387.015 | 437.13 | +28.4% |
| Hot-rolled coil, `72083900` | (C) | 337.225 | 383.45 | 433.1 | +28.4% |
| Iron powder, `72052100` | (F) | 137.05 | 166.1 | 213.38 | +55.7% |

All four assume a cross-sectoral correction factor of 1, as the calculator's 2026 figures do.

### 2.3 Three legal causes, and the benchmark is the smallest

| Cause | 2026 → 2028 | Applies to |
|---|---|---|
| Mark-up on default values | 10% → 30% | lines priced on default values, except the rows whose mark-up is 1% in every year |
| Free allocation retained | 97.5% → 90% | every line |
| Benchmark step in 2028 | median −3.2%, largest −11.1% | 176 of 570 goods; routes (F), (G), (H), (J) and goods with no route |

For the welded tube, the rise is 97.5825 certificates: 86.4 from the mark-up and 11.1825 from
free allocation. The benchmark for route (C) does not change.

### 2.4 Certificate prices are weekly from 2027

The 2026 price is a quarterly average. From 2027 the Commission publishes a weekly price
(Implementing Regulation (EU) 2025/2548, per the Commission's certificate-price page). The pack
keys prices by quarter, so a 2027 row must not read as a quarterly price that will be published.

### 2.5 The pack's benchmarks equal the regulation's

The pack's benchmarks were built from the Commission's benchmarks workbook. That workbook calls
itself informational: the legally valid values are those in the Annex to IR (EU) 2025/2620.

The Official Journal PDF of the regulation (OJ L, 22.12.2025) was parsed on 2026-10-11. Its
SHA-256 is the one the pack already records for its source `ir-2025-2620`.

- 570 goods, 661 printed Column A values and 1,804 printed Column B values. The pack has 661
  Column A rows and 1,804 Column B rows.
- In each period 650 Column A cells and 1,418 Column B cells are in force. Every one equals the
  pack's value, and the pack has no row the PDF lacks.

Two parsers read the PDF and agree on every cell. The build script decides a value's column by
where it starts on the text line. An independent reviewer used the PDF's word coordinates. A
number inside a goods description, such as the foil thickness "0,021 mm" under `76071990`, is
read as a benchmark by neither.

## 3. Part 1: the benchmark cross-check

### 3.1 What is added

- **`tests/fixtures/cbam-benchmarks-ir-2025-2620.json`.** The Annex's benchmarks as
  `{ cn, route, value }` cells, grouped by period (`2026-2027`, `2028-2030`) and column (`A`,
  `B`). The header records the regulation, its ELI and the PDF's SHA-256.
- **`tests/unit/cbam-benchmarks-crosscheck.test.mjs`.** Per period and column:
  1. Every fixture cell equals the pack's value for that good and route, as decimals.
  2. Every pack row in force has a fixture cell.
  3. The fixture holds 650 Column A cells and 1,418 Column B cells.

  It also checks that the fixture's SHA-256 and ELI are the ones the pack records for
  `ir-2025-2620`, so the fixture cannot drift to a different document unnoticed.

  The pack is asked which rows are in force at one instant per period. That is sound only
  because a further check pins every benchmark row to one of the three validity windows in the
  pack (2026 onward with no end, 2026–2027, 2028–2030), and to a route and column the
  comparison can read. Duplicate rows and a value stored as a number are reported too.

### 3.2 Failure output

A failure names the good, the route, the period and both values. One mismatch is one line.

### 3.3 Proof the test bites

The test carries a self-proof: it alters a copy of the pack in memory in each way it claims to
detect and asserts the exact line reported. That self-proof is itself proved by disabling, on
copies outside the repository, each check it depends on. Ten such breakages were run on
2026-10-11; all are caught. The test file in the repository is never weakened in place.

### 3.4 Stated limit

The test covers benchmarks only. Default values, the free-allocation factor, the correction
factor and certificate prices are not checked by it.

### 3.5 When the Commission revises a benchmark

The test fails at the next sync. The fix is to rebuild the fixture from the amending act with
the build script recorded in the plan, and commit it with the regulation cited.

## 4. Part 2: the three-year view

### 4.1 Data change, made at the source

The pack is generated in the upstream CBM repository and vendored here by commit hash. The
change is made there, then synced.

**In CBM:**

- `scripts/build-fa-package.py`: add eight rows to `PRICES`, `2027-Q1` to `2028-Q4`, with no
  value and status `pending`. Their source locator reads: "From 2027 the Commission publishes a
  weekly certificate price (IR (EU) 2025/2548); none published as at <date>."
- Regenerate the golden rule package and `public/estimator-pack.json`.
- Update the tests that pin "nothing prices in 2027". Section 9 lists what a dry run found: 10
  failing tests in 7 files. The message-reachability guard is one. It must still find the price
  refusal reachable for a year with no row (2029 onwards), or have its expectation changed with
  a stated reason.
- No change to any file under `lib/cbam/` or `lib/estimator/` that this repo vendors.

**In this repo:**

- Record the new upstream commit and pack with `scripts/cbam-sync-check.mjs`.
- Update the tests here that pin the 2027 and 2028 refusals.

### 4.2 What changes in the main form

After the sync, a 2027 or 2028 date in the main form returns certificates with no cost. Nothing
in this repo may decide that by comparing a year with 2027: `priceNoteFor`'s own note records why
a hard-coded year becomes a false claim the day the corpus changes. Every statement comes from
the pack.

- **The banner** (`cbam-calculator.astro`, pinned by `BANNER_71` in the render tests) says "a 2027
  or 2028 import shows no figure". That becomes false. Proposed replacement for the two sentences
  starting "This tool prices 2026 imports": "This tool counts certificates for 2026, 2027 and 2028
  imports, and shows a cost only for the quarters the Commission has priced. From 2027 the
  certificate price is published weekly, and none is in this data yet." The founder approves the
  final wording.
- **`priceNoteFor`** stays keyed on row existence, so it goes silent for 2027 and 2028 by itself.
  It gains one condition: it speaks only for a year the default values cover. Today it would tell
  a 2029 date that "the goods, routes and benchmarks are published", which is false for 2029.
- **The price row in the result card** is unchanged. It already reads "Certificate price 2027-Q1 ·
  not published (pending)" for a pending row.
- **`docs/cbam-policy-assumptions.md`** states the wall in two places and is corrected.

### 4.3 The outlook module

New file `src/scripts/cbam-outlook.ts`. It is not vendored and holds no regulation arithmetic.

```ts
outlook(pack, input): OutlookYear[]
```

- **Years.** The reporting years the pack's default values cover. Today that is 2026, 2027, 2028.
- **Date per year.** The user's month and day in each year. 29 February becomes 28 February.
- **Per year.** One call to `estimateFromPack` with only the date changed. The module keeps the
  engine's status, certificates, cost, embedded emissions, free allocation and factor.
- **A refused year** keeps the engine's own reason and shows no figure.

### 4.4 The split of the rise

Computed from the engine's outputs for the first and last year, with `decimal.js`:

```
rise            = certificates_last − certificates_first
more emissions  = embedded_last − embedded_first
less allocation = allocation_first − allocation_last
  of which factor    = allocation_first × (1 − factor_last / factor_first)
  of which benchmark = less allocation − factor part
```

`rise = more emissions + less allocation` when no year floors at zero. The split is shown only
when that identity holds exactly for the line. Otherwise the strip shows the three counts and no
split.

"More emissions" is labelled as the mark-up only when the line's tier is default values. For a
verified line the term is zero and the row is not shown.

### 4.5 On the page: layout C

Rendered under the existing result card for the line being previewed. Not shown for document
totals.

- **Header.** "The same shipment, 2026 to 2028" and a tag "Law as published · <pack date>".
- **Three year cards.** Year, certificates, and from the second year the percentage rise on the
  first. Below: the cost where a price is published, otherwise "none published" in the weight of
  a figure, with "as at <pack date>" beneath it. The words come from the pack: the row is pending
  and the date is the pack's own. Under the strip, the pending rows' own source locators are
  printed once each. For 2027 and 2028 that locator is the sentence about weekly prices.
- **Why it rises.** One stacked bar and a legend with three rows: mark-up, free allocation
  retained, benchmark. Each row gives its certificates. A row that is zero says so in words.
- **Show the working.** A native `<details>` holding a table: emissions counted, free allocation
  deducted, certificates, cost, one column per year, with the mark-up, benchmark and factor
  beneath each figure.
- **Your own price assumption.** One number input. It fills the cost for years with no published
  price. It never replaces a published price. It is labelled as the user's assumption in every
  place it appears, is not stored, and is not written to the CSV export.

Styles follow the calculator's existing card, tag and field rules and the site's tokens.

### 4.6 Wording rules

- Figures are "under the law as published on <date>". Nothing says what the user "will pay".
- The mark-up row says: "It applies only while you use the Commission's default values. With
  verified emissions it no longer applies." It does not say verified data lowers the bill: a
  plant's verified emissions can be above or below the default.
- The correction-factor caveat the calculator already shows is repeated once under the strip.

### 4.7 States

| State | Behaviour |
|---|---|
| Route has no default value for the origin (India, routes (D) and (E)) | the year card shows the engine's reason; no split |
| Verified figures entered | no mark-up row; free-allocation rows only |
| Free allocation exceeds emissions in any year | counts shown, no split |
| Good, origin, route, mass or date incomplete | strip not shown |
| Date outside the years the pack covers | strip not shown; the main form's own refusal stands |
| Indirect emissions in scope | included in the counts by the engine; the split is shown only if the identity in 4.4 holds |

## 5. Testing

- **Outlook unit tests.** The four lines in section 2.2 pin all three counts and the split.
  Separate cases for a refused year, a verified line, a zero floor, and 29 February.
- **Mutation proofs.** Break the date substitution, the factor split and the identity guard in
  turn. Each must fail a named test. Confirm each mutation landed.
- **Render tests.** The strip's text for each state in 4.7, and the price input's effect on a
  published and an unpublished year.
- **One e2e test.** Enter the welded-tube line, read the three counts, open "Show the working",
  type a price, read the 2028 cost.
- **Gates.** `npm run check`, `npm run test:unit`, the Chromium, Firefox and WebKit CBAM e2e
  projects, and the sync check.
- **CBM.** Its own unit and integration gates, green before the sync.

## 6. Risks

- **The law may change.** A Commission proposal of 17 July 2026 to revise the EU ETS,
  COM(2026) 616, is reported to lengthen the free-allocation transition for CBAM sectors. It is
  not adopted and has not been read for this spec. If it is adopted, re-check `cbamFactors`
  before the next release. The "law as published" tag is what keeps the strip correct meanwhile.
- **The correction factor is unpublished** for 2026 to 2030. Every count is a what-if on that
  point, as it is today.
- **The page's selection code is fragile.** `cbam-app.ts` has a history of ordering defects
  between the good, origin and route fields. The strip only reads the finished estimate and
  writes its own container. It does not touch those fields.
- **Two repositories.** The CBM change and the sync here ship as two reviewed changes, CBM first.

## 7. Out of scope

- Any price forecast. It can later supply the price this view multiplies.
- Search by product family, and estimates at four-digit heading level.
- Document totals across several lines.
- Years after 2028.
- Publishing the 2026-Q3 price. It was due on 5 October 2026. It rides along only if the figure
  is read from the Commission's page by a person; otherwise it is its own change.

## 8. Order of work: three plans, three reviewed changes

1. **Benchmark cross-check.** This repo only. Fixture, test, built-in mutation proofs. Done.
2. **Lift the 2027–28 refusal.** CBM first: price rows, regenerated data, test updates. Then the
   sync here: banner, `priceNoteFor`, the tests that pin the refusal, the policy document.
3. **The three-year view.** This repo only. Outlook module, strip, tests. It can be built before
   plan 2 lands, against a pack with the rows added in memory; it ships after plan 2.

Each ends with the full gates and an independent review before any push.

## 9. Dry-run findings, 2026-10-10

Measured in scratch copies. Nothing below is committed anywhere.

**The data change is clean.** The Commission's benchmarks workbook still downloads from the URL
CBM records, and its SHA-256 matches the pinned one. Both CBM generators reproduce the committed
rule package and pack byte for byte. With the eight rows added, the rule package gains 80 lines
and nothing else moves.

**More depends on the refusal than section 4 assumed.**

| Where | What reacts to the eight rows |
|---|---|
| This repo, unit tests | 6 of 196 calculator tests fail, plus the pack-hash test until the sync is recorded |
| This repo, e2e | 2 tests assert a warning at a 2027 date |
| This repo, copy | the banner, and two statements in the policy-assumptions document |
| CBM, unit tests | 10 of 575 fail, in 7 files |

**Two kinds of failure.**

- *The fixture is gone.* Several tests in both repos need a line that refuses on the missing
  price after the electricity default has been substituted. A 2027 date was the only such line.
  After the change no shipped line refuses that way. Those tests keep their purpose by running
  against a pack with the pending rows removed, which is the corpus state they describe.
- *The claim is gone.* Tests named for "the 2027 price wall", and CBM's message-reachability
  guard, assert that the refusal is reachable from shipped data. It no longer is. Each is
  rewritten to assert the new behaviour, or allow-listed with the reason.

**The threshold is separate.** The pack holds a de-minimis threshold rule for 2026 only. A 2027
line will show certificates and, above them, the existing "no published rule" threshold card.
That is today's behaviour for the threshold and is not changed here.
