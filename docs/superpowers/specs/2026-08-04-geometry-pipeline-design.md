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
2. **Heights: compute zonal-mean, p65 and p75, pick by evidence.** Scored against
   every OSM `building:levels` tag in the three wards. Winner ships; the artefact
   records method, margin and n. **If n < 8, the statistic nearest the shipped one
   (p65, measured) ships** — a method change needs more than noise.

   *Amended 2026-08-04:* the candidate set gained **p65** because that is where the
   shipped heights actually sit once registration is correct. The original pairing of
   mean-vs-p75 was chosen to test a suspected ~25 % low bias; that hypothesis is now
   **unsupported** — the true understatement is ~17 % and is swamped by ±2 m
   per-building scatter, and p75 would overshoot. The decision is kept anyway, because
   it now tests the shipping heights against real ground truth rather than adjudicating
   a bias that turned out not to be there.
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

**MODE 1 — PARITY. RUN, FAILED, AND RETARGETED (2026-08-04).** The original gate
demanded per-building reproduction of the committed `b[0]` values over the committed
footprints: median |Δ| ≤ 0.5 m, ≥ 90 % within 2 m. It ran. What happened is recorded
in full in [`../../heat-map-feature.md`](../../heat-map-feature.md); in short:

- It **caught a real bug** — the local→global inverse used a southward `y` while the
  whole repo (`fetch-water.py`, the roads fetcher, `_types.m_per_deg`) is northward,
  mirroring every footprint about the ward centre line. **That is the gate paying for
  itself**, and had it been skipped the same error would have entered the *forward*
  conversion and placed every new building mirrored against roads and water.
- After the fix, parity reached median |Δ| 1.40 m / 64 % within 2 m — and **cannot
  reach 90 %**. Stratified by footprint area the best band is 78 % (120–250 m²), and
  agreement *falls* again for large buildings with 85 pixels, so this is not sampling
  noise. It is structural, and the cause is unrecoverable: the shipped rings are
  already simplified and rounded to 0.1 m, so a slightly different polygon samples a
  different pixel set and the discarded vertices are gone.

**Per-building parity against a soon-to-be-replaced artefact is therefore abandoned
as unreachable in principle, not deferred as hard.** It is replaced by THREE gates,
which together are stricter than the one they replace because two of them test the
NEW heights on their own merits rather than against an artefact we are deleting:

**GATE A — distribution parity (protects the published numbers).** Per ward, the new
height set's p50/p75/p90 and mean must each land within **±10 %** of the shipped set's,
fill-flagged buildings excluded from both. This is what FAR and the DC-URS exposure
pillar actually consume; per-building continuity was never what protected them.
A breach is not automatically fatal — Overture holds ~1,480 more buildings, mostly
small, so a modest downward shift in the median is *expected* and must be explained in
the delta table rather than silently accepted.

**GATE B — independent accuracy of the new heights.** Score the chosen statistic
against every OSM `building:levels` tag across the three wards (§3c). This is the only
external ground truth that exists, and it tests the heights we are actually shipping.
Report median ratio and n; a ratio outside 0.75–1.25 stops the phase.

**GATE C — fill discipline.** Report the fill rate per ward and require it within
±3 points of the shipped rates (4.0 / 6.5 / 10.8 %). A large jump means the footprints
and the height raster have stopped agreeing about where buildings are — the mirroring
bug's signature, and the one failure mode that must never recur silently.

**The measured statistic, recorded so nobody re-derives it.** With correct
registration, the shipped heights sit between zonal `mean` (median ratio 0.834) and
`p70` (1.086) — i.e. near **p65**. The committed `heightsNote` saying *"zonal-mean"* is
close to right, understating by ~17 %. An earlier claim in this repo that the method
was p85 and 38 % out was an artefact of the sign bug and is **withdrawn**.

**MODE 2 — PRODUCTION.** Same statistics over the Overture footprints, keyed by GERS,
using Overture's **native lon/lat** — no local→global inverse anywhere in the
production path, which removes the entire class of error that Mode 1 caught.

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
| ~~EE IAM grant blocks the collection~~ | **RESOLVED 2026-08-04** — EE initialises and the collection reads (5.64 m near Ballygunge centre). No grant needed |
| ~~Parity cannot reproduce shipped heights~~ | **HAPPENED, DIAGNOSED, RETARGETED** — one bug of ours (sign), one unrecoverable gap (discarded ring vertices). Gates A/B/C replace it |
| A coordinate-convention bug recurs | `to_local`/`to_lonlat` both call `_types.m_per_deg` with the convention documented and its evidence cited; Gate C's fill-rate check is the runtime tripwire |
| Gate A breaches because Overture adds small buildings | Expected, not fatal — explain the shift in the delta table; a median that moves the *wrong* way is the real signal |
| OSM levels sample stays < 8 | Mean ships; hypothesis stays recorded as untested, not silently adopted |
| Overture polygons with holes | Outer ring only; drop count in the manifest |
| Ward JSON grows ~1.7× | Measured in the delta table; checked against the coarse-pointer mobile tier budget (docs/mobile-audit shelf) before ship |
| Daytime RMSE moves > ±0.49 K | Hard stop, own PR — never absorbed silently |
| A future Overture release changes quality | Release pinned; `validate-geometry.py` is the tripwire any bump must re-run |

## 5 · Out of scope

Terrain (shipped 2026-08-04) · LiDAR procurement (open commercial question) · other
cities · P4 water physics (parked) · roof materials (measured Sentinel-2 albedo wins)
· any `accuracy.ts` band change except as the re-run's own reviewed diff.
