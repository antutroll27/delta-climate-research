# Pocket-park size — a pre-registered measurement (NOT RUN)

**Status:** saved 2026-09-14, deliberately not run · **Decision:** keep `parkRadiusM = 50` as a design
default; see `docs/heat-map-intervention-model.md` §3.3 (2026-09-14 correction).

## Why it was not run

A feasibility study (2026-09-14) found three things:

1. **The quantity is ill-posed.** Li et al. 2022 (10.3389/fenvs.2022.1073914) define TVoE where the slope
   of `UCI = a·ln(Area) + b` is one, so TVoE = a — a regression slope whose value is unit-independent.
   Comparing a Bengaluru "TVoE" to Kolkata's "0.77 ha" compares slopes, not sizes.
2. **Kolkata cannot be reproduced.** Li hand-picked 90 tree-dominated parks in Google Earth (not usable
   here). OSM with Li's literal rules yields 28, none ≥ 5 ha (Li's ran to 39.42 ha).
3. **Bengaluru lacks the large parks a stable fit needs.** Under any isolation rule only 1–4 parks above
   5 ha survive; Li's own fits were weak (R² 0.08 / 0.31 / 0.12). An inconclusive interval was the likely
   outcome.

Yu et al. 2017's correct DOI is **10.1016/j.ecolind.2017.07.002** (`…06.037` is an unrelated paper).

## The method, fixed in advance, should it ever be run

- **Surface temperature:** Landsat Collection 2 Level-2 ST (`lwir11`) via Microsoft Planetary Computer
  (SAS token path `/token/landsat-c2-l2`), path/row 144/051, cloud < 20 %, **December–February 2019–2025**
  (41 L8/L9 scenes; Li used winter). QA_PIXEL bits 1, 3, 4, 7 masked. °C = DN × 0.00341802 + 149.0 − 273.15.
  Stated deviation: USGS ST product, not Li's ESTARFM-fused LST. Mar–May reported, not decisive.
- **Parks:** OSM `leisure=park|garden` ≥ 900 m²; ESA WorldCover 2021 tree cover (class 10) ≥ 50 %; no
  WorldCover water inside; ≥ 300 m from other park/garden/forest and water ≥ 1 ha. Per scene, drop a park
  with < 80 % clear pixels; require ≥ 3 valid scenes.
- **Cooling intensity (Li's):** 18 rings × 30 m; intensity = LST at the first turning point minus park
  LST; drop scenes cooler at ring 1 or without a turning point; per-park median across scenes.
- **Fit:** OLS `intensity = a·ln(area_ha) + b`; report `a` as °C per ln(ha); defined only if a > 0,
  p < 0.05.
- **Uncertainty:** 10,000 park-level bootstrap resamples (fixed seed), percentile 95 % CI; 2 km spatial
  block bootstrap as sensitivity.
- **Kolkata gate, run first:** same pipeline, winter 2020–21 (138/044–045), UTM 45N; must return a CI
  containing Li's 0.77 and excluding 0, or no Bengaluru number is used.
- **Placebo:** each selected park's shape pasted onto random built-up locations (WorldCover built-up ≥ 50 %,
  trees < 10 %); a placebo slope CI excluding 0 on the positive side voids the result.
- **Decision rule:** gate fails, placebo fires, < 60 parks, a ≤ 0 or p ≥ 0.05 → keep 50 m, "not
  measurable"; CI half-width > 0.5 → keep, "inconclusive"; CI contains 0.77 → keep, "consistent with
  Kolkata"; CI excludes 0.77 → Bengaluru-only radius √(a·10⁴/π) m.

## The better question, recorded beside it

Pocket parks are small, and Bengaluru has hundreds of them (OSM: 2,178 under 0.25 ha, 1,219 at 0.25–1 ha,
377 at 1–5 ha). A physically meaningful measurement is **cooling intensity by park-size band**
(0.1–0.25 / 0.25–1 / 1–5 ha) with the same ring metric, setting the pocket-park size to the smallest band
that reliably cools. It needs its own pre-registration before any number is looked at.
