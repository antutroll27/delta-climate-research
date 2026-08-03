# Regenerable building geometry — Overture footprints, Earth Engine heights

**Date:** 2026-08-04
**Status:** approved direction; implementation gated behind a delta review the user takes in person
**Origin:** the first-ever validation of the shipped geometry (2026-08-04, recorded in
[`../../heat-map-feature.md`](../../heat-map-feature.md) §Validation status) found we
render 2,048 of Ballygunge's ~3,530 buildings, and that the height pipeline that
produced the shipped artefacts **does not exist in this repository** — the ward JSONs
are baked artefacts nobody can regenerate. This spec fixes both.

## 1 · Evidence this design stands on

All measured on this machine, 2026-08-04, scripts in `scripts/validate-*.py`:

- **Completeness.** Overture `2026-07-22.0` holds **3,530** buildings in the Ballygunge
  window against our **2,048** Microsoft footprints; **426 (12.1 %) sit >20 m from
  anything we hold**. Position agrees where both see a building (97.2 % within 20 m,
  median offset 7.3 m — inflated by Overture splitting Microsoft blobs into real
  terraces, so an upper bound on error).
- **Overture heights are empty here.** 0 of 3,591 carry `height`; 6 carry `num_floors`.
  Heights must be produced by us, from Google Open Buildings 2.5D Temporal via Earth
  Engine — which is where today's shipped heights came from, by a pipeline that was
  never committed.
- **The suspected low bias.** Across the only 4 genuine independent comparisons that
  exist (OSM `building:levels`, excluding one 2.5 m Google fill value initially
  miscounted as a measurement), our zonal-mean heights ran ~22–40 % low. Mechanism:
  averaging the 2.5D raster over a footprint pulls in courtyards, annexes and shadow.
  **n = 4 is a hypothesis** — this spec turns it into a measurement.
- **2.5 m is a fill value, not a height.** Google writes 2.5 m where it has no
  confident measurement — 4.0 / 6.5 / 10.8 % of buildings per ward
  (`compute-far.py` docstring). Any new pipeline must preserve that distinction.

## 2 · Decisions, locked with the user

1. **Full replacement, not additive.** Overture becomes the footprint source. One
   provenance, hand-traced shapes where OSM has them, stable GERS ids. The additive
   alternative needs the same overlap-matching work and leaves a permanent
   two-vintage mix.
2. **Heights: compute both zonal-mean and zonal-p75, pick by evidence.** Scored
   against every OSM `building:levels` tag in the three wards. Winner ships; the
   artefact records method, margin and n. **If n < 8, mean stays** — a method change
   needs more than noise.
3. **Nothing ships until the user has seen the delta table.** This change moves
   published numbers; the phase's terminal state is a report, not a deploy.

## 3 · Components

Each is one script with one job, house acquisition idiom throughout (named constants,
`--check`, byte-stable regeneration, provenance in band).

### 3a · `scripts/fetch-buildings.py` — footprints

Overture GeoParquet via DuckDB, release pinned `2026-07-22.0` (never a glob — two 2026
releases exist and a wildcard double-counts). Per ward bbox → filter to footprints
whose centroid falls inside the 1400 m window → outer rings only (the `b` row schema
is a single flat ring; holes are dropped and the drop is counted in the manifest
entry) → simplify at 0.5 m tolerance → local metre frame, y southward, exactly the
existing convention. Emits:

- `data/geometry/{ward}-footprints.json` — rows `[x0,y0,x1,y1,…]` + GERS id sidecar
- manifest entries (source URL, release, sha256, counts, holes-dropped count)

`--check`: counts within ±10 % of the validation measurement (3,530 / — / — per ward,
the other two measured on first run and pinned then); every ring ≥ 3 vertices, closed,
inside the window envelope; no duplicate GERS ids.

### 3b · `scripts/compute-heights.py` — Earth Engine, parity oracle first

Zonal statistics of `GOOGLE/Research/open-buildings-temporal/v1` `building_height`
(2023 epoch) per footprint polygon, via `reduceRegions` in pages. Reads the key from
`GOOGLE_APPLICATION_CREDENTIALS` (`~/.config/delta-climate/ee-service-account.json`,
0600) — never a repo path, never printed. Per building: `mean`, `p75`,
`confident_px_frac`. Where `confident_px_frac` is 0 the height is the explicit fill
`2.5` with a `fill: true` flag — the Google convention, now carried openly instead of
implicitly.

**MODE 1 — PARITY (runs first, gates everything).** Over the CURRENT Microsoft
footprints, the pipeline must reproduce the committed `b[0]` heights: median |Δ| ≤
0.5 m and ≥ 90 % of buildings within 2 m, fill-flagged buildings excluded. A pipeline
that cannot recreate what we ship today has no business generating what we ship
tomorrow. This also smoke-tests the EE IAM grant on day one — the AlphaEarth note
records one grant missing, and whether it blocks this collection is unknown until
tried; if it does, the phase stops there with the request text ready to send.

**MODE 2 — PRODUCTION.** Same statistics over the Overture footprints, keyed by GERS.

### 3c · Height method decision — `scripts/validate-heights.py`, extended

Fetch every `building:levels` tag in the three windows (Overpass, one request per
ward, 30 s spacing, resume file — the rate-limit lesson). Match to footprints within
12 m. Score mean and p75: median ratio to `levels × 3.1 m`, checked at 2.9 and 3.3 so
the storey constant cannot decide the winner. Ship the method with the median ratio
nearer 1.0; record method, margin, n, and the loser's numbers in `heightsNote`.
**n < 8 → mean ships regardless**, and the note says the test was underpowered.

### 3d · `scripts/build-ward-geometry.py` — bake, to staging

Footprints + chosen heights → `data/geometry/staging/{ward}.json`, byte-stable, same
schema as today (`name/type/center/sizeM/count/source/heightsNote/b`) so every
consumer works unchanged. `source` and `heightsNote` rewritten to name Overture, the
release, the EE collection, the method and the fill convention. **Nothing in this step
touches `public/`.**

### 3e · The gate — `scripts/measure-geometry-deltas.py`

One script, one table, from the staging artefacts against the shipped ones:

| measured | via |
|---|---|
| built-raster ward means, before/after, 4 dp | `export-built-raster.mjs` on both sets |
| FAR per ward | `compute-far.py` on both sets |
| DC-URS pillar and total score deltas | `build-dcurs-inputs.py` chain |
| Compare pinned-pair numbers | `compare/paired-runner` path on both sets |
| building counts, ward JSON bytes (mobile budget) | direct |

Output: `data/calibration/geometry-replacement.json` + a printed table. **The phase
stops here. The user reviews the table before anything ships.**

If the built-fraction deltas are non-trivial (expected — ~1,480 more buildings), the
calibration inputs have moved: `measure-accuracy.py` re-runs inside the phase, and a
daytime RMSE shift beyond the **±0.49 K** Landsat CI half-width is a hard stop that
becomes its own reviewed PR — the water plan's stop condition, verbatim.

### 3f · Ship — one commit, after approval

Staging → `public/heat-map/data/`, recalibrated DC-URS inputs, updated Compare
contract docs, `validate-geometry.py` re-run (the >20 m-orphan count should collapse
to ~0 — the after-photo of the whole exercise), attribution line gains
`Footprints © Overture Maps Foundation (ODbL)`, tests updated in the same commit.
Never staggered.

## 4 · What could go wrong

| risk | answer |
|---|---|
| EE IAM grant blocks the collection | Parity mode hits it on day one; phase stops with the grant request ready |
| Parity mode cannot reproduce shipped heights | Full stop — the discrepancy is the finding; investigate before any replacement |
| OSM levels sample stays < 8 | Mean ships; hypothesis stays recorded as untested, not silently adopted |
| Overture polygons with holes | Outer ring only; drop count in the manifest |
| Ward JSON grows ~1.7× | Measured in the delta table; checked against the coarse-pointer mobile tier budget (docs/mobile-audit shelf) before ship |
| Daytime RMSE moves > ±0.49 K | Hard stop, own PR — never absorbed silently |
| A future Overture release changes quality | Release pinned; `validate-geometry.py` is the tripwire any bump must re-run |

## 5 · Out of scope

Terrain (shipped 2026-08-04) · LiDAR procurement (open commercial question) · other
cities · P4 water physics (parked) · roof materials (measured Sentinel-2 albedo wins)
· any `accuracy.ts` band change except as the re-run's own reviewed diff.
