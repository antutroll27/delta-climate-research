# Kolkata night air: a measured month-by-month correction of the airport reading (2026-11-08)

**Status of this section: PRE-REGISTRATION. Written and committed BEFORE the table was built or the test was run.**
The result is appended below the line `## RESULT` in a later commit. Nothing above that line may be edited after
the result is known; a change would be an amendment with its own date.

## Why

The live Kolkata "Now" view is forced at night by Dum Dum (VECC) METAR air about 99.7 % of the time
(`/Volumes/OBOSLab/research/daytime-refit/P2-REPORT.md` section 6). The model's night constants and the displayed
+/-3.0 K band were earned on NASA POWER T2M, which at night is 2.56 K [2.07, 3.08] cooler than VECC. On the 49 night
scenes the unadjusted station air gives bias +2.50 K [+1.73, +3.41], RMSE 3.14 K, against -0.23 K / 2.54 K on POWER.
The airport-minus-POWER night difference is strongly seasonal (P0, section 12 of PREREG.md: about +3.5 K in
Nov-Dec, about +0.2 K in May), so a single constant would be wrong; this change is a 12-month table.

## The rules, fixed in advance

**The table (air against air; never fitted to satellite LST).**

1. Inputs: every VECC METAR report (routine and SPECI) in the IEM archive, 2024-01-01 to 2026-05-31
   (`/Volumes/OBOSLab/tmp/daytime-refit/iem/vecc-raw.csv`, the window and files P2 used; public domain, credited), and
   NASA POWER hourly T2M at the Kolkata point (22.55 N, 88.37 E; `power/kolkata.json`, the same file the rows were
   built from).
2. VECC air is the whole-degree temperature **parsed from the METAR text** (what `parseMetar` returns), cross-checked
   against IEM's `tmpc`. POWER is matched with `_power.power_stamp(report_utc, 88.37)` (nearest local-solar hour), the
   rule that matched POWER to the satellite passes. A report with no temperature or a POWER fill value (-999) is dropped.
3. **Night instant** = sun <= `SUN_LIT` (0.05), the product's own branch rule: `sun = solar_factor(solar_hour, doy_utc,
   22.55)` with `solar_hour = (UTC hour + 88.37 / 15) mod 24` and the UTC day of year (exactly what `heat-map-app.ts`
   does for "Now").
4. **Month** = calendar month, in IST (UTC+5:30, fixed), of the report instant. At use, the month of the clock.
5. **Entry** = the plain mean of (VECC air - POWER T2M) over that month's night instants, in kelvin, rounded to
   0.01 K. No smoothing, no shrinkage, no weighting. n is recorded per month.
6. **Validation nights are excluded from the table's input.** Every night report within +/-12 h of the instant of any
   of the 50 night-stratum scenes of `kolkata-mmd-292` (the 49 test scenes plus the one stale scene) is dropped. The
   table with no exclusion is also built and the per-month difference reported; the table that is TESTED and SHIPPED
   is the excluded one.
7. The correction is `air_used = air_observed - table[month]` and applies only when the sun at the instant is
   <= `SUN_LIT` (the ward's own latitude in the product), only to the air temperature that enters the model, only for
   VECC. Relative humidity (Magnus, from the observed air and dew point), wind and the day branch are unchanged. The
   air tile and the weather line keep showing the airport's reading, unadjusted.

**The test.**

8. Rows: `kolkata-mmd-292` of `tests/fixtures/daytime-refit/rows-p2.json` (sha256
   `1f308a46a2099bb431457b9cf418069bd1262eff6d20ae8c8ffef68b985c52cd`, feat/daytime-refit-parity @937532f7), stratum
   `night` (cos z = 0), `admitted`, station-forced, the one stale row excluded as P2 did: **49 rows, 20 overpass dates**.
9. Model: M0 as shipped, evaluated by the parity-gated lab (`_refit_lab.predict`, wind = WS10M as the product reads
   it). Forcing is the station row (air, RH, 10 m wind) with the air replaced by the corrected air; cloud stays POWER,
   as in every P2 score. Error = prediction - observed LST.
10. Scoring: `_refit_score.score` (bootstrap over overpass DATES, 4000 resamples, seed 7, percentile 95 % interval).
11. **The correction PASSES only if all three hold:**
    (a) the night bias 95 % CI includes 0;
    (b) RMSE <= 3.0 K (unrounded);
    (c) the leave-one-overpass RMSE <= 3.0 K, where for each of the 20 dates the table is rebuilt excluding only that
        date's +/-12 h window (the other validation nights stay in), that date's rows are predicted, and the pooled
        held-out RMSE is taken. M0 has no fitted parameter, so this is the only place a held-out distinction exists.
    (a) and (b) use the table of rule 6 (all validation nights excluded).
12. Not a pass, in any other case: the table is not shipped and the +/-3.0 K band is not restored by this change.
13. Reported and NOT used to decide: the unexcluded table; RH recomputed from the corrected air and the observed dew
    point (sensitivity to rule 7); POWER-forced night as the reference; the score with a single constant (the mean
    offset) in place of the table; the per-month residual.

**Cloud (also used live, not in calibration).** Measured and reported, not corrected: the 49 scenes re-scored with the
airport's own cloud fraction (the product's `cloudFraction` of the METAR at the pass) in place of POWER's, with the
corrected air; and the monthly night mean of (VECC cloud - POWER CLOUD_AMT). A correction is added only if it is
trivially analogous to the air table (an additive monthly offset on a quantity that is not bounded); cloud is a bounded
fraction and VECC's cloud words are an observer cover class, not a model cell, so the expectation is that it is not.

**Not touched:** Amsterdam, Bengaluru, the day branch, every committed calibration artefact (the freeze baseline), the
accuracy copy and the displayed bands (a sibling disclosure PR owns those).

---

## RESULT

*Appended after the table was built and the test run once, in the order the rules fix. The rules above are unchanged.*

**Verdict: the correction PASSES all three pre-set conditions.** It ships as built; nothing was tuned after the first run.

### The table (VECC air - POWER T2M, K; subtract from the airport reading at night)

Window 2024-01-01 to 2026-05-31; 42,234 usable VECC reports (of 42,499; 205 carry no temperature, 12 have no POWER hour, 48 fall outside the window), 21,902 of them at night, 504 of those inside a validation night's +/-12 h and dropped; 21,398 enter the table.
IEM's tenths and the whole-degree text agree on every report (0 differ by more than 0.5 K).

| Month (IST) | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Offset, K (shipped)** | **3.17** | **3.14** | **2.14** | **1.06** | **0.51** | **1.37** | **1.07** | **1.17** | **1.75** | **2.04** | **3.95** | **4.04** |
| n night instants | 2446 | 2255 | 2282 | 1976 | 2118 | 1322 | 1388 | 1445 | 1418 | 1480 | 1600 | 1668 |
| No exclusion, K | 3.17 | 3.14 | 2.14 | 1.10 | 0.51 | 1.37 | 1.07 | 1.17 | 1.80 | 2.12 | 3.94 | 4.00 |

Excluding the validation nights moves no month by more than **0.08 K** (Oct), and no month at all in Jan, Feb, Mar, May-Aug. Years: Jan-May have 2024, 2025 and 2026; Jun-Dec have 2024 and 2025. The shape matches P0's hourly-only study (Nov-Dec largest, May smallest); the values are 0.1 to 0.5 K larger in the winter months because every report (:00 and :30, SPECI) is matched to POWER's nearest solar hour, the rule the satellite rows used, where P0 used only the :00 reports against the floor hour.

### The test: 49 night scenes, 19 overpass dates, M0, station forcing, cloud POWER

(The 20th night date is the stale 2026-03-05 scene alone, so the 49 scenes sit on 19 dates; the bootstrap resamples those 19. The table's exclusion used all 20.)

| Forcing | Bias, K [95 % CI] | RMSE, K [95 % CI] |
|---|---|---|
| Airport air, as the live view runs today | +2.50 [+1.73, +3.41] | 3.14 [2.14, 4.08] |
| **Airport air, corrected (the test)** | **+0.10 [-1.10, +1.34]** | **2.65 [1.89, 3.30]** |
| Leave-one-overpass (table rebuilt without that date's night) | +0.07 [-1.12, +1.30] | **2.63** [1.88, 3.27] |
| POWER air (the calibration basis), same rows | -0.23 [-1.37, +1.01] | 2.54 [1.63, 3.39] |

| Pre-set condition | Result |
|---|---|
| (a) night bias 95 % CI includes 0 | **yes**, [-1.10, +1.34] |
| (b) RMSE <= 3.0 K | **yes**, 2.650 K |
| (c) leave-one-overpass RMSE <= 3.0 K | **yes**, 2.631 K |

The reference rows reproduce P2's published figures to the digit (+2.498 / 3.141; -0.23 / 2.544). The correction applied between 1.06 and 4.04 K (mean 2.14). Corrected minus POWER, paired over the same dates: bias +0.33 [-0.28, +0.92], RMSE +0.11 [-0.42, +0.77]: **not distinguishable from the calibration basis.**

### Reported, not decided on

- **Table without the exclusion:** bias +0.06, RMSE 2.63. The exclusion costs nothing in the test.
- **RH recomputed from the corrected air and the observed dew point** (instead of the observed RH, the rule shipped): bias +0.44 [-0.64, +1.58], RMSE 2.47. Passes too; the shipped rule keeps the airport's humidity as observed.
- **A single constant** (the table's night mean, 2.17 K) in place of the month table: bias +0.10 [-0.70, +1.05], **RMSE 1.98 [1.27, 2.59]**. Post hoc and **better** than the table on these dates: table minus constant, paired, is **+0.68 K RMSE [+0.35, +1.04]**. Where it comes from: the 19 dates sit in Jan (3 dates), Mar (1), Apr (6), Sep (2), Oct (4), Nov (1), Dec (2). The model's own night residual on POWER air is -1.6 K in January and -2.9 K in December and +1.4 K in April; the table, which lifts the correction to 3.2 and 4.0 K in those winter months, takes the December residual to -3.5 K, where the constant leaves it at -1.5 K. That is a seasonal error of the model, not of the air table, but the table does not help it. The table is shipped because it is what was pre-registered and what the air-against-air measurement says (a single constant is wrong by 1.5 to 2 K in May and in November-December on the air itself); the Opus audit should decide whether a constant is the better product given this.
- **Untested months.** No validation night falls in February, May, June, July or August. The May-August entries (0.5 to 1.4 K) are measured air against air only and have no LST check at all. The pre-monsoon seasonal caveat (3.06 K against the band) is a separate, existing finding and is not touched.

### Cloud (also used live, not in calibration)

The live night view takes the airport's own cloud cover into the sky temperature; the calibration used POWER's CLOUD_AMT.

- On the 49 night scenes the airport reports 0.03 more cloud than POWER on average (49 of 49 have a station cloud figure). Swapping it in, with the corrected air: bias +0.04, RMSE 2.67 (from 2.65). With the raw air: RMSE 3.05 (from 3.14). **The cloud difference moves the tested night score by 0.1 K or less.**
- Over all 21,956 night reports, VECC minus POWER cloud fraction by month: Jan -0.09, Feb -0.11, Mar -0.07, Apr -0.08, May -0.18, **Jun -0.31, Jul -0.32, Aug -0.33, Sep -0.35**, Oct -0.10, Nov -0.04, Dec -0.12. The airport reports LESS cloud than POWER, most in the monsoon. The model's night surface rises about 0.23 K per +0.10 of cloud on these scenes, so the monsoon gap is worth roughly -0.7 to -0.8 K of surface (colder), and under 0.3 K in the other months. None of the tested nights is in the monsoon, so that part is an estimate from the model's sensitivity, not a score.
- **Not corrected.** Cloud is a bounded fraction (an additive monthly offset can leave 0 to 1), VECC's value is an observer cover class (NSC, FEW, SCT...) mapped to a fraction where POWER's is a model cell, and the effect where it is largest (monsoon) cannot be tested on any validation night. It is not trivially analogous to the air table. Disclosed instead.

### What this changes in the product

- The model's night air at Kolkata is the airport reading less the month's offset when the sun is at or below SUN_LIT; otherwise as before. Bengaluru (VOBL, VOBG) has no table and is unchanged; Amsterdam has no airport.
- The air tile shows the airport's reading as reported; the weather line adds "model air X K lower at night" so the adjustment is visible. Humidity, wind, the day branch, cloud, the rain logic and the heat index are untouched.
- No committed calibration artefact, band or accuracy copy is changed. The ±3.0 K night band stands: the corrected live-input score on the 49 scenes (RMSE 2.65, leave-one-overpass 2.63 K) is under it, where the unadjusted one (3.14 K, bias CI excluding 0) was not.
- The switch is a step at SUN_LIT, as the model's own day/night branch already is (the offset is 0.5 to 4.0 K, so the modelled surface steps by a fraction of that at dusk and dawn). Where the airport has no report and the page falls back to met.no (about 0.3 % of night polls), no adjustment is made: met.no's night air against POWER was not measured here.

### Reproducing

`scripts/build-night-air-table.py` (the table, from the IEM and POWER files), `scripts/check-night-air-parity.py` (TypeScript against Python, 49 scenes + 8 probes, worst 0 K against a 1e-6 K limit), `tests/unit/night-air.test.mjs`, `tests/e2e/heat-map-night-air.spec.ts`. The one-shot scoring (`docs/evidence/kolkata-night-air-correction/run_test.py`, `supp.py`, `cloud_fraction.mjs`, with `result.json` and `supp.json`) imports the typed lab from `feat/daytime-refit-parity` @937532f7 (`_refit_lab.py`, `_refit_score.py`), which is not on this branch, so it is a record rather than a gate. Input hashes are in `data/night-air/vecc-night-air.json`.
