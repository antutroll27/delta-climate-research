# DC-URS v1 — implementation specification

**Contract:** [`dc-urs-source-of-truth.md`](dc-urs-source-of-truth.md) (CEO-approved engine
definition) + [`dc-urs-engineering-review.md`](dc-urs-engineering-review.md) (approved corrections).
**Date:** 2026-07-27
**Status:** ready to implement — all four blocking decisions taken.

This document says *how we compute DC-URS here*: from which data, with which constants, how the
simulator interacts with it, and how we know it is right. The engine definition itself lives in the
source-of-truth file and is not restated except where a correction changes it.

---

## 0 · Decisions taken

| # | Question | Decision | Consequence |
|---|---|---|---|
| 1 | Spatial unit | **Three wards for now**, widen later | Rank-correlation validation is impossible at n=3 (§7). Pipeline must make widening a config change, not a rewrite |
| 2 | Demographics | **WorldPop** for `ρ_pop`; **NFHS-5 (2019–21) + Census 2011** for `HVI_socio` | Census 2021 does not exist — deferred to Census 2027 (ref. date 1 Mar 2027). NFHS-5 supplies 2021-vintage levels at district resolution; Census 2011 supplies the ward-level spatial pattern. Both vintages shown on the tool |
| 3 | Normalisation anchors | **As specified by the CEO**, researched | Recorded in §4 for auditability; not re-derived |
| 4 | Public tier labels | **Ship as written**, including "Critical Hotspot" | No change to §6 of the source document |

---

## 1 · Study areas

| Ward | Body | Centre | Character |
|---|---|---|---|
| Ballygunge | KMC Ward 68 | 22.528 N, 88.366 E | Urban core |
| Baruipur | Baruipur Municipality | 22.365 N, 88.432 E | Peri-urban fringe |
| Barrackpore | Barrackpore Municipality | 22.762 N, 88.371 E | Industrial river corridor |

**Analysis footprint:** the existing 1400 m box per ward, matching the heat-map simulation domain,
so DC-URS and the thermal model describe the same ground.

**The three sit under three different local bodies.** Their boundaries and statistical returns are
not directly comparable, so `HVI_socio` is computed by areal interpolation of Census 2011 units
onto the common 1400 m footprint rather than by taking any one body's ward figures. This is the
honest treatment at n=3 and it is also what makes widening to 144 KMC wards cheap: the footprint
becomes the KMC boundary and nothing else changes.

**Ward list is data, not code.** `src/data/wards.ts` holds the list; every script takes it as input.
Adding wards must never require touching the pipeline.

---

## 2 · The engine as implemented

**PRECEDENCE (decided 2026-07-27): the source document is the FINAL source of truth for v1.**
It ships as written, plus exactly three fixes — VSI guarded, §5 code over the §4 table, fixed
anchors instead of min-max — each a case where that document contradicts itself or the maths
misbehaves. The five design refinements below are **deferred to v2** and are recorded here so the
v2 work has its starting point.

Verified: the shipped engine reproduces the source document's worked examples exactly,
**Ballygunge 20.01** and **Baruipur 65.23**.

### 2.0 · Deferred to v2

| Refinement | Why it was proposed | Effect of deferring |
|---|---|---|
| Geometric aggregation | IPCC AR6 risk is conjunctive | Weighted sum permits full compensation — a ward at THI 0.85 / ACI 0.90 outscores one at THI 0.30 / ACI 0.35 by 8.3 points |
| Drop `FVC` | Affine transform of NDVI | 0.80 of greenness weight on one variable counted twice |
| `CanopyFrac` | Structurally independent of NDVI | Collected in Phase 1, inert in v1, pinned inert by assertion |
| `/25` daytime anchor | `/20` saturates at 45 °C | Index cannot discriminate above 45 °C |
| Czekajlo attribution | Formula is not their metric | Documentation only |

Each is marked *KNOWN LIMITATION for v2* in `dc-urs.ts` at the point it bites.

### 2.1 Aggregation — weighted sum (v1) · geometric deferred to v2

```
DC-URS = 100 × ACI^0.40 × (1 − EVI)^0.35 × (1 − THI)^0.25
```

Replaces the weighted sum. IPCC AR6 risk is conjunctive: a near-zero pillar must drag the whole
score down rather than being bought off by a strong one. Under the additive form a ward at
THI 0.85 / ACI 0.90 scored 8.3 points *better* than one at THI 0.30 / ACI 0.35.

Guard: clamp each pillar to `[0.001, 1.0]` before exponentiation so a single zero cannot annihilate
the score, and so `0^0.4` is never evaluated.

### 2.2 Urban Greenness Score — NDVI + FVC + VSI (v1), VSI guarded (fix 3)

```
UGS = 0.50·FVC + 0.30·CanopyFrac + 0.20·VSI
```

- **`FVC`** — fractional vegetation cover, as defined in the source document. Used *instead of*
  raw NDVI rather than alongside it: `FVC` is an affine transform of NDVI, so the original
  `0.40·NDVI + 0.40·FVC` spent 80 % of the greenness weight on one variable counted twice. FVC is
  the better of the two to keep — already scaled to `[0,1]` and physically interpretable as the
  fraction of ground under vegetation.
- **`CanopyFrac`** — fraction of the footprint classified as tree cover (ESA WorldCover class 10).
  Genuinely independent of NDVI: *structural* rather than *spectral*. Grass and mature canopy can
  share an NDVI and cool very differently.
- **`VSI`** — vegetation stability, corrected:

```
VSI = NDVI_mean > 0.10 ? 1 − clamp(σ_NDVI / NDVI_mean, 0, 1) : 0
```

The threshold fixes the water bug. Unguarded, water's negative mean NDVI makes the ratio negative,
`clamp(…, 0, 1)` floors it at zero and VSI returns **1.00 — perfect vegetation stability for a
river**. Below the threshold there is no vegetation whose stability could be measured, so the
correct answer is 0.

### 2.3 Daytime hazard — `/20` as specified (v1) · `/25` deferred to v2

```
THI_day_term = clamp((LST_day − 25.0) / 25.0, 0, 1)
```

The original `/20.0` saturates at 45 °C, making the index blind above that — precisely the wards a
heat action plan exists for. Extending to a 50 °C ceiling keeps discrimination across the observed
Kolkata surface range. All other anchors are unchanged (§4).

### 2.4 Pillar weights — §5 code wins over the §4 table (fix 5)

The source document's §4 table and §5 code disagree on two pillars. The **code** is normative:

| Pillar | Within-pillar weights | Terms |
|---|---|---|
| THI | 0.40 / 0.40 / 0.20 | `LST_day`, `LST_night`, `UHI_Δ` |
| EVI | 0.45 / 0.30 / 0.25 | `ρ_pop`, `FAR`, `HVI_socio` |
| ACI | 0.50 / 0.30 / 0.20 | `UGS`, `CRI`, `TRA` |

Top-level weights are unchanged: `w_A = 0.40`, `w_E = 0.35`, `w_H = 0.25`.

### 2.5 Attribution — deferred to v2

Czekajlo et al. (2020) is credited for the *concept* — that current greenness and its multi-year
trajectory are jointly meaningful and satellite-measurable. The formula above is ours and is
described as such. Their metric derives greenness by spectral unmixing of Landsat composites over
18 Canadian cities and is not `FVC + CanopyFrac + VSI`.

---

## 3 · Input register

Nine indicators. Every one needs a source, a licence, a vintage and a spatial support before
implementation starts — this table is the contract.

| Indicator | Source | Licence | Vintage | Resolution | Have it? |
|---|---|---|---|---|---|
| `LST_day` | NASA ECOSTRESS L2T LSTE v002 | US public domain | 2024–26, 49 scenes | 70 m | **yes** |
| `LST_night` | NASA ECOSTRESS L2T LSTE v002 | US public domain | 2024–26, 31 scenes | 70 m | **yes** |
| `UHI_Δ` | derived: urban − rural, GHS-SMOD masks | CC BY 4.0 | as above | 70 m | **yes** |
| `FVC` | Sentinel-2 L2A via keyless STAC | free, attribution | seasonal composites | 10 m | build |
| `CanopyFrac` | ESA WorldCover v200 class 10 | CC BY 4.0 | 2021 | 10 m | partial |
| `VSI` | Sentinel-2 / Landsat annual series via STAC | free, attribution | ≥5 years | 10–30 m | build |
| `CRI` (albedo) | Sentinel-2 bands via STAC, source doc's coefficients | free, attribution | seasonal | 10 m | build |
| `FAR` | Google Open Buildings 2.5D + MS footprints | CC BY 4.0 / ODbL | 2023–25 | per-building | **inputs held** |
| `TRA` | OSM parks, water, cooling centres | ODbL | live | vector | build |
| `ρ_pop` | WorldPop constrained, UN-adjusted | CC BY 4.0 | **2020** (latest confirmed) | 100 m | build |
| `HVI_socio` | NFHS-5 levels × Census 2011 spatial pattern | Govt. of India open / DHS | **2019–21 + 2011** | district × ward | build |

**No Earth Engine dependency.** Every satellite input is reachable through keyless public STAC
catalogues — Microsoft Planetary Computer, Copernicus Data Space, and AWS Earth Search all verified
live (HTTP 200, 2026-07-27). Earth Engine was only ever the access path we happened to hold
credentials for from the AlphaEarth work; it is not part of the CEO's design. Dropping it removes a
credential to maintain and a token to expire.

**Seasonality is not optional.** Kolkata's NDVI swings enormously between monsoon and dry season —
the same seasonal signal measured in the thermal work. Every vegetation input is a **seasonal
composite**, never a single scene. Czekajlo used 33 years of annual composites for this reason.

**Vintage is displayed, not buried.** `HVI_socio` is the only genuinely constrained input. Its
variables — share over 65, share under 5, low-income proxy, informal-settlement fraction — come from
a *census*, and India held none in 2021; the enumeration was deferred to Census 2027.

The build therefore pairs two sources rather than pretending one is current:

- **NFHS-5 (fielded 2019–21)** for present-day *levels* — a real national survey with age structure
  and wealth quintiles, distributed through the DHS Program. Resolves to **district**, not ward.
- **Census 2011** for the ward-level *spatial pattern* — the only enumeration that resolves to the
  geography DC-URS needs.

That is as close to 2021 as Indian data permits. Rathi et al. (2021) and Azhar et al. (2017) face
exactly the same constraint. The tool states both vintages.

---

## 4 · Normalisation anchors

**Fixed absolute anchors, not min-max** (delta 6). Min-max is disqualifying for a product: with
three wards the best always scores 1.0 and the worst 0.0, and adding a fourth silently rescores
every existing ward. Fixed anchors are stable across time, across wards, and across cities.

| Term | Anchor | Provenance |
|---|---|---|
| `LST_day` | `(x − 25) / 25` | CEO-specified; denominator extended from 20 per delta 7 |
| `LST_night` | `(x − 20) / 15` | CEO-specified |
| `UHI_Δ` | `x / 10` | CEO-specified |
| `ρ_pop` | `x / 25000` | CEO-specified |
| `FAR` | `x / 5.0` | CEO-specified |
| `HVI_socio` | `x / 10` | CEO-specified |
| `CRI` | `albedo / 0.60` | CEO-specified; 0.60 is LBNL's aged cool-roof value, consistent with the thermal model |
| `TRA` | `exp(−0.002·d)` | CEO-specified; ≈347 m half-distance |

Anchors are researched and owned by the CEO. Recorded here so that if a score is ever disputed, the
constant and its owner are both traceable. Every one is clamped to `[0,1]`.

---

## 5 · Scenario layer

DC-URS replaces the Green Score, so the sliders must still move it. One score, evaluated twice:
**baseline** (observed) and **scenario** (baseline with modelled changes applied).

| Indicator | Under intervention | Note |
|---|---|---|
| `FVC` | **moves** | trees, parks → vegetation fraction from the existing model |
| `CanopyFrac` | **moves** | tree corridors add canopy |
| `CRI` | **moves** | cool roofs → albedo, already modelled |
| `TRA` | **moves** | new parks shorten distance to refuge |
| `LST_day/night`, `UHI_Δ` | **moves** | from the thermal model, carrying its measured error |
| `VSI` | **frozen** | see below |
| `ρ_pop`, `FAR`, `HVI_socio` | **inert** | no intervention changes them |

**VSI is frozen at its baseline value in scenario mode.** It measures multi-year persistence; newly
planted cover has no history and scores ≈0.27 against a mature canopy's 0.95, so an honest live
VSI would make *planting trees lower the score*. Freezing is disclosed in the UI.

### The structural floor is a first-class output

`EVI` carries 0.35 of the weight and nothing the user does touches it. Under the additive form,
Ballygunge's ceiling with a physically perfect retrofit — full canopy, 0.60 albedo, refuge adjacent,
surface temperature at the rural baseline — was **61.4**; it could never leave "Moderate
Resilience". The geometric form will differ and must be recomputed, but the property holds.

This is the product's sharpest output and must be **shown, not hidden**:

> *28 of Ballygunge's missing points are demographic exposure. Trees cannot fix them — that needs
> housing, health outreach and cooling-centre policy.*

The UI displays achievable headroom separately from the structural floor. `structuralFloor(ward)`
is a named export, not an incidental number.

---

## 6 · Uncertainty

The thermal model's measured error is **± 3.5 °C night / ± 5.0 °C day**
([`green-score-methodology.md`](green-score-methodology.md) §5A). That propagates into any DC-URS
value computed from modelled rather than observed temperature.

Under the additive form, 1 K of daytime LST moved the score ~1.0 point, so ±5 K ≈ ±5 points — a
quarter of a tier band. **The geometric form changes this and it must be re-measured, not assumed.**

- **Baseline** scores use *observed* ECOSTRESS temperature → thermal uncertainty is the sensor's,
  not the model's.
- **Scenario** scores use *modelled* temperature → carry the full model band.

This asymmetry is deliberate and must be visible: the baseline is measured, the scenario is
modelled. `scripts/measure-dcurs-uncertainty.py` produces the band by Monte Carlo over the
measured error distribution.

---

## 7 · Validation

**Rank correlation against published Kolkata vulnerability maps is impossible at n = 3.** That is a
direct consequence of decision 1 and is stated rather than worked around. It becomes available when
the ward set widens. Until then, four checks:

1. **Golden-case regression.** The source document's worked wards produce **Ballygunge 20.01** and
   **Baruipur 65.23** under the original engine. Recomputed under the corrected engine on the same
   inputs (2026-07-27, dry-run):

   | Ward | Original | Corrected | Tier |
   |---|---|---|---|
   | Ballygunge | 20.01 | **21.13** | Critical Hotspot |
   | Barrackpore* | — | **40.14** | Vulnerable |
   | Baruipur | 65.23 | **64.16** | Moderate Resilience |

   \* Barrackpore inputs are plausible estimates, not measured — it has no worked example in the
   source document. It is included only to check tier separation and is **not** part of the frozen
   fixture until Phase 1 supplies real inputs.

   **The corrections cost almost nothing in calibration and buy a great deal in correctness.**
   Spread falls only 45.2 → 43.0 points, the three wards still land in three distinct tiers, and
   the CEO's two anchor wards move by 1.1 and 1.1 points. Separately, the VSI guard turns water
   from 1.00 (perfect vegetation stability) to 0.00.

   Freeze the two real wards as the fixture. Any later change that moves them must justify itself —
   the same discipline as `validate-model.mjs`.
2. **Face validity.** Ranking must match known Kolkata geography. A dense hot core scoring above a
   green fringe is a failure regardless of what the maths says.
3. **Sensitivity analysis.** Vary each of the nine indicators across its plausible range and record
   the swing in DC-URS. If one dominates, the other eight are decoration and the weighting is
   wrong. Report as a ranked table.
4. **Uncertainty band**, per §6.

**Acceptance:** all four run and reported. No numeric bar is set for face validity or sensitivity
because none can be justified at n=3 — inventing one would repeat the ±2 K mistake from the thermal
calibration, where a bar was set before anyone knew what was achievable.

---

## 8 · File plan

```
src/data/
  wards.ts                       NEW   ward list as data — widening is a config change

src/scripts/climate-engine/
  dc-urs.ts                      NEW   the engine: pure, DOM-free, self-checked
  dc-urs-inputs.ts               NEW   typed indicator record + provenance per field

scripts/
  fetch-worldpop.py              NEW   population density per ward footprint
  fetch-census-2011.py           NEW   HVI_socio, areal-interpolated
  fetch-sentinel-composites.py   NEW   seasonal FVC, albedo, VSI series via EE
  compute-far.py                 NEW   FAR from Google 2.5D + MS footprints
  compute-tra.py                 NEW   distance-to-refuge from OSM
  build-dcurs-inputs.py          NEW   assemble → data/dc-urs/inputs.json
  measure-dcurs-uncertainty.py   NEW   Monte Carlo band
  validate-dcurs.mjs             NEW   the four §7 checks

data/dc-urs/
  inputs.json                    NEW   one record per ward, every field with provenance
  golden-cases.json              NEW   frozen regression fixture
```

`dc-urs.ts` carries `assertDcUrsLogic()` — bounded 0–100, geometric guard against zero pillars,
VSI returns 0 for water, monotonicity in each pillar, and the frozen golden cases.

---

## 9 · Phasing

| Phase | Work | Done when |
|---|---|---|
| 0 | `wards.ts`, `dc-urs.ts` with corrected maths, self-checks, golden cases recomputed and frozen | engine runs on hand-fed inputs, `npm run verify` green |
| 1 | Observed pillars: FVC, CanopyFrac, VSI, CRI, FAR, TRA | real ACI and partial EVI for three wards |
| 2 | `ρ_pop` from WorldPop, `HVI_socio` from Census 2011 | EVI complete, vintages displayed |
| 3 | Validation — all four §7 checks | report published, sensitivity table recorded |
| 4 | Scenario layer + structural floor in the UI; Green Score retired | sliders move DC-URS; floor visible |

Phase 0 is independent of all data acquisition and can start immediately.

---

## 10 · What could go wrong

| Symptom | Response |
|---|---|
| Geometric form compresses all three wards together | **Tested 2026-07-27: it does not.** Spread 45.2 → 43.0 points, three distinct tiers retained. Re-check once real inputs land |
| Sensitivity shows one indicator dominating | Weighting problem, not a code problem. Report to CEO with the table; do not silently retune |
| Census 2011 units don't align with the 1400 m footprint | Areal interpolation with the assumption stated; if a ward's population is implausible, say so rather than smoothing it |
| WorldPop and Census 2011 disagree on population | They will — different vintages and methods. Use WorldPop, record the gap |
| Score moves a lot vs the Green Score | Expected and pre-agreed. Document the delta per ward |
| A pillar goes to exactly zero | The `[0.001, 1.0]` clamp catches it; log it, because it usually means missing data rather than a real zero |

---

## Sequencing rule

Same as the thermal calibration: **one change at a time, measured after each.** Every phase ends
with a number that either matches expectation or does not. The failure this project has already
seen twice — a constant tuned until the picture looked right — is avoided by the golden-case
fixture and the sensitivity table, not by good intentions.
