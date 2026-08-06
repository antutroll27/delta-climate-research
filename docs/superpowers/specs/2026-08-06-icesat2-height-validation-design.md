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
| Discovery | CMR granule search | Proven: 107 granules intersect the ward boxes (ATL03 per ward: 37/38/32); 4 tracks within 500 m of Ballygunge centre, closest **79 m** (2022-05-10, `ATL03_20220510191458_07441501_007_01.h5`, 168 MB) |
| Access | HTTPS ranged/full GET with bearer token | Proven: HTTP 206 from NSIDC on 2026-08-06 |
| Product | **ATL03** (per-photon lat/lon, ellipsoidal height, `signal_conf_ph`) | The only product used. ATL08's 100 m forest-tuned segments are noted as a possible classifier prior but are NOT in scope |

**New dependency: `h5py` only** (verified not installed 2026-08-06; neither is pyproj —
see §5 for why we don't need it). One boring, ubiquitous package.

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
- **Known-answer check, unbypassable:** the mode of ground-photon orthometric heights
  must land within ±3 m of the DEM's elevation along the track, AND the same quantity
  computed *without* the geoid constant must miss by 40–60 m. A test that also fails on
  the un-converted data cannot pass by accident.

### 5.2 Ground/roof separation — our classifier, kept simple and inspectable

1. **Ground surface:** along-track rolling lower-quantile (p10 in ~30 m windows) of
   confident photons = the local ground line. Kolkata relief is gentle (measured in the
   terrain work), which is what makes this robust.
2. **Height above ground** per photon = orthometric height − interpolated ground line.
3. **Roof photons:** photons whose lat/lon falls inside a building footprint **eroded by
   5 m** (the geolocation error), with height-above-ground in [2 m, 120 m]. Erosion
   discards small buildings entirely — recorded as a selection effect in the artefact
   (§5.4), not hidden.
4. **Per-building height estimate for crossed buildings:** the p75 of its roof photons
   (roof photons include edge scatter downward; an upper quantile resists it). Used ONLY
   to build the transect distribution, never published per building.

Confounders recorded in the script header: street trees (mitigated by footprint erosion
— trees overhang streets, not roof centres), monsoon cloud (granules with < 100 confident
photons in the box are rejected), daytime solar background (night granules preferred,
day accepted with the confidence filter).

### 5.3 The distributional comparison — pre-registered before running

For each track: the set of buildings crossed (footprint intersects the eroded beam
corridor) yields two paired distributions — ICESat-2 transect heights (§5.2.4) and our
artefact heights for the same crossed buildings. Compare:

- median / p65 / p90 differences with bootstrap 95 % CIs (p65 is the statistic
  `compute-heights.py` ships)
- a two-sample KS test as the omnibus check

**Verdicts, fixed now so the data can't tempt us:**

| Outcome | Condition |
|---|---|
| `validated` | \|median bias\| < 3.2 m (one storey, the same bracket `score-heights.py` uses) and the CI excludes ±2 storeys |
| `biased` | CI excludes zero and \|median bias\| ≥ 3.2 m — direction and size published |
| `inconclusive` | n ≥ 30 but the CI is too wide to exclude ±2 storeys AND does not exclude zero — enough buildings, not enough signal. Published as such |
| `underpowered` | < 30 crossed buildings pooled across tracks — the honest `score-heights.py` outcome, again |

**Fill cohort (win 2):** the same comparison restricted to crossed buildings whose
artefact height is exactly the 2.5 m fill. Its ICESat-2 median, minus 2.5 m, is the
measured understatement. Its own n will be small; it gets its own underpowered threshold
(n ≥ 10) and its own CI.

**FAR propagation (win 3):** `compute-far.py --icesat2-correction` substitutes the
measured fill-cohort distribution for the 2.5 m constant (cohort-level resampling, not
per-building edits) and reports ΔFAR per ward across the existing 2.9/3.1/3.3 m storey
bracket. Published either way — "FAR insensitive to the fill" is a publishable sentence.

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
