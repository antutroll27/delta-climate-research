# Replacing DC-URS with an AR5 ward risk score

**Status:** design, awaiting founder review. 2026-09-08.
**Origin:** the co-founder's policy-background colleague reported the resilience score is
inaccurate, and proposed a composite ward score on the IPCC AR5 framework with a water dimension,
citing CEEW's Navsari City Action Plan for Flood Risk Management (2025).
**Companion:** `docs/dc-urs-diagnosis.md` carries the measured diagnosis and its reproduction.

---

## 1. What is actually wrong

The colleague is right that the score is broken. She is wrong about why, and that matters because
her proposed fix does not touch the defect.

**DC-URS is a population-density map.** Measured by running the shipped engine over the shipped
inputs: `popDensity` supplies **10.22 of 16.54 points (62 %)** of all ward discrimination, and the
score ranks the three wards in perfect inverse density order. The entire thermal pillar --
`lstDayC`, `lstNightC`, `ruralBaseC`, 25 % of the weight -- contributes **exactly 0.00**, because
all three are bbox-wide over a box containing all three wards.

**The framework is not the defect.** The AR5 restructure was built and run against today's inputs.
Both the strict product and the geometric mean reproduce the density ranking exactly:

| ward | density | H | E | V | Risk (product) | Risk (geo) |
|---|---|---|---|---|---|---|
| barrackpore | 8,772 | 0.258 | 0.249 | 0.445 | 0.0287 | 0.3061 |
| baruipur | 36,728 | 0.258 | 0.628 | 0.470 | 0.0762 | 0.4239 |
| ballygunge | 68,810 | 0.258 | 0.693 | 0.489 | 0.0875 | 0.4440 |

Hazard is identical in every ward, so it multiplies out as a constant. **Restructuring alone would
change the number and not the answer.** Inputs first, framework second.

## 2. Scope

Founder decision, 2026-09-08: heat and water, three wards. Revised the same day on measured
evidence -- **the water hazard is descoped**; see section 5.

## 3. The heat score

**Structure.** IPCC AR5: `Risk = f(Hazard, Exposure, Vulnerability)`,
`Vulnerability = f(Sensitivity, Adaptive Capacity)`. This corrects two departures in DC-URS:
adaptive capacity currently sits at the top level as a peer of hazard when the framework puts it
inside vulnerability, and exposure is currently blended with sensitivity in one pillar.

**Aggregation is conjunctive.** A near-zero pillar must drag the score down rather than be bought
off by a strong one. `docs/dc-urs-engineering-review.md` delta 1 caught this in July 2026 and it
was deferred to v2; the colleague is independently confirming an internal finding. Guard each
pillar to `[0.001, 1.0]` before exponentiation, as that review specified.

**Three input fixes, in dependency order. All three have their data already on disk.**

**3.1 Per-ward temperature.** `data/calibration/landsat-ward-lst.json` holds 213 ward-scenes over
50 overpasses, QA-masked, per ward. Compared within the same overpass:

| comparison | median delta | consistency |
|---|---|---|
| Ballygunge - Baruipur | **+1.46 K** | Ballygunge hotter in **72/73 (99 %)** |
| Ballygunge - Barrackpore | +0.57 K | 34/43 (79 %) |
| Baruipur - Barrackpore | -0.82 K | Baruipur hotter in 8/34 (24 %) |

Dense core hottest, then industrial corridor, then green fringe. Face validity holds.

**PAIRING IS MANDATORY.** Hot season (Mar-Jun), UNPAIRED medians rank Baruipur hottest (38.22) and
Ballygunge second (37.58). PAIRED within overpass, Ballygunge is hotter in **15 of 15 scenes
(100 %)**. Same data, opposite ranking. Every per-ward thermal input must be built as a paired
anomaly or the bug returns in a new place.

**3.2 The UHI sign.** `scripts/build-dcurs-inputs.py` computes `median(urban) - median(rural)`.
The median is not a linear operator: the median urban scene and the median rural scene are
different days, so the sign flips and the term clamps to zero in all three wards. Measured:
difference-of-medians `-0.35 K`; median-of-per-scene-differences `+0.40 K`. The correct value is
already in `data/calibration/ecostress-suhii.csv` as the unused `suhii_strict` column: **+0.40 K
day (positive in 12/15), +0.33 K night (16/21)**, near-nadir `view_delta <= 0.75`.

**3.3 UHI_delta is DROPPED, not replaced. (Found in spec self-review.)**

The first draft of this design replaced city-vs-rural UHI with a within-city ward anomaly. That is
wrong, and it is wrong in a way this project has already been caught by once. With per-ward
absolute LST from 3.1, a ward-minus-city-mean anomaly is an **affine transform of the same
variable** -- `THI` would spend 0.20 of its weight re-counting `LST_day`. This is exactly the
NDVI/FVC defect `dc-urs-engineering-review.md` delta 2 found, where 0.80 of the greenness weight
rested on one input counted twice.

So: once 3.1 lands, per-ward day and night LST carry the discrimination on their own, and the third
term is dropped. Its 0.20 weight redistributes to day and night, giving `THI = 0.50*LST_day +
0.50*LST_night` -- to be confirmed against the sensitivity table in section 8 rather than assumed.

The city-vs-rural SUHII is still computed and still **displayed**, because it is a real and
citable property of the city (+0.40 K day, +0.33 K night, section 3.2). It is context for the
reader, not a weighted term in a ward index it cannot discriminate.

**Why city-vs-rural can never discriminate wards:** it is one number, identical for every ward by
construction. The weak tropical daytime SUHI is REAL -- the dry rural surround is nearly as hot as
the city -- not a bug. The within-city contrast is 4x larger and 99-100 % consistent, and after 3.1
it is already inside `LST_day`.

**3.4 The density anchor. OPEN -- the one unresolved input.** `x / 25000` saturates: Ballygunge
(68,810) and Baruipur (36,728) both clamp at 1.0, so the index cannot separate values differing by
nearly 2x. This is the highest-leverage constant in the score and it must not be set by taste.
Blocked on research listed in section 7.

**Normalisation stays on fixed anchors, not min-max.** CEEW uses min-max, correctly for their many
wards. At n=3 it is disqualifying: the best ward always scores 1.0, the worst 0.0, and adding a
fourth silently rescores every existing ward. This is a deliberate divergence from the reference
methodology, not an oversight.

## 4. What the heat score does NOT become

- **One blended multi-hazard number.** Rejected while water was still in scope, and recorded here
  because it binds if water ever returns: heat and flood need different interventions, and blending
  hazards is where composite indices stop being defensible. CEEW's Navsari plan is a single-hazard
  flood plan for the same reason. Keeping the scores separate also resolved the water duality for
  free -- water is adaptive capacity against heat (a refuge, as `compute-tra.py` already treats
  WorldCover classes 80/90/95) and hazard against flood. The same pixel, honestly both.
- **Validated by rank correlation.** Impossible at n=3; `dc-urs-spec.md` section 7 already says so.
  Published Kolkata ward vulnerability maps exist and become a validation route only if the ward
  set widens.

## 5. The water hazard: descoped, with evidence

Nine routes to an observed urban flood signal were tested. **Two survive, and both are land-cover
fractions that describe surface rather than water behaviour.**

| route | result |
|---|---|
| Sentinel-1 backscatter | INVERTED. Floodwater against building facades double-bounces and returns brighter than dry ground, so flooded dense urban classifies as dry. Would have ranked Ballygunge -- densest and most waterlogging-prone -- as safest |
| Sentinel-2 MNDWI, monsoon | NO SIGNAL. Ballygunge, peak monsoon best scene per year: only **3 of 8 years** clear the ward at all (2019 99.1 %, 2021 87.2 %, 2023 97.0 %; the other five under 2 %). Water fraction 0.14 / 0.83 / 1.66 % against a dry-season 0.16 / 0.87 / 0.62 % -- the ranges OVERLAP and 2019 monsoon reads lower than 2024 dry |
| JRC Global Surface Water | BLIND. 0 / 3 / 20 water cells of ~2,700 per ward. Landsat-30 m misses Kolkata's small urban tanks; WorldCover at 10 m sees 8 % water where GSW sees none |
| Deltares Global Flood Maps | WRONG HAZARD. Coastal surge only, forced by sea level, explicitly excluding rainfall and river discharge. Kolkata floods pluvially, 60 km inland |
| OSM drainage density | ABSENT. 0 / 0 / 1 drainage ways across the three wards. A control query for `natural=water` returned exactly the known-good 7 polygons, so the mechanism is sound and the zero is real |
| SoilGrids infiltration | MASKED. Null in all three wards; a rural point 25 km away returns 75 g/kg sand. SoilGrids does not map built-up land |
| Terrain / low-lying | INSTRUMENT ERROR EXCEEDS SIGNAL. 1.5-2.1 m per-cell RMSE against 4.9-7.7 m relief; ward medians 10.6 / 10.3 / 11.6 m sit inside the error |
| Imperviousness (1-FVC) | WORKS, held. And NOT a density restatement -- Barrackpore is least dense (8,772) yet most impervious (0.691). Spearman -0.50 vs density, indicative at n=3 |
| WorldCover water fraction | WORKS, held |

**The structural reason, which no better dataset fixes:** urban flooding lasts hours to days, a
sun-synchronous satellite passes at ~10:30 every five days, and it must be cloud-free at that
moment. Catching an active flood is a coincidence, not a measurement.

**Decision.** Ship no flood term rather than a proxy. Two land-cover fractions presented as a flood
model would not survive a methods review, and this project's credibility rests on refusing exactly
that. The dead-end table is published as evidence, in the pattern
`scripts/build-city-indicators.py` already uses for the ISO 37123 indicators it declines to claim.

**Still open, not an engineering dependency:** municipal waterlogging-duration records, which is
what published Kolkata ward studies actually use. Availability unknown, and KMC coverage would
reach Ballygunge (Ward 68) but not Baruipur or Barrackpore, which sit under different municipal
bodies -- the same cross-body problem `dc-urs-spec.md` section 1 hit with census data.

## 6. Honesty requirements on the tool

- **The score is renamed.** "Resilience Score" is a claim about resilience; what is computed is
  ward heat risk from nine indicators. `HeatMapStage.astro:218` currently claims "IPCC AR6 framing"
  for an additive formula that is not AR6-shaped, and that line must change with the engine.
- **Density dominance is displayed, not hidden.** Exposure is population, and heat mortality really
  does concentrate where people are, so a density-led ranking may be correct. The defect today is
  that density is the ONLY thing that moves the number. Post-fix, the tool shows its own
  composition so a reader can see what drove the score.
- **The golden cases are refrozen.** The current fixture pins wards that do not exist: Baruipur's
  assumed density was 4,500 against a measured 36,728 (8.2x), Ballygunge's distance-to-refuge 800 m
  against 77.8 m (10x). Any new fixture must be built from measured inputs.
- **Water absence is stated on the tool**, not only in docs. A heat-only score must say it is
  heat-only.

## 7. Blocked on research

The density anchor (section 3.4) carries 62 % of the score and cannot be set by taste. Required:

1. Published Kolkata ward population-density distribution, to place the anchor above the real range
   rather than inside it.
2. Indian urban heat-vulnerability indices -- normalisation choices and published thresholds.
3. OECD/JRC Handbook on Composite Indicators -- compensability, and the multiplicative zero problem.
4. Published Kolkata SUHII and ward FAR values, to test our measurements against the literature.

Four agents were dispatched for this on 2026-09-06 and stopped early for credits; nothing was
retained. `ceew.in` PDFs sit behind a Cloudflare 403 to curl, though WebFetch on the publication
page works, and the Navsari PDF exceeds WebFetch's 10 MB limit.

## 8. Phasing

The density anchor is research-blocked; everything else is not. A plan must not couple them.

| phase | work | blocked? |
|---|---|---|
| 1 | Per-ward LST (3.1) with the paired-anomaly test, UHI sign fix (3.2), drop UHI_delta (3.3) | **no** -- data on disk |
| 2 | AR5 restructure, conjunctive aggregation, rename, honesty surfaces (6) | **no** |
| 3 | Density anchor recalibration (3.4) | **yes** -- section 7 |
| 4 | Refreeze golden cases, sensitivity table, acceptance bar | after 3 |

Phase 1 alone converts a thermal pillar contributing 0.00 into one that discriminates at 99 %
consistency, and it is the largest single improvement available. It should not wait on phase 3.

## 9. Testing

- **The paired-anomaly property is pinned by test.** Assert that the hot-season ward ranking from
  the shipped builder matches the paired ranking (Ballygunge > Baruipur), so an unpaired
  aggregation cannot be reintroduced silently. This test fails today.
- **The UHI term is positive in every ward**, asserted against `suhii_strict`.
- **The thermal pillar discriminates**: assert the three wards' THI values are distinct. This test
  fails today and is the single clearest statement of the current defect.
- **Conjunctive aggregation is monotone in each pillar**, and no pillar can be bought off: pin the
  worked case from the engineering review where a ward at THI 0.85 / ACI 0.90 must NOT outscore one
  at THI 0.30 / ACI 0.35.
- **Sensitivity table**, as `dc-urs-spec.md` section 7 check 3 specified and nobody ran. Report the
  score swing per indicator over its observed range. The acceptance bar is that no single indicator
  exceeds ~40 % of total discrimination; today density is at 62 %.
- **Golden cases rebuilt from measured inputs**, replacing the fictional fixture.
- **The dead-end table is regression-tested where cheap** -- the OSM drainage count and the
  SoilGrids null are single queries, and if either changes we should know.
