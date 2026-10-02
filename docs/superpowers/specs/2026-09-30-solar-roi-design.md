# Solar payback (ROI) sheet: design

**Date:** 30 September 2026
**Status:** Implemented on `feat/solar-roi` (30 Sep to 1 Oct 2026); see §10 for what changed during implementation.
**Branch:** `feat/solar-roi`.
**Mockups:** `~/.cache/delta-climate/solar-roi/.superpowers/brainstorm/` (layout.html, sheet.html).

## 1. Why

A colleague asked for a payback/ROI calculator for the solar feature, after reviewing the Waaree and Vikram Solar calculators. We decoded both:

- **Waaree:** a flat 107.7 kWh per kW per month for all of India, 80 sq ft per kW, ₹50 per watt plus ₹10 per watt installation, and no shading.
- **Vikram:** a plant load factor of 0.16 for every state (1,402 kWh per kW a year), panel-footprint area only, and degradation of 2.5 % then 0.67 % a year.

Both yields fall inside our 1,200–1,450 kWh per kWp bracket. Neither accounts for shading.

This design **reverses a deliberate guard**. `tests/unit/obos-shell.test.mjs` forbids "payback" on screen, because "it needs capex and subsidy assumptions, and that is where liability lives". "Payback: off, or a labelled range" was an open founder decision (`docs/superpowers/specs/2026-09-07-solar-guide-design.md` §2 item 6). It is now decided: **a labelled range, on the user's own assumptions, starting from sourced defaults, and never a quote.**

## 2. Decisions (founder, 30 Sep 2026)

| # | Question | Decision |
|---|---|---|
| D1 | Whose money | **Both:** a per-roof payback (built first) and a ward total |
| D2 | Savings model | **Simple by default** (every kWh at the tariff), plus an optional **"Use my bill"** mode: self-consumption at the tariff, surplus at the export rate |
| D3 | Cost basis | **Cited defaults the user can edit**; the subsidy is computed from the scheme rules; the result prints its assumptions |
| D4 | Outputs | **A payback range and a 25-year net-saving range**; a year-by-year table in the CSV only; no IRR on screen |
| D5 | System size | **A slider** from 1 kW to the roof's maximum. Default min(3 kW, roof max). "Use my bill" suggests a size. The ward total uses full roofs |
| D6 | Subsidy eligibility | **Owner switch: Home (default) · Housing society · Business.** The ward total assumes **no subsidy** |
| D7 | Where | **A dedicated payback sheet**, opened by "Work out payback" on the roof card. The card gains one button; the sheet slides over the map |

**Scope:** the three Kolkata wards only. Bengaluru has no `pv-<ward>.json` yet; its sheet waits for its solar layer and a `solar-cost-bengaluru.json`.

## 3. Architecture

Everything is computed in the browser. There is no pipeline change and no server.

### 3.1 `public/heat-map/data/solar-cost-kolkata.json`, the cost basis

Every value has a `source` and an `as_of`. The loader refuses the file (and the button is hidden) if any value lacks either.

| Field | Default | Source |
|---|---|---|
| `subsidy.home` | ₹30,000/kW up to 2 kW, ₹18,000 for the 3rd kW, cap ₹78,000 | PM Surya Ghar CFA structure, 7 Mar 2024 (official PDF) |
| `subsidy.society` | ₹18,000/kW for common facilities, cap 500 kW | same PDF |
| `subsidy.business` | 0 | the scheme covers residential only |
| `cost_per_kw` | [55,000, 70,000] (was 65,000 high; pre-ship audit 1 Oct 2026) | 2026 installer and manufacturer price guides, secondary, cited in the evidence file; MNRE benchmark ₹50,000/kW (first 2 kW) and ₹45,000 thereafter, shown alongside |
| `tariff` | 8.00 ₹/kWh | the existing `TARIFF_DEFAULT`, which moves here; the CESC slab note stays |
| `export_rate` | **pending** | the WBERC Grid Interactive Rooftop Solar Regulations 2025 order, CESC low-voltage domestic. Must be read from the order itself before "Use my bill" can ship (§5) |
| `degradation` | 2.5 % in year 1, 0.7 %/yr after | typical module warranty (Vikram uses 2.5/0.67); cite one module datasheet |
| `upkeep_pct_per_yr` | 1 % of gross cost | to be sourced (MNRE O&M norm or an installer figure) |
| `inverter` | replaced in year 12; cost per kW sourced in implementation (§8 item 2) | to be sourced |
| `horizon_years` | 25 | module warranty life |
| `sizing_by_units` | 0–150 → 1–2 kW; 150–300 → 2–3 kW; >300 → >3 kW | same official PDF |

The single tariff box stays shared with the Solar pane (`localStorage` key `delta:hm-tariff`), so the two can never disagree.

### 3.2 `src/scripts/climate-engine/solar-roi.ts`, the arithmetic

Pure functions with no DOM access. Types come from `types.ts`.

- **Inputs:**
  - the roof's generation per kW as a low/high pair, from `pvRanges` divided by kWp so the shading band is kept;
  - the chosen size in kW;
  - the owner type;
  - `cost_per_kw` (low and high);
  - the tariff;
  - optionally, monthly units;
  - the cost basis.
- **Per year, t = 1 … 25:**
  - generation = size × per-kW generation × the degradation factor;
  - value = generation × tariff (simple mode); or, in bill mode, min(generation, own use) × tariff plus surplus × export rate;
  - minus upkeep, and minus the inverter cost in its year.
- **Up front:** size × cost per kW, minus the subsidy.
- **Outputs:**
  - **Payback:** the first year in which the cumulative net turns non-negative, as a low–high range. The pessimistic end takes low generation, high cost and low export; the optimistic end takes the opposite.
  - **25-year net saving:** a low–high range.
  - **Year-by-year rows** for the CSV.
  - A **`status`** of `ok`, `no_payback` (not within 25 years) or `too_small` (roof under 1 kW).
- **The ward total** uses every roof at full `kwp` with no subsidy, simple valuation and the cost range, and is shown in the Solar pane.

### 3.3 The sheet (UI)

- **The card:** `#bcSol` gains one button, "Work out payback", or "Too small for a useful system" when the roof is under 1 kW.
- **The sheet:** a dialog that slides over the map and is closable four ways, following `#solBrief`'s modal pattern: the stage is `inert` while it is open.
  - **Controls:** the size slider, the owner switch, the editable cost pair with its source, the shared tariff, and an optional units/month box.
  - **Results:** "Pays back in X–Y yrs" and "Net saving, 25 years ₹A–B".
  - **Always shown:** the **assumptions line** and the tag **"screened · estimate, not a quote"**.
- **Bill mode:**
  - prints the official sizing suggestion;
  - warns with the surplus share and the export rate whenever the surplus exceeds 10 %.
- **Buttons:** "Print installer brief" (the brief gains a payback block with the same assumptions line) and "Year-by-year CSV".
- **Phones:** full-screen below 700 px.
- **Money formatting:** through `fmtMoney` and `fmtRate` only. The currency guard applies.

## 4. Honesty rules

1. Results are **ranges**, never single points.
2. Every payback figure sits next to the **assumptions line** and the **"estimate, not a quote"** tag. A test enforces this, replacing the old "no payback" test.
3. The word "quote" appears only in "not a quote". "guaranteed", "assured", "ROI of" and "returns" never appear.
4. A payback beyond the horizon is **words, not a number**: "Does not pay back within 25 years at these assumptions."
5. The ward total is labelled as the conservative city case: full roofs, no subsidy.
6. The screen prints defaults' **as-of date** ("defaults as of Sep 2026").

## 5. Edge cases

| Case | Behaviour |
|---|---|
| Roof < 1 kW | No sheet; the button reads "Too small for a useful system" |
| Cumulative net < 0 at year 25 | `no_payback`, stated in words (rule 4) |
| Housing society | ₹18k/kW, capped at 500 kW; the line reads "assumes common-area use" |
| Cost pair entered high–low | Swapped, with a note |
| Cost per kW outside ₹20k–₹1.5L | Flagged "unusual", still computed |
| Units ≤ 0 or not a number | Ignored, with a message; simple mode |
| Cost file missing, or a value without `source`/`as_of` | Button hidden (fail closed) |
| `export_rate` still pending | "Use my bill" hidden; simple mode only. The feature may ship like this |

## 6. Testing

- **`tests/unit/solar-roi.test.mjs`:**
  - hand-computed golden cases for home, society and business, with and without a bill;
  - properties: low ≤ high; more subsidy never lengthens payback; bill-mode savings never exceed simple savings; nothing is printed beyond the horizon; the subsidy cap holds at ₹78k;
  - mutation proofs.
- **Cost-file guard:** every value has a `source` and an `as_of`; the subsidy numbers match the official PDF.
- **`obos-shell.test.mjs`:** the "no payback anywhere" test is replaced by "every payback figure has the assumptions line and the 'estimate, not a quote' tag", plus the banned-words list.
- **e2e (`tests/e2e/solar-roi.spec.ts`):**
  - open the sheet from a roof;
  - move the slider, then check the results change monotonically;
  - switch owner, then check the subsidy line changes;
  - enter a bill, then check the surplus warning;
  - print the brief, then check the payback block is present;
  - check contrast in both themes.
- **Gates:** `npm run check`, `typecheck`, `test:unit`, `build`, the relevant e2e, and an independent audit before shipping.

## 7. Out of scope

- Financing and EMI.
- Tax benefits such as accelerated depreciation for businesses.
- Batteries.
- Tariff slabs beyond one flat rate.
- IRR.
- Bengaluru, until its solar layer exists.
- Installer data from partners, which would later tighten `cost_per_kw` and the yield check.

## 8. Open items to resolve during implementation (not design decisions)

1. The **CESC low-voltage domestic export rate** from the WBERC 2025 order; the only secondary figure found, ₹4.42, is for extra-high voltage.
2. Sources for **upkeep %** and **inverter cost/year**.
3. One **module datasheet** for the degradation figures.

## 9. Amendment A1 (30 Sep 2026, after sourcing)

Task 1's evidence (`docs/evidence/solar-payback-cost-basis.md`) changes one rule and settles the open defaults:

- **Surplus is not paid in West Bengal.** WBERC's 2025 regulations (Regulation 81) reset any net amount receivable at the end of the settlement year (1 April to 31 March) to zero. The FY 2025-26 L&MV feed-in tariff of ₹4.80 (SM-40, 20.08.2025) only offsets imports within the year.
  - Bill mode therefore values generation up to the household's own yearly use at the tariff, and credits the surplus at `surplusCreditPerKwh`, which is 0 for Kolkata.
  - "Use my bill" no longer waits on a rate and ships in the first release.
  - This replaces `export_rate` in §3.1 and the last row of §5.
- **Degradation:** 3 % in year 1, then 0.5 %/yr, the MNRE PM Surya Ghar minimum for every subsidised module. This is more conservative than a premium datasheet.
- **Upkeep:** 1 %/yr of capital cost (KERC 2026 norm), flat in constant rupees.
- **Inverter:** ₹8,000/kW (store price plus installation), replaced in year 10, at the end of a 10-year warranty. The year is an assumption.

## 10. As implemented (1 Oct 2026)

- **The cost basis** is a typed module, `src/scripts/climate-engine/solar-cost.ts`, not a JSON file. Every value is `Cited` with a source and an `as_of`. `isComplete` walks every cited leaf, so a new field cannot slip through unchecked.
- **Payback means "stays paid back".** It is the first year from which the cumulative net stays non-negative to the horizon. The year-10 inverter can otherwise dip a system back into the red after it has crossed zero.
- **The ward total** is the exact capacity-weighted sum of the per-roof ranges, so it is never more optimistic than its roofs. It is `wardRoi` in `solar-roi.ts`. It counts only the roofs that can take 1 kW or more, because the sheet calls smaller roofs too small. It is computed as a business, with no subsidy and every kWh valued at the tariff. The ward line reads "Whole-ward estimate: every roof that can take 1 kW or more, at its floor capacity, no subsidy, every kWh valued at <rate> as if all of it is used: …", then "per kW, today's prices", the as-of date and the tag. The pre-ship audit (1 Oct 2026) dropped the earlier word "Conservative": valuing every kWh flatters the result in West Bengal, where surplus earns nothing.
- **Input ceilings (audit, 1 Oct 2026).**
  - The tariff must be above 0 and at most 100 per kWh. The pane's box, the sheet's box and the stored `delta:hm-tariff` are all checked against that range.
  - Cost per kW must be at most 1,500,000, and units at most 100,000 a month.
  - `roiFinite` refuses to paint a payback or saving that is not finite.
  - The CSV and the brief carry the estimate tag beside their assumptions.
- **Flat mode states its assumption.** Every kWh is valued as if the household uses it. Homes and societies see a West Bengal caveat pointing to "Use my bill".
- **Wording:**
  - Subsidies read "assumes …, if eligible".
  - Nothing is printed past the horizon ("N years at best; may not pay back within 25 years").
  - Losses are named as losses.
  - Sentence results use a plain text style (`is-words`).
- **Size:** the slider covers 1 to min(roof max, 20) kW. A number box beside it covers 1 kW to the roof maximum, because the largest Ballygunge roof takes 714 kW and a slider is unusable at that scale.
- **The sheet:**
  - It is opaque.
  - Escape closes only the sheet, and the roof stays selected.
  - Inputs are validated with linked messages (`aria-describedby`, `aria-invalid`).
  - A guard test keeps "quote" out of the sheet except in "not a quote".
