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

1. **Masked on roofs — SUPERSEDED by Amendment A1 below, before any run.** As first written:
   canopy zeroed inside every footprint dilated by one pixel, on the reasoning that a roof cannot
   shade itself and an overhanging crown cannot be told from a mis-predicted building. A1 replaces
   the blanket mask with a connectedness rule that keeps overhanging crowns and drops enclosed
   blobs, and publishes both fractions.
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
| canopy over roofs (A1 connectedness rule) | **either way** | overhanging crowns kept, enclosed misreads dropped; a misread touching a real crown survives, so the strict-mask sensitivity cell bounds it |
| canopy heights (v2, MAE 3.0 m) | **either way** | published band covers −3 m; +3 m is not run, so the shipped figure is not the upper bound |
| transmittance 0.30 | either way | 0.20–0.50 band published; no species, no seasonal leaf drop |
| ward-edge buildings | shading understated at the edge | no geometry outside the ward |
| raster pixelisation vs the polygon sweep (A2, measured) | raster reads **low** | buildings-only Ballygunge: raster 4.648 % vs polygon 5.122 % mean, r 0.9944, raster lower on 93.7 % of buildings; share ≥ 5 %: 25.83 vs 28.24 |
| integer rounding of k·s on off-cardinal azimuths (A2) | reads up to √2 further than the drop applied | the published algorithm's own approximation; dominated by the pixelisation row, which runs the other way |
| near-zenith blind spot for canopy standing OVER a roof (A3, measured) | tree shading **under**stated | the march starts at k = 1, so a crown Δh above its own roof stops shading the pixels beneath it once tan α > Δh: a crown 2 m above its roof is invisible for 27.45 % of the year's GHI weight, 3–4 m for 11.67 %, 6 m for 6.85 %, 11 m never. Inherent to the pre-registered march; bites only the on-roof overhang term |

The honest sentence for the card (revised in A3 to lead with the dominant lever): *"Shaded X %, of
which trees Y %. Screening: the tree term is Z % under a strict roof mask; canopy heights ±3 m; crowns
treated as 70 % opaque."*

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

## Amendments

### A1 — 2026-09-05, before any loss was computed. Canopy over roofs, and panels over canopy

**Raised by the Head of Technology on reading the spec:** canopy over a footprint is not always
an artefact. A crown from next door genuinely overhangs roofs, and panels are routinely mounted
ABOVE the canopy on raised frames — elevated mounting structures on 2–2.5 m stilts are common
practice on Indian terraces precisely to keep the roof usable. The blanket mask in §3 rule 1
threw away the real overhangs with the mistakes, and the receiver-at-roof-plane assumption
ignored the raised frame. Both are changed here; the predictions in §5 are not.

**Rule 1 as amended — connectedness, not a blanket.** Label the connected components of
`canopy > 2 m` on the padded grid. A component that has ANY pixel outside every footprint
(dilated by one pixel) is a tree rooted outside: it is **kept whole**, overhang included, and
where it rises above a roof it shades that roof at every sun position, as it should. A component
**enclosed entirely within footprints** has no tree to belong to: it is a building the model
misread as canopy, and it is zeroed. Canopy at or below a building's own height inside its
footprint is harmless either way — `DSM = max(building, canopy)` — so the rule only bites where
canopy over a roof stands above that roof. Two fractions are published: canopy-over-roof pixels
kept as overhang, and dropped as enclosed. **Bias direction changes:** this no longer strictly
understates tree shading, because an enclosed misread that happens to touch a real crown next door
survives the test. The strict blanket mask is therefore run as a sensitivity cell (below) so the
two rules bracket the effect.

**Sensitivity grid, two cells added** (central τ 0.30, stated heights unless noted):

| cell | what it answers |
|---|---|
| **strict mask** (all canopy over footprints zeroed, the original rule 1) | how much of the tree term rides on overhang and surviving misreads |
| **array raised 2.0 m** (receiver at `h_i + 2.0`, everything else central) | how much shading a standard elevated mounting structure recovers — the consultant's lever |

Eight cells in all. The shipped figure remains the central cell: connectedness rule, τ 0.30,
stated canopy heights, receiver at the roof plane. The raised-array figure is reported per ward
and, per building, as `per_building_loss_total_raised[]` so the card can offer it as a what-if
rather than a claim.

**Not taken from the same observation:** panels physically fixed to trees. Anecdotal, not a
mounting class any scheme addresses, and a raster has no way to represent it.

**Artefact fields added:** `canopy.overhang_kept_frac`, `canopy.enclosed_dropped_frac`,
`per_building_loss_total_raised[]`, and the two sensitivity rows. §4's field list is to be read
with these included.

### A2 — 2026-09-05, after the code review of Tasks 1–3, before any tree loss was computed. Connectivity, and two biases the review measured

**Raised by the code-quality review of the implementation** (`scripts/measure-pv-tree-shading.py`,
commits 8ac62be…c790584). No ward tree-shading loss existed when this was written; the reviewer's
only ward-scale run was the buildings-only march, which the mask does not touch.

**Rule 1 (A1) — connectivity declared.** "Dilated by one pixel" did not say which neighbourhood.
The implementation dilated 4-connected while labelling components 8-connected. Measured on
Ballygunge at 1 m: the 4-connected ring is 167,266 px, the 8-connected ring 197,151 px — 29,885 px
(4.78 % of footprint area) classed "outside a footprint" by the one and "inside" by the other, and
each such pixel can flip a whole canopy component from enclosed to rooted. The direction is not
neutral: the smaller ring keeps more canopy, i.e. leans toward P1. **Declared now: dilation is
8-connected (3 × 3 structuring element), matching the labelling**, the natural reading of "one
pixel" and the choice that does not lean. The self-check gains a case that discriminates (a blob
whose only off-roof pixel touches the roof's corner diagonally is enclosed). Artefact gains
`canopy.on_roof_px` beside the two fractions, so "no canopy on roofs" and "0 of many kept" are
distinguishable.

**§6 gains two rows, with receipts.** (i) The raster reads LOW against the polygon sweep:
buildings-only Ballygunge, all 134 sun samples, raster 4.648 % vs polygon 5.122 % mean loss,
r 0.9944, raster lower on 93.7 % of buildings (thin shadow slivers lost to pixelisation, roofs
quantised to whole pixels). Share ≥ 5 %: 25.83 % vs 28.24 %, i.e. 2.41 pp of the 3.0 pp share
tolerance consumed — **the share gate, not the mean, is the tight one**, and it may not clear in
the lower-rise wards. If it does not, the tolerance is NOT loosened; the raster's systematic low
bias is the published finding. (ii) Rounding k·s to integer offsets on off-cardinal azimuths
reads a pixel up to √2·k·Δ away while applying k·Δ·tan α of drop — the pre-registered algorithm's
own approximation (Ratti & Richens do the same), dominated by (i) in the opposite direction.

**Self-check hardening, no rule change.** Every scene case sat at azimuth 180°, where the column
offset is zero for every k; a sign flip on the east-west term survived all nine checks AND both
ward cross-check gates (measured: mean 0.491 pp, share 2.55 pp, r 0.9918). A mast under a sun due
east must now throw its shadow west along its own row. `shadow_height` asserts a square grid
(measured: a rectangular one returned a valid-shaped array in which the columns beyond the row
count never shade — partial and silent, which is worse than none).

**Unchanged:** every prediction in §5, both cross-check tolerances, τ, the pad, the height
scenarios, the receiver rule.

### A3 — 2026-09-05, after the Task 4 review, before the other two wards ran. The statistic actually applied, a blind spot, and the dominant lever

**Sanity check 3 as applied.** §5 registered "loss rises as the sun falls — mean shaded fraction per
sun position is monotone in altitude within each sample day". The literal test is unimplementable:
each sample day's altitudes are an exact palindrome about solar noon (day 1: 11.6, 23.4, 33.8, 42.1,
46.8, 46.8, 42.1, 33.8, 23.4, 11.6°), so equal altitudes differ only by azimuth and any asymmetry in
the built form breaks strict monotonicity on a physically correct run. What the code tests, per day:
the shaded fraction at the lowest-altitude sample exceeds that at the highest-altitude sample, AND
the correlation between altitude and shaded fraction is negative. This pair was in the approved plan's
code before any ward ran and Ballygunge ran under it; it is written here so the artefact and the spec
say the same thing. It is a weak check by design — it verifies that the drop is wired the right way
up, nothing more; the east-west convention is pinned by the self-check (A2), not by this. The artefact
now publishes the statistic, the per-sun shaded fractions and the sun samples, so a reader can
re-verify it.

**§6 gains a row: the near-zenith blind spot.** The march samples from k = 1, so canopy standing
directly over its own roof is invisible whenever tan α exceeds its height above that roof. Measured on
the real sun sample: a crown 2 m above its roof is missed for 27.45 % of the year's GHI weight (24 of
134 samples), 3–4 m for 11.67 %, 6 m for 6.85 %, 11 m never. It cannot touch the off-roof tree term.
Direction: understates, like the pixelisation row.

**The mask rule is the dominant lever, and the sentence now says so.** Ballygunge: A1 → strict mask
moves the central total 19.91 → 10.98 %, an 8.93 pp spread, against 6.54 pp for the whole τ band,
5.33 pp for canopy −3 m and 4.87 pp for the raised array. Roughly 59 % of the tree term is canopy
standing over footprints, of which A1 filters 2.0 % (`overhang_kept_frac` 0.980) — in continuous
canopy the connectedness rule barely fires, exactly the weakness A1 wrote down. So the honest bracket
is the strict-mask floor to the A1 figure, and any sentence quoting the A1 figure carries the floor.
The artefact gains a `levers` block with the four spreads computed per ward. Predictions, tolerances
and the central cell are unchanged.

**Two receipts corrected.** A2's "raster lower on 93.7 % of buildings" is 95.6 % of the 2,882
buildings whose two figures differ; over all 3,527 it is 78.1 %, the rest equal (434 both zero).
And `polygon_share_5pct` was recomputed from the registered artefact's 4-dp arrays (0.2824) rather
than read from it (0.2821); the artefact now publishes the registered figures verbatim beside the
same-population recomputation the gate uses.

**Artefact additions:** `sanity.loss_rises_as_sun_falls` becomes an object (`test`, `days`,
`days_tested`, `pass`); `shaded_frac_by_sun[]`, `sun_samples[]`; `cross_check` gains the registered
comparands; `cross_check_ge_3kwp` (informational, not gated); `stratum` (packing factor, m² per kWp,
threshold, n); `levers`; `canopy.href`, `canopy.max_m`, `canopy.nonzero_px`; a note that the three
per-building arrays are rounded independently to 4 dp.

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
