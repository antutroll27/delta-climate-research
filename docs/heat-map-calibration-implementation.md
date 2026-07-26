# Heat-map physics calibration — implementation plan

**Contract:** [`heat-map-calibration-spec.md`](heat-map-calibration-spec.md)
**Date:** 2026-07-26
**Estimate:** ~2 days across four phases, each landing green before the next

Every phase ends with `npm run verify` passing and a commit. Phases 0–2 are independent of
Phase 3's outcome, so the night model ships regardless of what the soil-moisture test finds.

---

## File plan

```
scripts/
  ecostress-census.py          FIX    P0 · fetch() None-guard, cmr_search pagination
  ecostress-suhii.py           EXTEND P0 · expose measure_scene(); no sys.exit on failure
  build-calibration-set.py     NEW  P0 · sweep scenes → versioned CSV
  fetch-smap.py                NEW  P3 · SMAP L3 rural soil moisture per scene
  fit-physics.py               NEW  P2 · bounded least-squares → fitted constants
  validate-model.mjs           EXTEND P2 · add measurement-based checks

data/calibration/
  ecostress-suhii.csv          NEW  P0 · the calibration set (committed)
  smap-soil-moisture.csv       NEW  P3 · rural soil moisture per scene
  fitted-constants.json        NEW  P2 · fit output + residuals, versioned

src/scripts/climate-engine/
  sky.ts                       NEW  P1 · Brutsaert sky temperature, self-checked
  types.ts                     EDIT P1/P2 · DEFAULT_PARAMS from the fit
  heat-map-model.ts            EDIT P1 · night ET gate, Q day/night split
```

`sky.ts` is a separate module because it is pure, independently testable, and will be reused by
Compare's reference forcing.

---

## Phase 0 — Build the calibration set (½ day)

> **Revised after auditing the plan against the code.** Four assumptions were wrong; each is now a
> concrete task below. The net effect is favourable — a *full* sweep turns out to be affordable, so
> no sampling and no sampling bias.

### 0a · Fix three defects before sweeping anything

- [ ] **`fetch(None)` crashes.** `band_url()` returns `None` for an absent band and `fetch()`
      immediately calls `url.rsplit`. Guard with an early `if not url: return None`. Latent on five
      scenes; certain to surface across 237.
- [ ] **`cmr_search` silently truncates.** `page_size=200` is hardcoded and `[:limit]` is applied
      *after* dedup, but the night query alone returns 369 granules. Add `CMR-Search-After` header
      pagination and make `limit=None` mean "all". **Silent data loss is the worst failure mode
      here** — it would bias the calibration set invisibly.
- [ ] **Four tiles, not two.** The wide bbox touches `45QXE`, `45QXF`, `45QWE`, `45QWF`. The mosaic
      loop already handles arbitrary tile counts, but cost and runtime estimates assumed two.

### 0b · Two-stage band fetching

Measured band sizes: **LST 0.9 MB · QC 0.2 MB · cloud ~0 · water ~0 · view_zenith 3.3 MB.**

`view_zenith` is **three times the cost of everything else combined** and feeds a single control
check. So:

- [ ] **Stage 1** — fetch LST + QC + cloud + water for all 237 acquisitions (~1.0 GB), compute
      usable fraction and SUHII.
- [ ] **Stage 2** — fetch `view_zenith` only for scenes clearing the usability bar (~25 × 4 tiles
      ≈ 0.3 GB) and attach the urban/rural angle check to those rows only.

Scenes without a view-angle check are marked as such in the CSV rather than silently lacking it.

### 0c · The sweep

- [ ] Refactor `ecostress-suhii.py`'s `main()` so per-scene computation is importable as
      `measure_scene(date, phase, want_view=False) -> dict | None`. **Return `None` on failure —
      do not `sys.exit()`**, which currently would kill the whole sweep on one bad scene.
- [ ] Sweep **2024-01-01 → 2026-07-01**, both phases.
- [ ] Below 30 % usable → row still written, with `status=skipped` and a reason. The spec forbids
      invisible exclusions.
- [ ] Emit `data/calibration/ecostress-suhii.csv`, including `local_solar_hour` derived from
      longitude rather than a fixed +5:30, since ISS precession makes true solar time the
      physically meaningful variable.
- [ ] Print a season × phase coverage matrix so gaps are visible before fitting.
- [ ] Make the sweep **resumable** — skip dates already present in the CSV. A ~1.3 GB download over
      a domestic connection will be interrupted.

**Verify:** ≥20 usable scenes, ≥4 night, all four seasons. Short of that, widen to 2023 — do not
lower the bar.

**Cost:** ~1.3 GB total, one-off. The cache is persistent and the CSV is committed, so this runs
once for the project.

---

## Phase 1 — Literature-determined corrections (½ day)

### 1a · `src/scripts/climate-engine/sky.ts`

```ts
/** Saturation vapour pressure, hPa (Tetens/Magnus). T in °C. */
export function saturationVapourPressure(tC: number): number {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/**
 * Effective sky temperature, °C — Brutsaert (1975) clear-sky emissivity with a
 * screening cloud correction.
 *
 * Replaces hard-coded 17 °C day / 11 °C night, which are DRY-sky values. Humid
 * tropical air is near-opaque in the thermal IR, so the effective sky sits only
 * a few K below air. At Kolkata night conditions this moves T_sky 11 → ~19.6 °C.
 * Cross-checked against Berdahl–Martin and Prata: all three agree within 0.6 °C.
 *
 * @param tC     air temperature, °C
 * @param rh     relative humidity, %
 * @param cloud  cloud fraction 0–1
 * @param c      Brutsaert coefficient; 1.24 original, 1.2–1.4 by GWR recalibration
 */
export function skyTemperatureC(tC: number, rh: number, cloud = 0, c = 1.24): number {
  const tK = tC + 273.15;
  const e = saturationVapourPressure(tC) * (rh / 100);
  const clear = c * Math.pow(e / tK, 1 / 7);
  const eps = Math.min(1, clear + 0.9 * (1 - clear) * cloud);
  return Math.pow(eps, 0.25) * tK - 273.15;
}
```

- [ ] Add `assertSkyLogic()` — a node-runnable self-check asserting T_sky rises with humidity,
      stays below air temperature, and lands 19–21 °C at 28 °C/80 %.
- [ ] Wire into `currentParams` and `currentParamsForReference`, replacing the fixed `tSky`.

### 1b · Night ET gate — `heat-map-model.ts`

- [ ] `NIGHT_ET_FRACTION = 0.10` with the sources in a comment.
- [ ] Dewpoint from RH; when the surface equilibrium falls below it, drop the ET term to zero.
      Implemented as a **two-pass evaluation** (equilibrium without ET, test against dewpoint,
      re-evaluate) — the cheapest correct approach, since the gate depends on the answer.

### 1c · Q day/night — `heat-map-model.ts`

- [ ] `Q_NIGHT_RATIO = 0.5`, applied in the night branch only.

**Verify:** `npm run verify` green; harness still 8/8. Expect absolute temperatures to rise and
SUHII to be *unchanged* — the sky term cancels in the difference. **If SUHII moves, something is
wired wrong.** That is the phase's real test.

---

## Phase 2 — Fit against measurement (½ day)

**`scripts/fit-physics.py`** — `scipy.optimize.least_squares`, bounded.

| Parameter | Start | Bounds | Rationale |
|---|---|---|---|
| `Q_day` | 0.55 | 0.02 – 0.60 | Mumbai ~16 W m⁻² city-mean; dense cells higher |
| `kRad : h` ratio | 0.5 | 0.15 – 1.5 | Never derived from anything; currently arbitrary |
| Brutsaert `c` | 1.24 | 1.20 – 1.40 | Published GWR recalibration range |

- [ ] Residual vector = urban and rural means jointly across all scenes, **not SUHII alone** —
      matching a difference while both absolutes are wrong is not a fit.
- [ ] Weight by usable-pixel fraction; a 96 % scene should count more than a 31 % one.
- [ ] Write `data/calibration/fitted-constants.json` with values, residuals, and the scene count.
- [ ] Update `DEFAULT_PARAMS` from that file, citing it.
- [ ] Extend `validate-model.mjs`: measured night SUHII **1.59 ± 0.5 °C**, urban and rural
      absolutes **± 2 K**.

**Verify:** new checks pass; existing 8 still pass. Report residuals in the commit message.

**Stop condition:** if residuals exceed ±2 K after fitting, stop and report. The structure is
wrong and more tuning will not fix it.

---

## Phase 3 — Soil-moisture hypothesis test (½ day, gated)

### 3a · `scripts/fetch-smap.py`

- [ ] `pip install h5py` (only new dependency).
- [ ] `SPL3SMP_E` v006 via CMR, same bearer token.
- [ ] Extract `soil_moisture` on the 9 km EASE-Grid 2.0, mean over rural cells (SMOD 11/12/13)
      within ±1 day of each daytime scene.
- [ ] Write `data/calibration/smap-soil-moisture.csv`.

### 3b · The test — run before writing any model code

- [ ] Spearman ρ and p between daytime SUHII and rural soil moisture.
- [ ] Tercile check: negative SUHII in the driest tercile, positive in the wettest.
- [ ] Print a **PASS/FAIL against the four §6.3 criteria verbatim**, so the verdict is mechanical.

### 3c · Only if PASS

- [ ] Vigour multiplier `g(θ)` on the ET term, kept separate from the `veg` layer.
- [ ] Ship per-ward soil moisture in the ward JSONs, versioned.
- [ ] Interventions add vegetation at maintained vigour, with the assumption stated in the UI.

### 3d · If FAIL

- [ ] No model change.
- [ ] Label the daytime view as not validated for pre-monsoon.
- [ ] Record thermal inertia and low-sun-angle shading as the surviving candidate explanations.

---

## Documentation, after Phase 2

- [ ] `heat-map-intervention-model.md` §1–§4 — new forcing, sky model, night ET, Q split
- [ ] `green-score-methodology.md` — constants table, and note that scores changed
- [ ] Regenerate the methodology PDF
- [ ] Memory: record the calibration result and the NDVI dead end so it is not retried

---

## What could go wrong

| | Symptom | Response |
|---|---|---|
| Not enough scenes | <20 after the sweep | Widen to 2023. Do not lower the bar |
| Sweep dies partway | One bad granule aborts the run | `measure_scene` returns `None`, never exits; sweep is resumable from the CSV |
| Population silently truncated | Fewer acquisitions than the 237 measured | Pagination assertion — fail loudly if the count drops |
| SUHII moves in Phase 1 | Sky term not cancelling | Wiring bug — find it before Phase 2 |
| Residuals stay large | >±2 K after fitting | **Stop.** Report a structural problem |
| SMAP terciles do not separate | Test fails on sample | Honest FAIL, take branch 3d |
| Scores shift a lot | Green Score moves | Expected and pre-agreed; document the delta |

---

## Sequencing rule

**One change at a time, measured after each.** The bug that started this — a physical constant
tuned for visual appearance — happened because several things moved at once and nothing was
checked against measurement. Each phase here ends with a number that either matches observation or
does not.
