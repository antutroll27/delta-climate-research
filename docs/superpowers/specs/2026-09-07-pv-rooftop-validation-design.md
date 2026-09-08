# Rooftop solar against real generation — pre-registration

**Date:** 2026-09-07 · **Status:** PRE-REGISTERED. The predictions file is committed before any measured
kilowatt-hour enters the repository; the commit hash of that file is recorded in the result. ·
**Depends on:** the yield chain (`scripts/build-pv-yield.py`) and the tree-shading artefacts
(`2026-09-05-pv-tree-shading-design.md`, A1–A5), which together produce `public/heat-map/data/pv-<ward>.json`.

## 1 · Why

Clients who saw the solar screen asked for one of two things: a number they can rely on, or a guide that
tells them the truth on the way to a working system. Both begin with a fact we do not have: how far the
screen sits from what real rooftops in these wards generate. Until that is measured, "accurate" is a
promise. After it, it is a receipt, whichever way it falls. This document fixes, before any data is
seen, what will be compared, how, and what counts as passing.

## 2 · What the screen assumes today, exactly

Every number below is read from the yield chain and the artefacts, not from memory.

| quantity | value | source |
|---|---|---|
| irradiance | five whole years of NASA POWER hourly GHI, local solar time | `specific_yield()` |
| beam/diffuse split | derived from GHI by Erbs; POWER's own DNI/DHI do not close | same |
| array | fixed tilt 22°, facing due south | Global Solar Atlas optimum for 22.57° N |
| cell temperature | NOCT 51.2 °C (GSA small-residential), γ −0.35 %/°C | same |
| system loss | 12.9 % (GSA small-residential: soiling, inverter, availability) | same |
| specific yield, Ballygunge | **1,313.8 kWh/kWp/yr**; sanity bracket 1,200–1,450 | artefact `specific_yield` |
| capacity | footprint × packing **0.28** ÷ 10 m² per kWp | Singh & Banerjee 2015, Mumbai |
| capacity interval | packing 0.28–0.40, the same study's range; no Kolkata evidence in it | `PACKING_RANGE` |
| shading | raster shadow-casting at 0.5 m, buildings + Meta/WRI canopy, A1 mask, τ 0.30 | trees artefact |
| shading floor | the strict-mask loss per roof | `loss_strict` |
| per-roof yield | `kwp × specific_yield × (1 − loss)` | `build-pv-yield.py` |

Two of these are the levers the study can move: the **specific yield** (irradiance, tilt, losses) and the
**packing factor** (roof geometry). They are tested separately, because they fail for different reasons.

## 3 · The two questions, and the statistics fixed for each

### Q1 · Yield per installed kilowatt

For each recruited roof *i* with installed DC capacity *P_i* and measured generation *G_i,m* over months
*m* in the set *M_i*:

- **measured specific yield** `y_meas,i = Σ_m G_i,m / P_i`, in kWh/kWp over *M_i*;
- **predicted, as built** `y_pred,i`: the chain's model re-run for the roof's **stated tilt and azimuth**,
  over the **same calendar months and years** as *M_i* using NASA POWER daily data for those dates, times
  `(1 − loss_i)` with `loss_i` the roof's annual A1 shading loss from the artefact;
- **predicted, as screened** `y_scr,i`: the same, at the screen's 22°/south and the five-year climatology
  — what the product prints.

Statistics, all pre-registered:

1. **Ratio** `r_i = y_meas,i / y_pred,i`. Report the median, the interquartile range, and the mean absolute
   percentage error. The median's sign is the bias, and the direction is reported as such.
2. **Pass mark for the accuracy claim:** at least **80 % of roofs within ±15 %** (`0.85 ≤ r_i ≤ 1.15`).
   If met, the card may say "within 15 % of measured generation on N roofs". If not met, the card says
   the measured spread, whatever it is. There is no third outcome.
3. **Does per-roof shading have skill?** The null model predicts every roof at the ward's unshaded yield.
   The test: Spearman correlation between the artefact's `loss_i` and the roof's shortfall under the null,
   `1 − y_meas,i / y_null,i`, must be positive with p < 0.05. Declared at **n ≥ 25**; below that the test is
   reported as underpowered, not as passed.
4. **Screening vs as-built.** Report the median of `y_meas,i / y_scr,i` separately, so the product's own
   printed number, not only the re-tilted one, is judged.

### Q2 · Installable capacity

For each roof, `c_i = P_i / kwp_i` where `kwp_i` is the artefact's installable capacity at packing 0.28.
Owners install less than a roof can hold, so the ratio's spread is the finding, not a pass mark, with
two pre-registered rules:

- `c_i > 1.0` means the owner installed more than our **floor**; the share of such roofs is reported.
- `c_i > 0.40 / 0.28 = 1.43` means the owner installed more than the **top of the interval**. Any such
  roof is a hard failure of the geometry model for that roof, and is reported by name (index), not
  averaged away.

## 4 · Recruitment

- **Target n ≥ 30**, across the three wards; **publication floor n ≥ 10**. The result is published at
  whatever n is reached by the sprint's day fifteen, with n in the sentence.
- **Eligible:** roof-mounted, fixed-tilt systems on a building inside the twin's three wards (matched to a
  building index). *(A1: the near-ward class was dropped.)*
- **Excluded, declared before data:** trackers; systems with fewer than six months of data; owner-declared
  outages exceeding 10 % of covered days; exports with gaps above 20 % of days; systems whose installed
  capacity the owner cannot state to within 10 %.
- **Route:** installers and owners directly, housing societies, and CESC's rooftop-solar cell as a
  private partner. **No municipal data is needed or sought.**

## 5 · The data template

One row per roof, in `data/calibration/pv-validation-measured.csv`, anonymised at entry:

`roof_id, ward, building_idx, lat, lon, kwp_dc, capacity_uncertainty_pct, tracker, tilt_deg, azimuth_deg,
install_date, months_covered, kwh_by_month (JSON list of [YYYY-MM, kWh]), outage_days_declared, inverter_make,
source (portal export | bill | manual), notes` (A1 added `capacity_uncertainty_pct` and `tracker`)

The consent form and the owner-facing template are in `docs/solar/rooftop-validation-consent.md`.

## 6 · Files and the order of operations

1. `scripts/predict-pv-validation.py` reads the recruited roofs' indices and stated tilt/azimuth from a
   **roster** (`data/calibration/pv-validation-roster.csv`: `roof_id, ward, building_idx, tilt_deg,
   azimuth_deg, months_covered`) and writes `data/calibration/pv-validation-predictions.json` — `y_pred`,
   `y_scr`, `y_null`, `kwp` per roof, with this document's hash and the artefact hashes.
   **The predictions file is committed before the measured CSV exists in the repository.**
2. `scripts/measure-pv-validation.py` reads the predictions file and the measured CSV, computes §3, and
   writes `data/calibration/pv-validation-<date>.json` with every statistic, every exclusion applied
   (by rule name), and the predictions file's commit hash.
3. The result is published on the uncertainty page, section "Rooftop solar, against real generation",
   and the card's yield band is updated only if n ≥ 25; below that the card says "not yet compared to
   real rooftops".
4. `--self-check` on both scripts runs in `test:py` on synthetic roofs whose answer is known.

## 7 · Known biases, and their direction

- **Selection.** Roofs that got solar are the good roofs. The sample flatters the screen; the direction
  is stated with the result.
- **Soiling and outages** look like shading. Owner-declared outages are excluded by rule; soiling is not
  separable and is named as a limit.
- **Interannual irradiance.** Handled: predictions use the owner's own months and years.
- **Tilt and orientation.** Handled: the as-built prediction uses the owner's stated array.
- **Annual shading loss applied to partial years.** The artefact's loss is annual; a roof measured only
  in monsoon months carries a small bias of unknown sign. Named, not corrected.
- **Stated capacity.** Owners misremember; the 10 % rule excludes the worst, and the rest is noise.

## 8 · Publication rules

The result is published whatever it says, with n and the months covered in the same sentence, on the
uncertainty page and in `docs/evidence/known-limitations.md`. No accuracy figure is ever quoted without
its n. If the pass mark is missed, the measured spread replaces it on the card, and the levers in the
solar guide's ladder are re-ordered by what the study found.

## Amendments

Any change to §3 or §4 after the predictions file is committed is an amendment here, dated, with what
was known when it was made.

### A1 — 2026-09-07, before the predictions file exists. What the implementation review found

The laboratory scripts were written and reviewed against this document before any roster or measured
row existed (`data/calibration/` holds only an example roster). The review found four places where the
document was silent or unimplementable, fixed now while it is free:

1. **§3, the denominators of statistics 3 and 4.** `y_scr` is the product's printed annual figure,
   `specific_yield × (1 − loss_i)`, **prorated onto the owner's months by a monthly seasonal shape taken
   from the Ballygunge NASA POWER cell and applied to all three wards** (about 45 km apart). For a full
   twelve months this reduces exactly to the printed number; for a partial year it reweights it, and that
   is the honest comparison for "the number the card prints". `y_null` is the chain's model run at the
   screen's 22°/south with `loss = 0` **on the owner's own days**, so the null shortfall carries no
   interannual irradiance term that `r_i` does not.
2. **§4, eligibility.** The "within 2 km of a ward boundary" class is dropped: the roster joins by
   building index and the shading test needs a screened roof. In-ward indexed roofs only.
3. **§4, the two percentage rules' denominators.** Outages are measured against the days of the months
   the owner reported; gaps against the days of the months the owner declared as covered.
4. **§5, two fields the rules need that the template did not carry.** `tracker` (yes / no; blank means
   no) and `capacity_uncertainty_pct` (how far the stated kW might be off). Without them the tracker rule
   and the "capacity not stated to within 10 %" rule could never fire on a real submission. The owner
   pack and the sheet now ask both.

Nothing in the statistics, the pass marks, the thresholds or the publication rules changed.

## References

- Singh, R. & Banerjee, R. (2015). Estimation of rooftop solar photovoltaic potential of a city. *Solar Energy*, 115, 589–602. The 0.28–0.40 packing range.
- Global Solar Atlas 2.0 technical report (Solargis, World Bank): small-residential rooftop losses, NOCT.
- NASA POWER, hourly and daily GHI and T2M.
- The measured Bhubaneswar rooftop cited in `scripts/build-pv-yield.py` (PR 0.78, ~1,340 kWh/kWp/yr).
