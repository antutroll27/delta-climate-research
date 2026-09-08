# The solar guide — the confidence ladder and the installer brief

**Date:** 2026-09-07 · **Status:** proposed, for the founder's review · **Depends on:** the solar console
(`2026-09-05-solar-console-design.md`), the tree-shading artefacts (A1–A5), and the rooftop validation
pre-registration (`2026-09-07-pv-rooftop-validation-design.md`), whose result feeds one line of the ladder.

## 1 · Why

Clients who saw the solar screen asked for one of two things: accuracy, or a guide that helps them reach
a working system while telling the truth. These are one product. The honest way to state a number is to
say what would narrow it and what that costs, and a guide built that way is what sells the accuracy.
Nothing in the physics changes. The card learns to say how sure it is and what would make it surer, and
the owner leaves with a sheet a vendor's quote can be checked against.

## 2 · Decisions

1. **The interval leads.** Every solar figure on the card and in the pane prints its range first and the
   point second: capacity from the packing interval (already published), yield from the packing interval
   times the specific-yield bracket times the shading band (strict floor to A1).
2. **Every figure carries a tier chip:** *Screened* (from satellites and open data, what ships today),
   *Assessed* (a survey of the roof), *Measured* (a month with our node on the roof). Only *Screened*
   exists this sprint; the other two are named so the ladder has rungs to climb.
3. **A "how sure" disclosure under the block** lists, for each limit, the fix and what it narrows to:

   | limit | today | the fix | narrows to |
   |---|---|---|---|
   | roof obstacles unknown (tanks, stair rooms, parapets) | capacity 0.28–0.40 packing, about ±30 % | a ten-minute walk of the roof with a phone | about ±10 % |
   | canopy over the roof: usable or not | shading headline vs strict floor, up to nine points | one photo from the roof | settled for that roof |
   | irradiance from a coarse satellite cell | yield bracket 1,200–1,450 kWh/kWp | the ground station inside that cell | about ±5 %, city-wide |
   | building height unverified | ward-scale only | a survey or a drone pass | per roof |
   | never compared with real rooftops | no measured error | the validation study | a measured spread, with its n |

   The numbers in this table are the artefacts' own bands; the "narrows to" column is the engineering
   expectation, labelled as such until the ladder's rungs are measured.
4. **Each fix line is a button** that opens a pre-filled email to the technical-queries address
   (`ant@deltaclimate.earth`) with the ward, the building index and the limit named. The survey app does
   not exist yet, and the button must not pretend it does.
5. **The installer brief** is a one-page printable view of the card, opened from it, saved to PDF by
   the browser. No server, no generator.
6. **No payback and no capex**, still, pending the founder's decision recorded separately. The brief
   carries the tariff as a labelled assumption and the worth per year, exactly as the card does.
7. **The wording of the rungs** stays neutral ("ask about an assessment") until the founder decides
   whether assessment and measurement are paid services.

## 3 · Data

`build-pv-yield.py` adds a `tiers` block to `pv-<ward>.json`:

```json
"tiers": {
  "screened": true,
  "yield_bracket_kwh_per_kwp": [1200, 1450],
  "packing_range": [0.28, 0.40],
  "shading_band": "loss_strict .. loss",
  "validated": null
}
```

Per roof, the card computes: capacity range `[kwp, kwp × 0.40/0.28]`; yield range
`[kwp × 1200 × (1 − loss), kwp_top × 1450 × (1 − loss_strict)]`. Nothing new is computed offline; the
ranges are products of published numbers, and the arithmetic is unit-tested.

`validated` is `null` until the validation study publishes; then it carries `{ n, months, median_ratio,
within_15pct_share, date }` and the fifth ladder line prints the measured spread instead of its fix.

## 4 · The card

Inside `#bcSol`, the existing rows keep their ids. Changes:

- `Installable` prints `7.3–10.4 kWp` with the point after: `floor 7.3`.
- `Yield` prints the range, then `about 9,470 kWh/yr` as the screened point.
- A tier chip `SCREENED` in the block's header, in the screening amber.
- A disclosure `<details class="bc-sure">` headed *How sure, and what would make it surer*, with the five
  lines from §2, each ending in a button `Ask about this` (`mailto:` with subject
  `Solar assessment · <ward> · #<idx> · <limit>`).
- A `Print the installer brief` button (`#bcBrief`) that opens the brief view.

## 5 · The pane

The ward block gains the same tier chip and a one-line ladder summary; the ten-roof table gains a column
`range` (kWh/yr) beside the point. The CSV gains `kwh_low, kwh_high, kwp_high, tier`.

## 6 · The installer brief

A printable section `#solBrief` rendered into the page on demand (hidden otherwise), with a print
stylesheet that hides everything else. One A4 page:

1. **Header:** Delta Climate Research · Rooftop solar brief · ward · building index · lat/lon · date ·
   tier chip.
2. **The roof:** footprint m², height, the building's outline drawn as an inline SVG from the registry's
   polygon, north arrow.
3. **The numbers, ranges first:** installable capacity, annual yield, shading (buildings, trees, strict
   floor), the raised-array what-if, worth per year at the labelled tariff.
4. **How sure:** the five ladder lines, with today's tier.
5. **Questions to ask your installer:** proposed tilt and orientation; module count and DC capacity
   against the range above; their expected yield against ours; whether a shading study was done and how;
   the net-metering limit that applies to this connection; monitoring access, so generation can be
   checked against the promise.
6. **Sources and the basis line** from the artefact, verbatim, and the screening disclaimer.

The "questions" list is static copy; nothing on the sheet is computed that the card does not already hold.

## 7 · Files

| file | change |
|---|---|
| `scripts/build-pv-yield.py` | the `tiers` block; `--self-check` covers it |
| `src/scripts/climate-engine/types.ts` | `PvFile.tiers` |
| `src/scripts/climate-engine/heat-map-app.ts` | range arithmetic (`pvRanges(pv, idx)`), the disclosure painter, the mailto builder, the brief renderer and print call, CSV columns |
| `src/components/ClimateEngine/HeatMapStage.astro` | card markup, pane column, `#solBrief` markup, print CSS, studio inks |
| `tests/unit/obos-scope.test.mjs` | `tiers` probed by `asPvFile`; range arithmetic pinned on a fixture |
| `tests/unit/obos-shell.test.mjs` | the disclosure's five lines exist; no "payback" anywhere; the mailto carries ward and index |
| `tests/e2e/solar-pane.spec.ts` | the card prints a range before a point and a tier chip; the brief view renders on one print page with the checklist; the CSV header has the new columns |
| `docs/evidence/known-limitations.md` | the ladder, as the public statement of the solar limits |

## 7b · Recorded during implementation (2026-09-07)

- **The ranges are products, pinned.** `solar-ranges.ts` multiplies published numbers only; the plan's
  worked example had the high yield as 14,523 and the product is 14,519 — the test pins the measured value.
  `packing_factor` is not read: the low end of the packing range is the factor the artefact used.
- **The card's validated swap is reversible.** The fifth rung's default and the note's default are captured
  at mount and restored when a ward with `validated: null` follows a validated one; the guards are keyed on
  the painted TEXT, not the tier word, because two validated wards carry different numbers.
- **The pane's chip keeps its own ink on Clay.** The studio amber tuned for the pale card reads 2.7:1 on the
  dark sidebar; the studio rule is scoped to `.bcard .bc-tier`.
- **One source of truth for the CSV.** Rows are built from ordered `[name, value]` pairs and the header is
  derived from them; the e2e finds columns by name. The roof table scrolls sideways in a wrapper that must
  be `flex-shrink:0`, because a scroll container that is a flex item has an automatic minimum height of 0.
- **The brief lives directly under `.stage`**, not beside the card: the print rule hides every other child of
  the stage, and the card sits inside one of them. The site's `[hidden]` reset lives in a cascade layer and
  outranks any print rule, so the sheet is un-hidden by script and re-hidden by four routes: `afterprint`,
  the print media query going false, a 30 s timeout, and a Close button. `window.print()` is in a try/catch.
- **North is +z.** `wardLatLon` adds `y/110_540` to the origin latitude, so the outline is drawn with y
  flipped and the arrow up; the fact is a module constant with the citation, not a per-click probe.
- **The one-page check measures at A4 width** (673 CSS px inside 16 mm margins), not at the 1280 px test
  viewport, where wrapped lines are half their printed height; the sheet measures 490 px of 1,000.
- **Copy has one home.** `solar-copy.ts` holds the ward summary, the validated sentence, the note derivation
  and the "under 1 %" share; the card, the pane and the brief all call it.

## 8 · Verification

- Units and the two e2e files; the studio contrast sweep with a card open, since the chip and the
  disclosure add text on Clay.
- A print-to-PDF of the brief for one roof in each ward, checked by eye to fit one page.
- `npm run verify` green; CI green; the founder looks at the card on the preview before the push.

## 9 · Out of scope

The survey app; the ground-station data agreement; the tree trade-off card (shading cost vs street
cooling); the regulation and subsidy text; payback or capex; any change to the physics or the shading
artefacts; the measured rung's hardware (the node's irradiance sensor).
