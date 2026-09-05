# Rooftop-PV shading: trees into the pass — design and PRE-REGISTRATION

**Date:** 2026-09-05 · **Status:** approved in conversation (Head of Technology, 2026-09-05) ·
**Wards:** all three · **Decision taken:** the tree term REPLACES the shipped per-building loss
(buildings + trees becomes the number the yield chain reads), with building-only and tree-only
published beside it for attribution.

**Written and committed BEFORE any tree-shading loss was computed.** Two diagnostics were
computed first and are quoted below (canopy claimed on roofs, canopy taller than the roof within
15 m); the loss itself was not. That order is stated so nobody has to take it on trust.

## 1 · Why

The shading column is the one part of the rooftop-solar block we would put our name on: it is
computed from this ward's own geometry, weighted by measured sun, and every known bias in it runs
one way. It has one known omission — `scripts/measure-pv-shading.py` casts shadows from buildings
only. We hold a measured 1 m canopy height model for all three wards (Meta/WRI CHM v2, CC BY 4.0)
and do not use it here.

Measured before writing this, Ballygunge, 1 m grid:

| diagnostic | value |
|---|---|
| buildings with canopy TALLER than their own roof within ~15 m | **3,313 of 3,527 (94 %)** |
| roof pixels on which the CHM claims canopy > 2 m | **36.8 %** (mean 4.0 m on roofs) |
| off-roof pixels with canopy > 2 m / > 8 m | 49.5 % / 31.2 % |
| 1 m read of the ward box from S3, unsigned | 1.7 s |

The first row says trees will not be a correction to the building term; in these low-rise wards
they are likely the larger term. The second row is an artefact to be masked, and a fact about the
model worth publishing.

## 2 · What the trees file is, and why it cannot cast shadows

`public/heat-map/data/<ward>-trees.json` is a RENDER derivative
(`docs/superpowers/specs/2026-08-11-vegetation-placement-v2-design.md`): 0–4 instances per 10 m
canopy cell, each jittered by up to ±4 m from the cell centre by a hash, species by hash, radius
`r = 0.35·h·(0.9…1.1)`. Positions are not crowns and radii are not measured. Using them as casters
would be a per-building fiction. **The measured object is the 1 m raster itself**, read by
`read_chm_grid(ward, n)` in `scripts/fetch-canopy.py` at any grid size.

## 3 · Approach — raster shadow-casting on a surface model

Chosen over crown detection into the polygon sweep (adds a crown-delineation step, with its own
error, on a model already 3 m off; fails on the continuous roadside canopy Ballygunge has) and over
the trees file (above).

**Grid.** One 1 m grid per ward, north-up, ward metres, the frame the geometry file already uses
(`row 0 = north`, `x` east, `y` north). Resolution is free at 1.7 s per read, and a 50 m² roof is
50 pixels rather than 12.

**Surfaces.** Two, built per ward:

- `DSM_b` — buildings only. Footprints rasterised at their shipped height (p65; 2.5 m fill kept,
  exactly as the polygon pass). **A pixel belongs to the tallest record covering it** (rasterise
  ascending by height, last wins). This is the raster form of the polygon pass's
  duplicate-footprint guard: a shorter twin under a full duplicate keeps no pixels and is reported
  by count; a partial overlap (an annexe) keeps its uncovered part, which is physically right.
- `DSM_bt = max(DSM_b, canopy_masked)` — buildings plus canopy.

**Canopy, three rules.**

1. **Masked on roofs.** Canopy is zeroed inside every footprint dilated by one pixel before
   casting. A roof cannot shade itself, and we cannot tell an overhanging crown from a
   mis-predicted building. This UNDERSTATES tree shading, the direction every other bias in the
   chain already runs. The masked fraction is published as a diagnostic on the CHM.
2. **Transmittance τ = 0.30 central**, band **0.20–0.50**. Field measurements of solar radiation
   transmittance through in-leaf urban tree crowns (Wu, Lu & Lin 2025; Konarska et al. 2014) put
   common species at 0.2–0.5, mean ≈ 0.3. A canopy-shaded pixel therefore blocks **70 %** of beam;
   a building-shaded pixel blocks 100 %; a pixel under both counts as building-shaded.
3. **Height sensitivity.** Canopy is run at its stated height and at `max(0, h − 3.0 m)`, the
   model's own published MAE (Brandt et al., v2). Both are published; the shipped figure uses the
   stated height.

**Pad.** The canopy is read with a **200 m pad** beyond the ward box so trees just outside still
cast in (a 34 m crown at 10° sun throws 193 m). Buildings have no pad — no geometry is held
outside the ward — the same edge limitation as the polygon pass, stated not fixed.

**Sun.** `sun_positions(lat)` from the existing script, unchanged: 12 sample days, every daylight
hour above `MIN_ALT`, each weighted by its mean NASA POWER GHI. The two passes are comparable
hour for hour.

**The march.** For a sun at altitude α, azimuth az, with `s = (sin az, cos az)` the unit vector
TOWARD the sun in (east, north), a pixel `x` at roof height `h_i` is shaded when

    max over k = 1…K of  [ DSM(x + k·s·Δ) − k·Δ·tan α ]  >  h_i + ε

with Δ = 1 m, ε = 0.05 m, K = ceil(h_max / (Δ·tan α)). Implemented as K vectorised shift-and-max
passes over the whole grid per sun position (Ratti & Richens 2004; Lindberg & Grimmond 2011 —
the published algorithm, written from the description; no GPL code). Sub-pixel direction is
handled by rounding `k·s` to integer offsets, as those papers do. The receiver height is the
building's own `h_i`, not `DSM(x)`, so a shorter twin evaluated on its remaining pixels is tested
against its own roof.

**Attribution, exact by construction.** Per sun position: `shaded_b` from `DSM_b`, `shaded_bt`
from `DSM_bt`, `tree_only = shaded_bt ∧ ¬shaded_b`. Per building `i` with `n_i` pixels:

    loss_total_i     = Σ_sun ghi · Σ_pix [ shaded_b ? 1 : tree_only ? (1−τ) : 0 ]  /  (n_i · Σ_sun ghi)
    loss_buildings_i = Σ_sun ghi · Σ_pix [ shaded_b ]                              /  (n_i · Σ_sun ghi)
    loss_trees_i     = loss_total_i − loss_buildings_i

Terrain is ignored, as the polygon pass ignores it and for the reason it measured: ground moves
< 1 m over a 25–50 m shadow run in wards with 3–5 m of relief.

## 4 · Files

- **New** `scripts/measure-pv-tree-shading.py` — the raster pass. Imports `sun_positions`,
  `load_ward` and the constants from `measure-pv-shading.py` (loaded by path, as
  `build-pv-yield.py` already does), and `read_chm_grid` from `fetch-canopy.py`. Carries a
  `--self-check` that runs the synthetic scene in §7 and asserts it. Strict mypy, like every `.py`.
- **New artefact** `data/calibration/pv-shading-trees-<ward>.json` — everything below. The
  registered artefact `data/calibration/pv-shading-<ward>.json` is **never rewritten**: it is the
  record of the pre-registered building test.
- **Changed** `scripts/build-pv-yield.py` — reads `per_building_loss_total` from the new artefact
  instead of `per_building_loss` from the old one (one read site), and writes `loss_buildings`
  and `loss_trees` into the browser file beside `loss`. `basis` string gains "canopy shading from
  Meta/WRI CHM v2 (masked on roofs, τ 0.3)".
- **Changed** `public/heat-map/data/pv-<ward>.json` — `loss` becomes total; `loss_buildings`,
  `loss_trees` added; `kwh` recomputed. Same length, same index join, no id.
- **Docs** — `docs/evidence/known-limitations.md` §8 addendum; `docs/evidence/data-sources.md`
  CHM entry: role is no longer "render-only" — it now enters the **PV screening**, still never the
  temperature solve; `docs/evidence/methods-and-papers.md` gains the shadow-march references and
  the transmittance sources.

### The new artefact, fields

```
prereg, ward, buildings, grid_m: 1.0, pad_m: 200, sun_hours_sampled,
canopy: { source, version: "v2", mae_m: 3.0, masked_on_roof_frac, transmittance: 0.30,
          transmittance_band: [0.20, 0.50] },
buildings_without_pixels: n,                      # full-duplicate twins, reported not hidden
per_building_loss_total[], per_building_loss_buildings[], per_building_loss_trees[],   # central
cross_check: { polygon_mean_pct, raster_mean_pct, abs_diff_pp, polygon_share_5pct,
               raster_share_5pct, abs_diff_share_pp, pass },
sensitivity: [ { tau, canopy_height: "stated" | "minus_mae", mean_total_pct,
                 share_5pct_total, mean_trees_pct } × 6 ],
predictions: { P1: {…per ward…}, P2: {…} },        # §5, filled by the run
gate_restated: { all_roofs: {mean_pct, share_5pct}, ge_3kwp: {mean_pct, share_5pct} },
notes: { height_bias, canopy_mask_bias, edge }
```

## 5 · PRE-REGISTRATION — predictions, fixed now

**P1 — trees are the larger term where roofs are installable.** On roofs supporting ≥ 3 kWp,
mean `loss_trees` **exceeds** mean `loss_buildings` in **at least two of the three wards**. Basis:
row 1 of the table in §1 (94 % of Ballygunge buildings have taller canopy within 15 m) and median
roof heights of 7.0 / 4.9 / 4.5 m against a v2 canopy p95 of 16 m.

**P2 — the total never falls.** For every building, `loss_total ≥ loss_buildings` (raster), and
the ward-mean total exceeds the ward-mean building-only figure. This is a property of the
construction; if it fails the code is wrong, not the trees.

**Reported, not predicted:** the gate statistics (mean ≥ 3.0 %; ≥ 10 % losing ≥ 5 %) restated for
the total on both populations. The building test's verdicts stand as registered on 2026-08-21;
these are reported ALONGSIDE, never as a re-registration.

**Sanity checks that must pass, or the result is void:**

1. **Cross-check.** The raster buildings-only run agrees with the registered polygon run:
   `|mean_raster − mean_polygon| ≤ 1.0 pp` and `|share≥5 %_raster − share≥5 %_polygon| ≤ 3.0 pp`,
   per ward. This validates the new method against the old before a single tree is counted.
2. **Isolation.** A roof with no canopy and no taller building within its longest possible shadow
   (`h_max / tan MIN_ALT`) shows exactly 0.
3. **Loss rises as the sun falls** — mean shaded fraction per sun position is monotone in
   altitude within each sample day.
4. **Nothing lower than the roof shades it** — canopy at or below `h_i` contributes nothing
   (guaranteed by the `> h_i + ε` test; asserted on the synthetic scene).

**What will NOT be done.** No changing τ, the mask rule, the pad, or the height scenario after
seeing results; the sensitivity table is the only place other values appear. No dropping a ward.
No re-running with the trees file. No touching the building term, which stays as registered.

## 6 · Known biases, and their direction

| term | direction | why |
|---|---|---|
| building heights | shading **under**stated | unvalidated, suspected low (registered 2026-08-21) |
| canopy masked on roofs | tree shading **under**stated | overhanging crowns are removed with the artefacts |
| canopy heights (v2, MAE 3.0 m) | **either way** | published band covers −3 m; +3 m is not run, so the shipped figure is not the upper bound |
| transmittance 0.30 | either way | 0.20–0.50 band published; no species, no seasonal leaf drop |
| ward-edge buildings | shading understated at the edge | no geometry outside the ward |

The honest sentence for the card: *"Shaded X %, of which trees Y %. Screening: canopy heights
±3 m, crowns treated as 70 % opaque."*

## 7 · Verification

- `--self-check` synthetic scene, asserted: a 20 m tree beside a 5 m roof at a 30° sun throws
  `(20−5)/tan 30° = 26.0 m` of shadow ONTO the roof on the side away from the sun and none toward
  it; a 4 m tree beside the same roof throws none; a building-shaded pixel scores 1.0 and a
  tree-only pixel `1 − τ`.
- Strict mypy on both scripts (`python3 -m mypy`), the project rule.
- Three wards, each run under the 6-cell sensitivity grid; central values ship.
- The cross-check in §5 passes for every ward, or nothing ships and the disagreement is the
  result.
- `build-pv-yield.py` rerun; the browser files regenerated; `npm run verify` green.
- Docs updated in the same change, so the CHM's role and the card's sentence never disagree.

## 8 · Out of scope

Species, seasonal leaf drop, crown shape (a raster has none), terrain, buildings outside the
ward, and any change to the console — the card's Solar block is the Option 1 build, which reads
whatever `loss`, `loss_buildings` and `loss_trees` say.

## References

- Ratti C., Richens P. (2004) *Raster analysis of urban form*. Environment and Planning B 31(2).
- Lindberg F., Grimmond C.S.B. (2011) *The influence of vegetation and building morphology on
  shadow patterns and mean radiant temperatures in urban areas*. Theor. Appl. Climatol. 105.
  (Algorithm reference only; SOLWEIG code is GPL and is not used.)
- Wu Y.C., Lu C.L., Lin T.P. (2025) *Evaluating the effectiveness of tree canopy and building shade
  in urban heat mitigation using solar radiation transmittance*. Sustainable Cities and Society.
- Konarska J. et al. (2014) *Transmissivity of solar radiation through crowns of single urban
  trees*. Theor. Appl. Climatol. 117.
- Brandt et al. (2026) Meta/WRI Global Canopy Height Model v2, *Scientific Data*
  (arXiv:2603.06382). MAE 3.0 m. CC BY 4.0.
