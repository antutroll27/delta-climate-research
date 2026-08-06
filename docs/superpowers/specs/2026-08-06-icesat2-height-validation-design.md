# ICESat-2 Building-Height Validation — Design

**Date:** 2026-08-06
**Status:** Approved bar, spec for review
**Depends on:** `data/geometry/*-footprints.json` (heights: Google Open Buildings 2.5D via
`compute-heights.py`), `public/heat-map/data/*.json`, Earthdata token at
`~/.config/delta-climate/earthdata-token` (0600, gitignored — auth proven with an HTTP 206
ranged GET on 2026-08-06, no new keys needed).

---

## 1 · Goal, and the agreed bar

Validate the shipped building heights **in distribution, not per building**, against
ICESat-2 ATL03 photon transects. The user has approved this exact claim shape:

> "our height distribution matches/misses ICESat-2's along the transects, quantified"

Per-building attribution is **forbidden by the instrument**: ATL03 horizontal geolocation
error (~3–5 m) is a meaningful fraction of a 10–20 m Kolkata building, so any single
photon may sit on the neighbour. A distributional comparison is immune to that: it never
asks *which* building a photon hit, only what the height population along the transect
looks like.

### The three wins (user: "The three wins are worth it mate")

1. **Power the height claim.** `score-heights.py` currently ends in "underpowered" at
   n=6 OSM pairs (MIN_PAIRS=8). Transect photons give ~50–150 roof-bearing buildings per
   good track — a properly powered test of a statistic we already ship.
2. **Audit the 2.5 m fill.** Google Open Buildings writes 2.5 m where it has no confident
   height — simultaneously the minimum and modal height in all three wards. Measured
   against the CURRENT shipped artefacts (2026-08-06, post-2.5D-replacement): Ballygunge
   465/3,527 (13.2 %), Barrackpore 597/4,702 (12.7 %), Baruipur 629/4,538 (13.9 %). The
   4.0/6.5/10.8 % figures quoted in earlier notes predate the height replacement and are
   stale. Compare the fill cohort's ICESat-2 distribution against 2.5 m and quantify the
   understatement, if any.
3. **Propagate to FAR.** FAR carries 0.30 of the DC-URS exposure pillar
   (`compute-far.py`). Recompute FAR under the measured fill-cohort correction and
   report the shift — even if the shift is negligible, that negative result is worth
   publishing.

**A fourth win, free along the same transects:** ATL03 ground photons are
decimetre-class terrain measurements; our relief comes from a ~30 m DEM
(`fetch-terrain.py`). Comparing ground-photon elevations to the DEM along the track is a
terrain validation we have never had, at zero extra data cost.

## 2 · Non-goals (write them down so nobody re-litigates)

- **Not an accuracy upgrade for the heat field.** `heat-map-model.ts` has no
  building-height term — `built` is an area fraction. Heights cannot move `r`, the
  ±3.0 K band, or the amplitude ratio. This workstream validates the *height/FAR* claim,
  a different claim from the within-ward pattern (which today's measurements showed is
  unfixable from a desk).
- **No per-building height replacement.** Replacement requires per-building attribution,
  which §1 rules out. If the fill audit shows material distortion, the correction is
  *distributional* (a cohort-level adjustment in FAR), not per-building edits to the
  geometry artefacts.
- **No SlideRule dependency.** The public cluster is live (probed v5.5.0, 2026-08-06),
  but its raw HTTP endpoints speak a binary record protocol, so using it means the full
  `sliderule` client + geopandas chain + a live-service dependency on reruns + outsourcing
  photon classification — and the classification *is* the science here. Deferred as an
  optional independent cross-check of our classifier, only if wanted later.
- **No icepyx / NSIDC server-side subsetting.** A 200 KB cached subset in the repo does
  the same job with no service dependency.

## 3 · Data and access

| Layer | What | Status |
|---|---|---|
| Discovery | CMR granule search + per-beam geometry via ranged reads | See the coverage note below — the granule counts are real, the original "79 m" was not |
| Access | HTTPS ranged/full GET with bearer token | Proven: HTTP 206 from NSIDC on 2026-08-06 |
| Product | **ATL03** (per-photon lat/lon, ellipsoidal height, `signal_conf_ph`) | The only product used. ATL08's 100 m forest-tuned segments are noted as a possible classifier prior but are NOT in scope |

### Coverage — measured, and it is finite

This spec first said "4 tracks within 500 m of Ballygunge, closest 79 m". That was wrong,
and the error matters enough to record. The distance came from each granule's CMR bounding
**polygon**, which spans the whole six-beam swath; the beams themselves are elsewhere.
The named granule's nearest strong beam is **6.27 km** from Ballygunge and returns zero
photons in the box.

Two structural facts define the real ceiling:

1. **118 granules over the three wards are only 3 distinct reference ground tracks**
   (0416, 0744, 0858). ICESat-2 repeats its ground tracks on a 91-day cycle, so extra
   granules are repeat passes of the same reference line. (They are NOT the same *ground*
   line — see the 2026-08-07 correction below; the beams wander hundreds of metres
   across-track between cycles, which is what made n ≥ 30 reachable.)
2. **Measured per-beam closest approach** (2026-08-06, via `fsspec`+`h5py` HTTP range reads
   of the `geolocation/` arrays only — a few MB per 168 MB granule). Empty segments must be
   dropped first: they carry placeholder coordinates on a shared line ~11 km away, which is
   what corrupts a naive distance.

| ward | track | crossing beams | closest approach | photons in 900 m, one pass |
|---|---|---|---|---|
| ballygunge | 0416 | gt2r / gt2l | 208 m / 291 m | 1,911 / 718 |
| barrackpore | 0744 | gt1l / gt1r | 650 m / 570 m | 5,548 / 3,607 |
| baruipur | 0744 | gt2l | 658 m | 3,247 |

Reproducible: `python3 scripts/icesat2-coverage.py` → `data/calibration/icesat2-coverage.json`.

Every ward is crossed by a strong beam, so the work is viable. Note that **strong/weak is
not a property of a beam name** — it follows spacecraft orientation, which reverses
periodically, so gt2r is strong on some passes of a track and gt2l on others. Both members
of a crossing pair lie 90 m apart and both cross the ward, so each pass contributes a
crossing strong beam either way; the pipeline reads `atlas_beam_type` per granule rather
than assuming a mapping.

**CORRECTION 2026-08-07 — this spec's "capped by three beam lines" claim was WRONG.** It
said the crossed-building set could not be enlarged by more data, because repeat passes
stack photons on the same buildings without sampling new ones. The completed sweep refutes
it. Measured closest-approach across repeat passes of a *single* track:

| ward / track | passes | closest approach, min → max | spread |
|---|---|---|---|
| ballygunge / 0416 | 11 | 125.7 → 851.8 m | **726 m** |
| baruipur / 0744 | 9 | 199.7 → 658.5 m | 459 m |
| barrackpore / 0744 | 6 | 649.6 → 1004.9 m | 355 m |

A 726 m spread across a 1,400 m ward is not pointing jitter — the beams genuinely wander
across-track between cycles, partly because the yaw flip changes which beam of a pair, and
which pair (~3.3 km apart), is nearest. Ballygunge's 12 passes therefore crossed **50
distinct buildings** against the 4–13 a single fixed line predicts; passes landed 663 m and
846 m from Baruipur centre on RGT 0416, a track the coverage table places 5 km away; and
Barrackpore's richest pass was on 0416, not the 0744 the table names. **The n ≥ 30 bar was
reached because of this effect** — under the original claim it would have been unreachable.

**What this means:** `icesat2-coverage.json` describes ONE representative granule per
track, not that track's envelope across cycles. It is a guide to which tracks are worth
probing, never a ceiling on what they can sample, and it must not be read as one.

What does NOT change: `underpowered` remains a legitimate pre-registered outcome, and the
response to falling short is to publish it — never to relax the erosion, roof band, or
photon minimum to manufacture a sample.

**New dependency: `h5py` only** (verified not installed 2026-08-06; neither is pyproj —
see §5 for why we don't need it). One boring, ubiquitous package. `fsspec` (already
present) enables the ranged reads used for coverage discovery.

**Download / cache policy** (mirrors the ECOSTRESS cache pattern):
- Full granules download to the scratch area, are subset, then **deleted**. 168 MB files
  never enter the repo.
- Committed artefact per track: `data/calibration/icesat2/<ward>-<yyyymmdd>-<track>.json`
  (~200 KB): photons inside the ward box + 200 m pad, with per-photon lon, lat,
  orthometric height, ellipsoidal height, confidence, beam, and a header recording
  granule ID, beam strength, geoid constant used, and counts. Reruns of every analysis
  script need only these subsets — the pipeline is reproducible offline forever.
- Strong beams only (sun-angle-independent selection by `sc_orient`), and photons at
  `signal_conf_ph` ≥ medium for the land surface type.
- Token read from `~/.config/delta-climate/earthdata-token` via the existing
  `_ecostress.token()` helper. Never printed, never embedded, never referenced by repo
  path in committed code.

## 4 · Architecture

Three scripts + one artefact-consuming update, following the repo's
measure-script conventions (module docstring states the question; JSON artefact out;
honest negative outcomes are outcomes).

```
scripts/fetch-icesat2.py         CMR query → download → subset → data/calibration/icesat2/*.json
scripts/measure-height-accuracy.py   subsets + footprints → data/calibration/icesat2-heights.json
scripts/compute-far.py           gains a --icesat2-correction mode reading the artefact
src/scripts/climate-engine/accuracy.ts   gains a HEIGHTS block — values from the artefact, in a
                                         separate commit, only after measurement
```

`fetch-icesat2.py` is the only network script. The measure script is fully offline from
committed subsets, so the validation is re-runnable in CI without credentials.

## 5 · Method

### 5.1 Geoid conversion — the named trap

ATL03 heights are **ellipsoidal (WGS84)**; our DEM and every "height above ground"
intuition is orthometric. The geoid undulation near Kolkata is roughly −50 m — skipping
this conversion shifts every photon by ~50 m, the exact geoid-offset failure mode from
the co-founder's email about the basemap work.

- **Approach:** one EGM2008 undulation constant per ward, hardcoded with provenance (an
  authoritative calculator, cited in the constant's comment). The geoid varies by
  millimetres across a 1.4 km ward; a grid library (pyproj + EGM2008 grid download) is a
  dependency buying nothing.
- **Known-answer check, unbypassable — two direct tests, no terrain involved:**

  **G1a · the constant is right.** ATL03 carries its own EGM2008 undulation in
  `geophys_corr/geoid`. Our `GEOID_N_M[ward]` must match the granule's own value over the
  ward to **≤0.5 m**. This is exact, independent of any elevation model, and tests the
  constant directly rather than through a proxy. Measured 2026-08-06: ATL03 reads
  **−56.947** over Ballygunge against our hardcoded **−56.95**, and GeographicLib returns
  −56.9503 — agreement to 1 cm.

  **G1b · the conversion was actually applied.** The ground-line median must fall inside
  **[−2 m, +25 m]** orthometric, the plausible band for deltaic Kolkata. A skipped
  conversion lands near −52 m; a sign error near +61 m; a ground line that has climbed
  onto rooftops exceeds +25 m. All three are caught by a wide margin.

  **Why the ward DEM is NOT the reference, though this spec first made it one.** The
  original gate required the ground line within ±5 m of `<ward>-terrain.json`'s median.
  It failed on **15 of 15** usable passes, always in the same direction: photon ground at
  2.96–6.33 m against DEM medians of 10.3–11.6 m, repeatable to ≤1.5 m across six years
  of independent overpasses and all three wards. That is a systematic offset, not noise —
  and the artefact itself says why, in its own `note` field:

  > "smoothed **surface** model, indicative broad-scale form — **NOT surveyed ground**"

  It is a DSM. Over the dense Ganges delta an SRTM-derived surface sits metres above true
  ground on vegetation and rooftops, so requiring photon *ground* to match it at ±5 m was
  asking a surface model to be a ground model. No tolerance makes that comparison
  meaningful, which is why the fix is a different test rather than a wider one. (ATL03's
  in-file `dem_h` agrees with our DEM at 9.72 m, but it is GMTED2010 — also SRTM-derived,
  so it corroborates the DSM family, not the ground.)

  **The 6 m offset is not discarded — it is the fourth win, arriving early and inverted.**
  §1 anticipated ICESat-2 ground photons as a free terrain validation. They delivered one:
  the shipped relief surface sits **~5–7 m above** decimetre-class laser ground across all
  three wards. That is recorded as a measurement in the artefact, not swept up as gate
  noise. It changes nothing in the heat model (`terrain.json` is explicitly "NOT used by
  the simulation") and nothing in the height comparison (§5.2's ground line comes from the
  photons themselves, never from the DEM) — but it is a real, publishable finding about
  a shipped artefact's provenance.

### 5.2 Ground/roof separation — our classifier, kept simple and inspectable

1. **Ground surface — two passes, because one is biased.** Pass 1 is an along-track
   rolling lower quantile (p10 in ~30 m windows) over ground candidates. Pass 2 replaces
   each window with the **median** of its candidates within ±1.5 m of the pass-1 line,
   repeated until the line stops moving.

   Pass 2 is not polish; without it the result is systematically wrong. A p10 line sits
   ≈1.28× the local photon spread BELOW true ground, so every height-above-ground is
   inflated by that amount — measured at −1.19 m for a 1 m ground spread. That is not
   noise: it does not average out, and the bootstrap CI cannot see it because the
   bootstrap resamples *buildings*, not photons. It is also density-correlated (E[p10]
   depends on window population), which would put a systematic gradient between dense and
   open stretches — across the very comparison being made. Pass 2's median of a symmetric
   residual is unbiased; the ±1.5 m gate is what keeps trees, which motivated the low
   quantile, out of that median.

   Measured on the shipped implementation: −0.03 m on clean ground at σ=1 m, +0.12 m with
   15 % low vegetation, +0.29 m at 30 %. The residual error is **positive**, i.e. the line
   sits slightly high and heights come out slightly *short* — the conservative direction
   for a validation claim, unlike the p10 line's −1.19 m, which flattered it.

   Kolkata relief is gentle (measured in the terrain work), which is what makes the
   windowing viable at all.

   Windows with no candidates leave the line undefined, and the ground line returns NaN
   outside its populated range rather than extrapolating flat: a track entering the box
   over a large block would otherwise measure those buildings against a clamped constant
   (measured +0.97 m error). Those photons are dropped and **counted**, per §5.4.
2. **Height above ground** per photon = orthometric height − interpolated ground line.
3. **Roof photons:** photons whose lat/lon falls inside a building footprint **eroded by
   5 m** (the geolocation error), with height-above-ground in [2 m, 120 m]. Erosion
   discards small buildings entirely — recorded as a selection effect in the artefact
   (§5.4), not hidden.
4. **Per-building height estimate for crossed buildings:** the p75 of its roof photons
   (roof photons include edge scatter downward; an upper quantile resists it), over a
   minimum of **5** photons. Used ONLY to build the transect distribution, never published
   per building.

   5, not 3, and not a round number: at n=5 numpy's p75 index is exactly 3.0 — the
   second-highest photon, zero weight on the maximum, which is what "resists edge scatter
   without chasing the single highest photon" actually requires. At n=3 the index is 1.5,
   putting **half** the estimator's weight on the single highest photon, so the claim
   would have been false at the module's own threshold. The estimator is also
   sample-size-dependent (E[p75] shifts 0.23σ between n=3 and n=60), so admitting
   3-photon buildings would have biased them low relative to well-sampled ones inside the
   same pooled distribution.

Confounders recorded in the script header: street trees (mitigated by footprint erosion
— trees overhang streets, not roof centres), monsoon cloud (granules with < 100 confident
photons in the box are rejected), daytime solar background (night granules preferred,
day accepted with the confidence filter).

### 5.3 The distributional comparison — pre-registered before running

For each track: the set of buildings crossed (footprint intersects the eroded beam
corridor) yields two paired distributions — ICESat-2 transect heights (§5.2.4) and our
artefact heights for the same crossed buildings. Compare:

- median / p65 / p90 differences, **each with its own** bootstrap 95 % CI (p65 is the
  statistic `compute-heights.py` ships, so it needs a CI of its own — a single unlabelled
  CI beside three biases invites quoting a median interval against a p65 number)
- a **paired permutation test** as the omnibus check: the KS statistic between the two
  arrays, with its p-value from 10,000 draws that randomise each pair's assignment.

  **Not scipy's two-sample KS test**, which this spec originally named. That test assumes
  the two samples are independent; ours are paired per building and strongly correlated,
  which drags both ECDFs together and collapses the statistic. Measured under H₀ at n=60:
  a nominal 5 % test rejected **0 times in 2,000 draws**, and its power at a half-storey
  bias was 0.06. It would have returned a large, comfortable p-value almost regardless of
  the truth, and that would have been published as "the omnibus check found no
  significant difference" — a null hypothesis handing the model a free pass, which is
  precisely the failure this project has caught twice before.

**Verdicts, fixed now so the data can't tempt us:**

| Outcome | Condition |
|---|---|
| `validated` | \|median bias\| < 3.2 m (one storey, the same bracket `score-heights.py` uses) and the CI excludes ±2 storeys |
| `biased` | CI excludes zero and \|median bias\| ≥ 3.2 m — direction and size published |
| `inconclusive` | n ≥ 30 but the CI is too wide to exclude ±2 storeys AND does not exclude zero — enough buildings, not enough signal. Published as such |
| `underpowered` | < 30 crossed buildings pooled across tracks — the honest `score-heights.py` outcome, again |

**Fill cohort (win 2) — AMENDED 2026-08-07, because the original statistic could not
return zero.**

This spec first said: take crossed buildings whose artefact height is exactly the 2.5 m
fill, and report their ICESat-2 median minus 2.5 m as the understatement. **That statistic
is invalid, and it fails in the direction that flatters the finding.**

The roof band's 2.0 m floor (§5.2) discards photons below 2 m as street furniture and
misclassified ground. The fill cohort is, by definition, buildings Google could not
measure — disproportionately *short* ones. So a fill building that is genuinely short has
its low photons deleted before `MIN_ROOF_PH` is even applied: it is either dropped from
the cohort entirely, or its p75 is taken over only the surviving upper tail. Either way
**the cohort median cannot come out near 2.5 m**, and "understatement" is manufactured by
the floor rather than measured.

Measured on the one committed subset (2026-08-07), the defect is not theoretical:

| building | shipped | roof photons | below 2.0 m | p75 with floor | p75 without |
|---|---|---|---|---|---|
| 2272 | **2.50 (fill)** | 4 | **4** | **excluded** | excluded |
| 58 | 4.90 | 98 | 85 | 6.56 | **1.79** |
| 3407 | 9.30 | 35 | 18 | 8.49 | 5.09 |

The **only** 2.5 m fill building ever crossed has every photon below 2 m — ICESat-2's
evidence is that the fill is approximately right — and it is silently removed from the
statistic designed to test the fill. Overall, 215 of 1,640 in-footprint photons are
discarded by the floor, concentrated on short buildings.

**The amended test — a proportion, not a median.** The floor is not moved: 2 m is an
honest statement that this instrument cannot resolve buildings shorter than about 2 m,
and lowering it to rescue the cohort would be tuning a threshold to get an answer. Instead
the question changes to one the instrument *can* answer without discarding evidence:

> Of the crossed fill buildings, what fraction show roof evidence **above 2.5 m**?

Every crossed fill building contributes, including those whose photons all sit low — they
count as evidence *for* the fill. A high fraction means the fill understates and by how
much is then quotable; a low fraction means the fill is broadly right. `n ≥ 10` crossed
fill buildings remains the bar, and the count of fill buildings excluded by the floor is
reported alongside, per §5.4.

**Why amending after seeing data is legitimate here:** the change is forced by a
structural defect that makes the original statistic uninterpretable, not by a disliked
result — and the fill cohort currently holds **n = 0**, so there is no number to steer
toward. Recorded rather than quietly substituted.

**Consequence for win 3.** `compute-far.py --icesat2-correction` must not resample from a
cohort whose distribution the floor has inflated. Until the amended test runs with n ≥ 10,
FAR sensitivity stays `no_correction_computable`.

**Main-cohort caveat from the same cause.** The floor inflates short buildings on both
sides of the main comparison too, pushing the median bias positive ("our heights
understate"). It is conservative for reaching `validated`, but under a `biased` verdict
the published *magnitude* would be overstated. The below-floor photon count is therefore
reported beside the bias so the two are read together.

**FAR propagation (win 3):** `compute-far.py --icesat2-correction` substitutes the
measured fill-cohort distribution for the 2.5 m constant (cohort-level resampling, not
per-building edits) and reports ΔFAR per ward across the existing 2.9/3.1/3.3 m storey
bracket. Published either way — "FAR insensitive to the fill" is a publishable sentence.

### 5.3a How large the selection effect actually is — measured

The 5 m erosion is not a minor filter. Measured against the committed footprints
(2026-08-07), buildings whose eroded polygon survives at all:

| ward | buildings | survive 5 m erosion | share | crossed by one beam line |
|---|---|---|---|---|
| ballygunge | 3,527 | 995 | **28.2 %** | 4–13 |
| barrackpore | 4,702 | 719 | **15.3 %** | 3–12 |
| baruipur | 4,538 | 326 | **7.2 %** | 0–8, usually 0–3 |

So the population this method can see is **the largest 7–28 % of each ward**, before a
beam is even considered — and in Baruipur it is the largest one building in fourteen.
The published wording must therefore carry two qualifiers, not one: heights are validated
in distribution **along satellite transects**, and **among buildings large enough to
survive a 5 m erosion**. A reader who takes "validated" to mean "our heights are right"
would be wrong in a way this table makes concrete.

The erosion cannot simply be relaxed to widen the sample: 5 m is the ATL03 geolocation
error, and shrinking it admits photons that may belong to the neighbouring building —
trading a disclosed selection effect for an undisclosed attribution error, which is the
worse of the two.

**Consequence for the n ≥ 30 bar.** A single beam line yields roughly 5–13 buildings, and
the distinct-line count per ward is small. Pooling all three wards plausibly lands near
the bar rather than comfortably past it, so `underpowered` remains a live outcome and
Baruipur should not be expected to contribute materially.

### 5.4 Honesty rules carried over from the rest of the project

- The artefact records what was **excluded** and why: buildings too small to survive
  erosion, rejected granules, photon counts per stage. Silent truncation reads as
  coverage.
- The selection effect is disclosed in the artefact note: transects sample buildings
  large enough to survive 5 m erosion, so the validated distribution is of *larger*
  buildings; the on-page wording must say "along satellite transects", not "all
  buildings".
- `accuracy.ts` HEIGHTS block ships with a guard test pinning the verdict wording to the
  artefact, the same pattern as the SPATIAL guards.
- No number reaches `accuracy.ts` or the site before the measurement exists.

## 6 · Staging — prove one transect first

**Task 0 (gate for everything else):** the single closest track
(`ATL03_20220510191458_07441501_007_01.h5`, 79 m from Ballygunge centre). Subset it, run
the geoid known-answer check, and produce one diagnostic plot artefact
(height-above-ground vs along-track distance, photons coloured by in/out-of-footprint).
**Gate:** ground and roof populations visibly and statistically separable (ground mode
within ±3 m of DEM; roof photons over footprints with height p50 > 4 m).

If the gate fails — monsoon noise, unusable daytime background, roofs not separable —
the workstream **stops and publishes the negative result** as
`data/calibration/icesat2-heights.json` with verdict `not_separable`. That is an outcome,
per the project's standing rule.

**Then:** sweep the remaining Ballygunge tracks within 500 m, then Barrackpore and
Baruipur's best tracks, pooling crossed buildings until the n ≥ 30 bar is met or the
granule list is exhausted.

## 7 · Testing

- **Unit (node-free, pure Python):** ground-line extraction on a synthetic transect
  (known ramp + two synthetic "roofs"); geoid check must fail on unconverted heights;
  erosion drops a building smaller than 10 m as designed.
- **Guard tests (existing `tests/unit` pattern):** `accuracy.ts` HEIGHTS values match
  the committed artefact; verdict string matches the artefact's verdict.
- **Known-answer:** §5.1's two-sided geoid check inside `fetch-icesat2.py` itself —
  a subset that fails it is not written.
- `npm run verify` unaffected until the `accuracy.ts` commit, which includes its guards.

## 8 · Out of scope, explicitly

SlideRule/YAPC cross-check of our classifier (optional later) · ATL08 priors · ATL13
pond levels · per-building height edits · any change to the heat physics or the
within-ward pattern claims · UAV/360-drive ground truth (separately deferred).
