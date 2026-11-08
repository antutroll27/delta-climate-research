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
