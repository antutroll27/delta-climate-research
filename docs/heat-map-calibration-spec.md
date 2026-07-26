# Heat-map physics calibration — specification

**Status:** approved for implementation
**Supersedes:** the uncalibrated night/day forcing in [`heat-map-intervention-model.md`](heat-map-intervention-model.md) §1–§4
**Depends on:** `scripts/ecostress-census.py`, `scripts/ecostress-suhii.py` (both shipped)
**Date:** 2026-07-26

---

## 1 · Why

Until this week nothing in the heat-map's physics had been compared against measurement of our own
study area. Everything was literature-calibrated. Measuring surface urban heat island intensity
from ECOSTRESS showed the model is **6× out at night** (+9.57 °C modelled vs **+1.59 °C** measured)
and **wrong in sign during the day** (+10.9 modelled vs **−0.23** measured on 14 May 2025).

The night error is diagnosable and fixable. The daytime error is not yet understood, and this
specification deliberately treats it as a **hypothesis to test** rather than a defect to patch.

### What the measurements say

| Scene | Local time | Season | Measured SUHII |
|---|---|---|---|
| 2025-01-31 | 09:42 | winter, dry | **−0.51 °C** |
| 2025-04-02 | 09:37 | early pre-monsoon | +0.59 °C |
| 2025-04-24 | 00:55 | pre-monsoon night | +1.59 °C |
| 2025-05-14 | 17:03 | peak pre-monsoon | −0.23 °C |
| 2025-06-03 | 09:05 | monsoon onset | **+1.65 °C** |

Three morning scenes at nearly the same hour span **−0.51 to +1.65 °C**, so the daytime sign is
**seasonal, not diurnal**. Sensitivity across three rural definitions is 0.08–0.18 °C in every
scene, so the variation is real signal rather than method noise.

### What has already been ruled out

**NDVI does not predict the sign.** Rural NDVI exceeds urban in *every* scene (+0.009 to +0.053)
whether SUHII is +1.65 or −0.51, and the ranking does not track. January has the second-highest
NDVI difference and the most negative SUHII.

The likely reason: NDVI measures *greenness*, not *water availability*. Bengal's rabi crops stay
green through the dry season while soil moisture and evapotranspiration fall, and NDVI saturates
above ~0.5 — where all these values sit. **The mechanism may still be right; NDVI cannot see it.**

---

## 2 · Model class and claim limits (unchanged)

This remains a **2D energy-balance screening model** (SUEWS/UMEP class, not CFD). Calibration does
not upgrade what it may claim. It may still only offer relative scenario comparison, hotspot
location, spatial prioritisation and order-of-magnitude ΔT.

What calibration *does* change: the model becomes anchored to **measurement of its own study area**
rather than to transplanted literature, and its residuals become quantified and disclosed.

---

## 3 · Phase 0 — Measurement set

**Objective.** A versioned calibration dataset large enough that fitting is not overfitting.

Currently we have 5 scenes. Fitting ~6 parameters to 6 numbers is exactly determined: zero
residual, and no way to distinguish a good model from a curve-fit.

**Target:** ≥20 usable scenes across ≥2 years, both phases, all seasons.

**Available population (measured, not estimated).** CMR over 2024-01-01 → 2026-07-01 for the wide
bbox returns **237 distinct acquisitions — 86 day, 151 night** — spread across **four** MGRS tiles
(45QXE, 45QXF, **45QWE, 45QWF**), not the two the ward bbox touches. Since core bands are ~1.1 MB
per tile-acquisition, the **entire population is affordable to sweep**; no sampling is required and
therefore no sampling bias is introduced. How many survive cloud and quality masking is unknown in
advance — on the 2025 subset the rate was roughly 3-in-10 at night and 7-in-14 by day.

**Per scene, record:**

| Field | Notes |
|---|---|
| acquisition UTC and local solar time | ISS precession means these vary; local time is the physically meaningful one |
| phase | day / night per CMR `DayNightFlag` |
| urban mean LST | SMOD class 30 |
| rural mean LST | under all three rural definitions |
| SUHII and its spread | spread is the method-sensitivity check |
| usable pixel fraction | after cloud + QC masking |
| QC accuracy distribution | bits 15&14 |
| view zenith, urban and rural | systematic difference between populations is a silent bias |

**Output:** `data/calibration/ecostress-suhii.csv`, committed and versioned. This is a research
asset in its own right — no published ECOSTRESS SUHII study covers Kolkata.

**Acceptance:** ≥20 scenes; ≥4 night; all four seasons represented; every scene ≥30 % usable.

---

## 4 · Phase 1 — Corrections the literature already determines

These do not depend on our fit and are defensible independently.

### 4.1 Sky temperature → humidity-dependent

Currently hard-coded 17 °C day / 11 °C night regardless of humidity. That is a **dry-sky** value.

```
es = 6.112 · exp(17.67·T / (T + 243.5))        saturation vapour pressure, hPa, T in °C
e  = es · RH/100                                actual vapour pressure
ε_clear = c · (e / T_K)^(1/7)                   Brutsaert 1975, c = 1.24
ε_all   = ε_clear + 0.9·(1 − ε_clear)·cloud     screening cloud correction
T_sky   = ε_all^0.25 · T_K − 273.15
```

`c` is tunable in **1.2–1.4** (Sci Rep 2023 recalibrated it globally by geographically-weighted
regression). Verified: at our conditions Brutsaert, Berdahl–Martin and Prata agree within
**0.6 °C**, and Prata's precipitable water comes to 4.67 g cm⁻², right for humid Kolkata.

Effect: night T_sky 11 → **~19.6 °C**.

**Important:** T_sky is identical for urban and rural cells, so it **cancels in the difference**.
This corrects absolute temperature *level*; it does not change SUHII. Level and contrast are
independent knobs, which is convenient — they can be calibrated separately.

### 4.2 Night evapotranspiration → reduced and dewpoint-gated

Currently the full daytime ET coefficient runs all night. Stomata close after dark.

```
L_night = 0.10 · L_day                          nocturnal ET 5–15 % of daytime
if T_surface < T_dew:  ET term = 0              dew forms — a heat SOURCE, not a sink
```

The 0.10 sits on an eddy-covariance grass measurement (8–9 %), inside the general 5–15 % range,
below the tropical-forest figure (15 %) which reflects tall anisohydric trees we do not have.
Sensitivity band **0.05–0.20**.

The dewpoint gate matters specifically here: on a near-saturated Kolkata night the vegetated
surface frequently forms dew, so an unconditional `− L·veg` sink has the **wrong sign**.

### 4.3 Anthropogenic heat → day/night varying

```
Q_night = 0.5 · Q_day
```

Mumbai's inventory (Sailor et al. 2016) totals ~16 W m⁻², of which **metabolism (6.5) is the
largest term** — larger than building energy (5.8). Metabolism is roughly flat across the day, so
South Asian cities have a **flatter** diurnal profile than Western ones. Band **0.4–0.6**.

---

## 5 · Phase 2 — Calibration against measurement

**Free parameters:** `Q_day`, the `kRad : h` coupling ratio, and Brutsaert `c` within its band.

Everything else is fixed from §4. The coupling ratio is included because it was never derived from
anything: it currently pulls the surface ⅓ toward sky and ⅔ toward air, and that split is arbitrary.

**Method:** least squares against the Phase 0 set, minimising residuals on urban and rural means
jointly (not on SUHII alone — matching a difference while both absolutes are wrong is not a fit).

**Bounds:** every parameter constrained to a physically defensible range, stated in the
implementation plan.

**Deliverables:**
- fitted values with residuals **reported, not hidden**
- the measured values added as permanent checks in `scripts/validate-model.mjs`

**Acceptance:** night SUHII within **±0.5 °C** of measurement; urban and rural absolute means
within **±2 K** (the sensor's own accuracy floor — claiming tighter would be false precision).

**If residuals stay large after fitting, the model structure is wrong and further tuning will not
help. That is a finding to report, not a failure to conceal.**

---

## 6 · Phase 3 — Soil moisture, as a hypothesis test

**This phase tests a hypothesis before it implements anything.** No model change is made unless
the test passes.

### 6.1 Hypothesis

Rural evapotranspiration collapses as soil dries, the countryside outruns the city, and daytime
SUHII goes negative. Formally: **daytime SUHII correlates positively with rural soil moisture.**

### 6.2 Data

**NASA SMAP L3 Enhanced** (`SPL3SMP_E` v006) — 9 km daily surface soil moisture, HDF5, US public
domain, reachable through the same CMR + Earthdata token already in use. Verified available over
the Kolkata bbox.

9 km is coarse against our 70 m thermal, but SUHII is a city-scale statistic, so the scales match.

### 6.3 Test protocol — defined before running

For every Phase 0 daytime scene, extract mean rural soil moisture (SMOD 11/12/13) within ±1 day.
Then:

| Criterion | Threshold |
|---|---|
| Correlation, SUHII vs rural soil moisture | Spearman ρ > 0.6 |
| Significance | p < 0.05 |
| Sign behaviour | SUHII must be negative in the driest tercile and positive in the wettest |
| Sample | ≥12 daytime scenes with SMAP coverage |

**All four must pass.** Thresholds are fixed here, in advance, so the result cannot be rationalised
after the fact — the same discipline that caught the NDVI hypothesis.

### 6.4 If the test passes

Introduce a **vigour multiplier** on the ET term:

```
L_eff = L · g(θ)         θ = soil moisture
g(θ) = clamp((θ − θ_wilt) / (θ_field − θ_wilt), 0, 1)
```

Deliberately **separate from the `veg` layer**, which stays the intervention-controllable
land-cover fraction. The product reading is intuitive: *"30 % vegetation cover, currently 40 %
vigorous, so 12 % effective cooling."* A park in May cools less than the same park in August.

Interventions add vegetation at a stated maintained vigour (assumed irrigated), disclosed as an
assumption — which honestly implies unmaintained planting delivers less.

### 6.5 If the test fails

**No model change.** Daytime is labelled explicitly as not validated for pre-monsoon, and the
negative-SUHII finding is recorded as an open question. Two candidate explanations remain
unexcluded and are documented for future work: **thermal inertia** (the model is steady-state and
has no heat storage, so it cannot produce a diurnal phase lag) and **urban shading at low sun
angle** (17:03 IST in May puts the sun ~20° above the horizon).

---

## 7 · Downstream effects

Calibration is not contained to the physics module.

| Affected | Effect |
|---|---|
| Park-cooling check | Currently passing inside Mitra's Kolkata band; `L` changes will move it |
| Display ramp 26–48 °C | Absolute temperatures shift with the sky correction |
| **Green Score** | Cooling is ⅓ of the score and efficiency is cooling ÷ cost — **scores will change** |
| `Δ vs all-green ref` | Relabelled previously but never recalibrated; this fixes it |
| Compare reference forcing | Shares `currentParamsForReference` |
| `docs/green-score-methodology.md` | Constants table and §6 need revision after Phase 2 |

---

## 8 · Risks

| Risk | Mitigation |
|---|---|
| **Overfitting** | Phase 0 raises the sample to ≥20 before any fit is attempted |
| **Breaking a passing validation** | The harness is the guard; regressions surface immediately |
| **Phase 3 scope creep** | Hard gate: fail the §6.3 test, build nothing |
| **SMAP 9 km too coarse** | Accepted — SUHII is city-scale. If terciles do not separate, that is a test failure, not a reason to subdivide |
| **Cherry-picking scenes** | Every scene meeting the §3 acceptance bar enters the set. Exclusions require a stated reason recorded in the CSV |
| **Silent truncation of the population** | `cmr_search` hardcodes `page_size=200` and slices `[:limit]` *after* deduplication. With 369 night granules in range it would drop data without warning. Pagination is a Phase 0 prerequisite, not an optimisation |
| **Crash mid-sweep on a missing band** | `fetch(None)` raises `AttributeError` when a granule lacks a band. Never triggered on five scenes; a 237-scene sweep is exactly where it surfaces. Guard before sweeping |

---

## 9 · Out of scope

- **Thermal inertia / heat storage.** The model is steady-state. Adding storage means integrating a
  real diurnal cycle — a different model, not a calibration.
- **Urban shading and sky-view factor.** Would need 3D geometry in the energy balance.
- **Advection.** Explicitly not represented; the lateral kernel is a smoothing device, not physics.
- Any change to the intervention model, the cost model, or the Green Score weights.

---

## 10 · Acceptance for the whole piece

- ≥20 calibration scenes committed and versioned
- Night SUHII reproduced within ±0.5 °C; absolutes within ±2 K
- Phase 3 hypothesis explicitly passed or failed against §6.3, with the result recorded either way
- `validate-model.mjs` extended with measurement-based checks and passing
- `npm run verify` green; publication contract unchanged
- Residuals published in the methodology document, not just in code comments
