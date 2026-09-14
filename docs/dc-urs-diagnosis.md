# DC-URS — measured diagnosis, 2026-09-06

**Status:** investigation complete, design PAUSED before any code change.
**Trigger:** the co-founder's policy-background colleague reported the resilience score is
inaccurate, and proposed a composite ward score on the IPCC AR5 framework with a water
dimension, citing CEEW's Navsari City Action Plan.

Nothing here is inferred. Every figure was produced by running the shipped engine
(`src/scripts/climate-engine/dc-urs.ts`) against the shipped inputs (`data/dc-urs/inputs.json`)
or by reading the calibration CSVs directly.

---

## 1. The headline: the score is a population-density map

Score swing produced by each indicator's REAL observed spread across the three wards:

| indicator | observed range | score swing | share |
|---|---|---|---|
| **popDensity** | 8,772 → 68,810 | **10.22 pts** | **62 %** |
| far | 0.346 → 1.159 | 1.71 | 10 % |
| socioVuln | 3.354 → 4.624 | 1.11 | 7 % |
| fvc | 0.309 → 0.447 | 1.10 | 7 % |
| ndviMean / distCoolM / albedo / ndviStd | — | < 1 pt each | 14 % |
| **lstDayC / lstNightC / ruralBaseC** | identical | **0.00** | **0 %** |

Total discriminating power 16.54 points; observed spread 12.28 points.

DC-URS ranks the three wards in **perfect inverse density order** (Spearman rho = -1.0 against
density alone): Barrackpore 8,772/km2 -> 61.85, Baruipur 36,728 -> 53.95, Ballygunge 68,810 -> 49.57.
Barrackpore does not score best because it is resilient. It scores best because it is empty.

The density term is also CLAMPED for two of three wards against the `/25000` anchor, so even that
62 % runs through a saturated input.

## 2. The weights are NOT the problem

Sensitivity across each indicator's full plausible range spans 15.4 % (lstDayC) down to 2.9 %
(ruralBaseC) — well balanced, and it passes spec section 7 check 3. This check was specified and
never run; `scripts/validate-dcurs.mjs` and `scripts/measure-dcurs-uncertainty.py` do not exist.

Consequence: restructuring to `H x E x V` would redistribute weight over inputs of which three are
constants and one supplies 62 % of the signal. The framework is not what makes the score wrong.

## 3. Confirmed defects

**3.1 The UHI sign is a one-line aggregation bug.**
`scripts/build-dcurs-inputs.py:124` computes `median(urban) - median(rural)`. Because rural readings
exist on a different subset of scenes in a strongly seasonal series, the two medians land on
different days and the sign flips: 30.72 - 30.96 = **-0.24 K**, clamped to 0 in all three wards.

Computed correctly — per scene, then median — SUHII is **+0.40 K day / +0.33 K night** (near-nadir,
view_delta <= 0.75; positive in 12/15 and 16/21 scenes). The correct per-scene value is ALREADY in
`data/calibration/ecostress-suhii.csv` as the unused `suhii_strict` column.

**3.2 The thermal pillar cannot separate wards, and per-ward data already exists.**
LST day/night/rural are bbox-wide over a ~15 x 45 km box containing all three wards. But
`data/calibration/landsat-ward-lst.json` holds **213 ward-scenes over 50 overpasses**, QA-masked,
per ward. Compared WITHIN the same overpass:

| comparison | median delta | consistency |
|---|---|---|
| Ballygunge - Baruipur | **+1.46 K** | Ballygunge hotter in **72/73 (99 %)** |
| Ballygunge - Barrackpore | +0.57 K | 34/43 (79 %) |
| Baruipur - Barrackpore | -0.82 K | Baruipur hotter in 8/34 (24 %) |

Ordering: dense core hottest -> industrial corridor -> green fringe coolest. Face validity holds.
`scripts/_ecostress.py` already accepts a per-ward `bbox`, so per-ward night is a re-run, not research.

**3.3 PAIRING IS MANDATORY — the same bug is easy to reintroduce.**
Hot season (Mar-Jun), UNPAIRED medians rank Baruipur hottest (38.22) and Ballygunge second (37.58).
PAIRED within overpass, Ballygunge is hotter than Baruipur in **15 of 15 scenes (100 %)**.
Same data, opposite ranking. Any per-ward thermal input must be built as a paired anomaly.

**3.4 UHI_delta can never discriminate wards.**
It measures city-vs-countryside: one number, identical for every ward, by construction. At ~0.4 K
against a `/10` anchor it contributes 0.04 of 1.0. The weak tropical daytime SUHI is REAL (the dry
rural surround is nearly as hot as the city), not a bug. The within-city contrast is 4x larger and
99-100 % consistent, so a ward-vs-city-mean anomaly is the term that would actually work.

**3.5 The golden cases are frozen against wards that do not exist.**
Source-document assumptions vs measured: Baruipur density 4,500 vs **36,728** (8.2x);
Ballygunge distance-to-refuge 800 m vs **77.8 m** (10x); Ballygunge FAR 3.8 vs **1.16**;
Ballygunge LST_day 42.5 vs 30.72. The published "Ballygunge 20.01 / Baruipur 65.23" describe
fictional wards. Real spread is 12.28 points, not the designed 45.2.

**3.6 Documentation drift.**
- `docs/dc-urs-spec.md` sections 2.1-2.3 print the v2 formulas under "(v1)" headings. The CODE is
  right (weighted sum, NDVI+FVC+VSI at 0.40/0.40/0.20, `/20` day anchor); the spec bodies are stale.
- Spec section 3 names WorldPop; the build used JRC GHS-POP R2023A (WorldPop's India raster is
  466 MB and its server rejects range requests). Sound substitution, documented in `worldpop.json`,
  but the contract and the build disagree.
- `HeatMapStage.astro:218` publicly claims "IPCC AR6 framing" for an additive formula that is not
  AR6-shaped.

## 4. Scope facts that constrain any redesign

- **A "ward" is a 1.4 km square box**, not an administrative ward (`src/data/wards.ts`,
  `footprintM: 1400`). CEEW scored real ward polygons. A policy reader notices this first.
- **No Kolkata flood model exists.** `src/scripts/flood-sim/` on main is empty; the simulator is
  Dubai-only (`_flood.py` = "Dubai P1a", sites `dubai-creek` / `dubai-south`) and unmerged.
- **Terrain cannot rank these wards for flood risk.** SRTM-derived, 1.5-2.1 m RMSE against only
  4.9-7.7 m relief; ward medians 10.6 / 10.3 / 11.6 m sit INSIDE the instrument error. A water
  hazard must come from observation (Sentinel-1 inundation), not elevation.
- **FAR's largest uncertainty is one assumed constant**: floors = round(height / 3.2 m), and 465 of
  Ballygunge's 3,527 buildings (13.2 %) have no measured height and are filled at 2.5 m. NOTE: `compute-far.py`s docstring says "4.0 %" for the same ward — the docstring is stale; `far.json` counts 465 of 3,527.

## 5. On the colleague's proposals

- **AR5 vs AR6 is not the real gap.** Both define risk as hazard/exposure/vulnerability interacting.
  What is substantive: DC-URS ADDS where both make risk conjunctive, and places adaptive capacity at
  the TOP LEVEL as a peer of hazard when the framework puts it INSIDE vulnerability. Our own
  `docs/dc-urs-engineering-review.md` caught the additive problem in July and it was deferred to v2.
  She is independently confirming an internal finding.
- **CEEW Navsari is a FLOOD RISK plan**: Risk = Hazard x Exposure x Vulnerability, min-max
  normalisation, AHP weights, five risk classes, 55 years of daily rainfall, real ward polygons.
  Caution: min-max is what spec section 4 rejected, correctly, for n=3 — CEEW can afford it with
  many wards.
- **Water is genuinely absent.** Zero water terms in the engine, confirmed by grep.

## 6. Decisions taken in the brainstorm (design not yet written)

1. Fix the inputs before restructuring the framework.
2. Report BOTH a typical and a hot-season (extreme) basis rather than one headline number.
3. Replace UHI_delta with a within-city ward anomaly, and re-run ECOSTRESS with per-ward windows
   so night discriminates too.

## 7. RESUME HERE

The anchor recalibration is unresolved. Four research agents were dispatched and **stopped early
(credits)** — their findings are NOT in hand and must be re-run:

1. Indian urban heat-vulnerability indices — normalisation and published thresholds
2. CEEW methodology detail (Navsari flood plan + the district CVI)
3. OECD/JRC composite-indicator standard; IPCC AR5 vs AR6; whether IPCC actually publishes an
   equation; compensability; min-max disadvantages; the multiplicative zero problem
4. Published Kolkata SUHII / LST / ward density / FAR values, to test our measurements against
   the literature

Note: `ceew.in` PDFs sit behind a Cloudflare 403 to curl; WebFetch on the publication page worked.
The Navsari PDF also exceeds WebFetch's 10 MB limit.

Open question already flagged separately: the density anchor is the highest-leverage constant in
the index (62 % of all discriminating power) and it is currently saturating.
