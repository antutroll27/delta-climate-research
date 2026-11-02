# CBAM calculator audit, 2 November 2026

**What was audited:** origin/main `1805afb`, which is what is live on deltaclimate.earth. Local `main` is 217 commits behind it, so it was not used.

**Audit worktree:** `/Volumes/OBOSLab/worktrees/cbam-audit-1102` (detached, read-only, nothing modified).

**Evidence:** every probe script and its output are in `/Volumes/OBOSLab/tmp/cbam-audit-1102/{engine,app,lines,tests}/`.

**Method:**
- Four independent auditors (Opus): engine and pack; app layer; lines/outlook/graphs; tests and CI.
- Every finding below was reproduced by running code, not by reading it.
- The items marked ✔ were re-run or re-checked a second time by the lead.

**Baseline:** the CBAM unit tests pass 279/279, with 0 skipped. The vendored-engine sync check passes against upstream `7e0d4d7`.

## Bottom line

**The arithmetic is right.**
- An independent re-implementation of the formula agreed with the engine on 762,360 estimates, with zero disagreements. That covered 352,728 estimates on one date across every origin and both scopes, plus 409,632 across eight boundary dates.
- Every figure tested matched the regulation term by term: the CBAM factor schedule, the mark-ups, the floor on the direct side only, rounding once at the end, and Decimal throughout.
- No exploitable XSS was found in 41 renders with a hostile payload. All 22 `innerHTML` sinks are escaped or static.

**What is wrong is the de minimis rule and the wording around the figures.** Two items are false legal claims on the live page. One shows a bill beside an exemption verdict. One input path inflates a figure tenfold without warning.

## Critical: false or contradictory on the live page

**C1 ✔ "No de minimis threshold has been published for 2027 / 2028". This is false.** Found independently by two auditors.
- **The law:** Reg 2023/956 Art 2a(1) and Annex VII point 1, inserted by Reg 2025/2083, set a 50 t threshold "in a given calendar year" with no end date. Under Art 2a(3) it can change only by delegated act.
- **The cause:** the pack ships a single threshold row, `calendarYear: 2026`.
- **Where:** `cbam-app.ts:390-397` (renderYearThreshold, the no-rule arm), reached from `renderDraftThreshold`, `runPreview` and `thresholdByYear` (`cbam-lines.ts:330`). The comment at `cbam-lines.ts:290` repeats the false premise.
- **Reach:** every 2027 or 2028 date, on both the single-line and the multi-line path.
- **Fix:** add 2027 and 2028 threshold rows (50 t, the same four sectors, cited to Art 2a and Annex VII), upstream in CBM, then re-vendor.

**C2 ✔ A year ruled below the threshold still shows a "Total exposure" bill.**
- **Example:** 30 t of steel in 2026, ticked as a complete list. The year card says "Below threshold". The total card says "Total exposure · 98.948 certificates · €7,456.74".
- **Mixed sectors:** for 40 t of steel plus 1,000 t of hydrogen, the €9,942 for the exempt steel is still inside the total.
- **The contradiction:** the page's own single-line card says "Below 50 t an importer owes nothing for the year".
- **Where:** `cbam-app.ts:2745` (`sumTotals` takes every priced line whatever its year's verdict) and `:548-584`.
- **Fix:** exclude attested below-threshold years from the total, or show them as a separate "exempt if your list is complete" amount.

**C3 ✔ The residual default is described as "a world-average value".**
- **The law:** Annex IV §4.1, as replaced by Reg 2025/2083, defines it as "the average emission intensity of the 10 exporting countries with the highest emission intensities". It is deliberately pessimistic, so telling an exporter it is a world average understates what verified data could save them.
- **Where:** `certificate-estimate.ts:271-274` (`RESIDUAL_BASIS_NOTE`) and `:289-292` (`MIXED_RESIDUAL_INDIRECT_NOTE`), rendered at `cbam-app.ts:235`. The same wording appears in comments in `estimate-from-pack.ts:781,814`, `iso-3166.ts:11`, and `docs/cbam-policy-assumptions.md` D10, D11 and line 1575.
- **Tests that pin the wrong text:** `cbam-golden.json:361,441,522,602` and `cbam-render.test.mjs:1961`.
- **Fix:** change it upstream in CBM, then re-vendor. The sync check blocks local edits.

## High

**H1 ✔ A decimal comma silently changes a figure tenfold or more (Chromium).**
- **Cause:** `#cbMass`, `#cbSeeDirect` and `#cbSeeIndirect` are `type="number"` (`cbam-calculator.astro:131,139,153`). Typing `0,85` into the verified direct field gives the value `085`.
- **Result:** the card prices 8,500 tCO₂e at €630,493.79 beside the words "transcribed exactly as entered". Mass `2,5` becomes 25 t.
- **Scope:** the same result in en-US, en-GB, nl-NL and de-DE locales. Firefox and Safari were not tested.
- **Fix:** `type="text" inputmode="decimal"`, parse with the engine's `nonNegativeDecimal`, and refuse a comma by name. This also closes A5 below.

**H2 ✔ The "why it rises" dot chart has no cap.**
- **Measured:** at mass 1e10 t it draws 11,340 SVG dots (1.5 MB of SVG). At 1e11 t it is 15 MB. At 1e15 t the probe ran out of JavaScript heap.
- **Cause:** `cascadeUnit` tops out at 1e7, and `Array(total).fill` follows (`cbam-graphs.ts:535-549`). The mass field has no maximum.
- **Fix:** derive the unit as 10^ceil(log10(max/52)), or skip the chart above a dot cap.

**H3 (legal question, medium confidence) Factor, CSCF and benchmark window are keyed on the IMPORT date.**
- **What IR 2025/2620 says:** it defines year *y* as the year the good was produced (Annex point 1(2)). The repo's own `docs/cbam-policy-assumptions.md` A10 reads the windows as production years.
- **Example:** a good produced in 2027 and imported on 1 January 2028 gets factor 0.90 instead of 0.95 and the second-period benchmark. For 1,000 t of 72021120 from CN, that is 735 certificates if imported on 31 December 2027 and 1,048 if imported on 1 January 2028. Part of that jump is the legitimate mark-up step.
- **Euro impact today:** none, because 2027/28 prices are pending.
- **Needs:** a reading of IR 2025/2547 Art 7, which may set how *y* is identified, before deciding. Then either ask the user for the production year or state which year was used.

## Medium

- **M1 ✔ The sync check misses two cases** (`scripts/cbam-sync-check.mjs:58-109`):
  - An extra file in the vendored tree passes, with exit 0 (re-run on a copy).
  - `--update` re-seals a locally edited file under the unchanged upstream SHA, and CI has no upstream checkout, so CI would pass it. A missing file crashes the script with ENOENT rather than reporting MISSING.
- **M2 Price wording for 2027 and 2028 says "quarter"**:
  - `cbam-outlook.ts:679` says "no price is published for the import's quarter". `cbam-graphs.ts:298-302,346,362,954,957` say "2027-Q1" and "this import's quarter".
  - From 2027 the price is weekly under IR 2025/2548.
  - The strip's notes do carry the weekly locator. Not re-run by the lead.
- **M3 Years with no rules are explained only inside a disabled `<select>`**:
  - For a 2029 date, the reason sits inside a select that keyboard users cannot reach.
  - Meanwhile the live region tells a user who has filled in every field to "Choose a good, origin, route, mass…" (`cbam-app.ts:2010-2016,2255-2258`).

## Low

- `cbam-app.ts:244,431`: the citation reads "Regulation (EU) 2025/2083 … · as amended by Reg (EU) 2025/2083". It should be "Reg (EU) 2023/956 Art 2a and Annex VII, as amended by 2025/2083". ✔ seen in output.
- Exactly 50 t is worded "below the 50 t threshold". It should say "does not exceed" or "at or below". 50.0001 t displays as "50 t" next to an "Above threshold" tag (`:427-428`). ✔
- `#cbRef` has no `input` listener, so the preview's "Ref:" stays stale until another field changes (`:3092-3122`).
- Mass display goes through `Number().toLocaleString`:
  - `0.0004` shows as "0 t" beside €0.07.
  - `-0` is accepted and shows as "-0 t", and becomes `'-0` in the CSV.
  - Very large masses lose digits in the display only; the engine stays exact.
- A5: the verified-figure gate uses `Number()`, not the engine's parser (`:1577-1580`). It is latent while the fields stay `type=number`.
- The year is derived four different ways: `syncRoutes`, `renderDraftThreshold`, `yearOf` and `parseRegulatoryDate`. A typed year such as `27576` gives "no rules published for 2757". The comment at `:494`, which claims "the same expression", is false.
- The engine has no Annex II gate on attested indirect figures for steel or hydrogen. It is unreachable because the UI hides the field.
- The pack validator accepts nonsense: factor 1.5, CSCF 7, price 0, validFrom after validTo. It is unreachable because the SHA pin runs first.
- Documentation drift:
  - `certificate-estimate.ts:64-66` and assumptions A6 list hydrogen as charged for indirect emissions. The engine correctly does not; the third case is actually sintered ore 26011200.
  - Assumptions D6 says Mali hydrogen fails closed. It prices 0, which is correct.
- `cbam-outlook.ts:277/299`: a falling count would be explained as "floor". It is not reachable with the shipped pack, where 0 of 397 benchmark steps rise.

## Tests: what a regression could slip through

Of 20 code mutations, 15 were caught. These survived; the lead confirmed that M08 and M10 landed and ran green:

| Mutation | Effect if shipped | Caught by |
|---|---|---|
| M08: benchmark `validTo` `<=` → `<` | 72052100 (F) on 2027-12-31 refuses instead of 166.1 certificates | **nothing** (all 11 files green) ✔ |
| M10: aluminium dropped from the de minimis sum | 30 t aluminium + 30 t cement reads as exempt | **nothing** ✔ |
| M19: 3105 fertilisers lose their sector | 60 t fertiliser reads as exempt | nothing (graphs-more not run) |
| P6: fertiliser 2026 mark-up 1% → 10% in the pack | 5,278 rows wrong | only the hash literal; no value test |
| M04 / M07 | floor over the total / validFrom strict | caught by only 1 and 2 tests respectively |

- **Only the benchmarks have an independent oracle** (the IR 2025/2620 crosscheck). Mark-ups, factors, prices and thresholds are checked only through a handful of hand-computed figures.
- **`tests/fixtures/cbam-golden.json` is read by nothing.** It is stale (built from pack v2, while v3 is live) and 32 of its 151 rows are duplicates. Delete it, or wire it into a test.
- **E2E gaps:**
  - nothing asserts the multi-line total or the € figure, or the CSV `cost_eur`/`certificates` columns;
  - no non-cement good appears in any threshold test;
  - no refused line pushes a year over 50 t;
  - no boundary dates.
- **E2E scope in CI:** e2e runs on PRs only, not on a push to main, and `webkit-cbam` is excluded.

## Ledger corrections

These are items the old ledger listed as open:

- **The `'not-a-date'` fail-open in `active()` is CLOSED in the vendored copy.** It now throws `REGULATION_NOT_FOUND date/not-a-date`. If it survives anywhere, it is in the CBM SaaS resolver.
- **The single-line empty threshold card is mostly fixed.** It now shows a "No published rule" card, which is false for 2027/28: see C1.
- **The rounded price written back to the box, and the chunk-retry regex limited to `/_astro/`, are both fixed in the code.** The write-back was not exercised in a browser.

## Suggested order

1. Upstream in CBM, then re-vendor: C1 threshold rows, C3 wording, and the citation.
2. In this site: C2 totals, H1 text inputs plus the shared parser, H2 dot cap, and M2 weekly wording.
3. Tests: M08 and M10/M19 pins, a mark-up/factor/price oracle, an e2e totals + CSV spec, and the golden file decision.
4. A legal read of IR 2025/2547 Art 7 for H3, before any code.

## Not checked

- Firefox and WebKit number-field behaviour.
- A failing or corrupt pack fetch in a real browser.
- The print flow in a browser.
- The brute-force recompute on the verified path (only the default-values path was recomputed).
- The glossary wording against the IR 2025/2620 text.
- Whether a delegated act has changed the 50 t figure.
- Whether the CSCF has been published.
- `cbam-app.ts` closure mutations.
- Layout at 320 px.
- The CBM SaaS repo, which is out of scope.
