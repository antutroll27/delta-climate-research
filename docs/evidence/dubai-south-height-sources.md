# Open height sources for Dubai South: four tested, four rejected

**Date:** 2026-09-05
**Question:** can Dubai South's building heights be improved using open datasets or
open-web information, beyond the OSM heights and the fitted priors already in place?

**Answer: no. Dubai South is already at the limit of what open data supports.**

That is a useful result rather than a disappointing one, because it explains *why*
the neighbourhood prior in `blender_dubai.py` is the right estimator: **there is no
open per-building height measurement covering the UAE.** A prior fitted from OSM's
own measured buildings is the best available, not a fallback from something better.

This document exists so nobody spends another day re-testing these four.

---

## 1. Copernicus GLO-30 DSM minus our bare-earth DTM — REJECTED, circular

**The idea.** GLO-30 is a *surface* model and includes buildings; our terrain
pipeline already fetches it, and separately builds a bare-earth DTM. DSM − DTM over
a footprint should be that building's height, from data already licensed and in
hand. Dubai South's buildings are enormous, so a 30 m cell sits well inside them —
the opposite of the Creek, where towers are narrower than a cell.

**Why it fails.** The two surfaces are not independent.

- `dubai-south-terrain.json` reports `landFillFraction 0.7879` with
  `fillSource "GEDTM30 v1.2"`. **78.8 % of the window's bare earth is GEDTM30**,
  which is itself derived from Copernicus GLO-30. Differencing GLO-30 against it is
  close to differencing a product against its own parent.
- `buildingMask.removedP50M` is **0.246 m**. That is the median height the pipeline
  removed when it masked buildings out of the surface. If GLO-30 resolved these
  buildings it would be metres.

**Measured.** Against 881 genuine `height=` tags: correlation **+0.396**, MAE
18.91 m, median estimate **34.4 m against a true 15.0 m**. Grid alignment was swept
over all four flip combinations and confirmed against the artefact's own published
percentiles (loaded DTM p50 27.12 vs artefact 27.12; DSM p50 27.60 vs 27.60), so
the weakness is the data, not the sampling.

## 2. GHS-BUILT-H, JRC / European Commission — REJECTED, worse than nothing

**The idea.** GHS-BUILT-H ANBH (Average Net Building Height), R2023A, 100 m,
CC-BY-4.0, genuinely independent of our terrain. Tile `R6_C24` in ESRI:54009 covers
Dubai South; the global file is 5.6 GB but a tile is 3.7 MB.

**Measured.**

| site | correlation | MAE | the global area curve |
|---|---:|---:|---:|
| dubai-south | **−0.146** | 20.03 m | 17.06 m |
| dubai-creek | +0.201 | 41.74 m | 40.41 m |

**Negative correlation in Dubai South, and worse than the curve it would replace in
both windows.** A best-case least-squares rescale does not rescue it (18.88 m).

**Why it fails.** ANBH is an *area-weighted average over a 100 m cell*. Our ground
truth is individual buildings that carry a height tag, which skew tall — a cell
average cannot predict its tallest member. The epoch is also E2018, seven years
stale for a district still under construction.

## 3. Overture Maps buildings — REJECTED, it is our own data

**The idea.** Overture merges OSM, Esri, Microsoft and Google building data with
per-building `height` and `num_floors`, CDLA-Permissive-2.0, release 2026-08-19 —
three weeks old.

**Measured.** 49,659 buildings with a centroid in the window, of which 485 carry a
height and 8,681 a floor count. Validation against our genuine height tags looks
superb: `height` correlates **+0.964** with MAE **0.61 m**.

**That correlation is circular.** Grouping by the `sources` field:

```
      dataset     n   with_height   with_floors
OpenStreetMap  8783           485          8681
```

**100 % OpenStreetMap.** Every height Overture has for this window is a height we
already have. The +0.964 says only that Overture faithfully carries OSM.

**And we already have more buildings than it does.** A first comparison suggested
Overture held 15,896 buildings we lacked; that was an error — it compared Overture's
merged OSM+ML total against only our OSM subset. Counted properly:

```
  OSM outlines                      33,763
  Microsoft GlobalML footprints     43,479
  ...superseded by an OSM outline   17,699   (not drawn)
  DISTINCT buildings drawn          59,543
  Overture                          49,659   -> we have +9,884
```

## 4. WSF-3D, DLR — REJECTED, no coverage

**The idea.** World Settlement Footprint 3D, 90 m average building height from
TanDEM-X interferometry — a genuinely different instrument from GHSL's fusion.

**Why it fails.** Tiles `e055_n25_e056_n24` and `e054_n25_e055_n24` both return 404.
WSF-3D's tile listing covers selected settlement areas rather than a complete global
grid, and **Dubai is not among them.**

---

## Open-web information: the ceiling is about 2 %

Dubai South has **97 buildings at or above 80 m**, of which 60 are named and **49
carry a height that is an exact multiple of 4.0** — a floor count, not a
measurement. Only **18 of those are named**, and are therefore the ones a published
figure could correct: FIVE Jumeirah Village (61 floors), The First Collection Hotel
(44), Ghalia (39), Square Tower (37), Bloom Heights (34), and thirteen more.

But the `building:levels x 4.0` fallback was measured against genuine height tags at
**MAE 5.43 m** (n=416, correlation +0.897). On a 244 m tower that is a 2 % error.
Hand-curating 18 published heights would move 18 buildings out of 33,763 by a few
metres each. It is not nothing, but it is not accuracy — it is tidying.

## Sources considered and not tested, with reasons

- **3D-GloBFP** — already evaluated for this project: r = 0.416 for Dubai South, and
  it saturates (144 m against Burj Khalifa's 828 m).
- **Google Open Buildings 2.5D Temporal** — has real heights, but its coverage is
  Africa, South Asia, South-East Asia and Latin America. **No Middle East.** Moot
  before the question of whether to use Google data arises at all.
- **Dubai Municipality open data** (`dm_community-open`, `dm_sectors-open`) — the
  "open" tier carries a prior-permission condition requiring data-owner approval via
  geodubai.dm.gov.ae. Not an open licence.
- **GEDI / ICESat-2** — already ruled out as a validation route for this project.
- **OSM `building:part`** — already consumed; 237 slabs over 65 footprints.

## What this leaves

The heights Dubai South ships with are, in descending order of evidence:

1. **9,952 OSM heights**, of which about a fifth are genuine `height=` tags and the
   rest `building:levels x 4.0` at MAE 5.43 m.
2. **A fitted area-band prior above 5,000 m²**, from that site's own measured
   buildings: 15.16 m → 8.58 m held out.
3. **A neighbourhood grid below 5,000 m²**, 600 m cells by size band: 20.76 m →
   11.58 m held out on the Creek, and the same machinery here.
4. The global log curve, only where neither applies.

Nothing open improves on that today. If that changes, the two things to watch are a
Middle East extension of Google Open Buildings 2.5D, and any WSF-3D release that
adds Gulf tiles.
