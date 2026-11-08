# Canal Ring: surface registration, 3D BAG ground, canopy read (2026-11-08)

Branch `fix/canal-ring-surface-ground`. Source: the whole-city streaming work (P2b) and its independent audit.
Three defects in the shipped Canal Ring artefacts, each measured, each fixed here. Kolkata and Bengaluru are untouched and now share a freeze
with Canal Ring (`data/baselines/existing-cities.sha256.json`).

## 1. The surface was turned by the grid convergence (audit finding B1)

`_sentinel.read_window` transforms the ward's lon/lat box into the scene's UTM CRS, takes the envelope of the result and squeezes it into an
n x n array. At Amsterdam (UTM 31N) the grid convergence is about 1.5 degrees, so the raster was a UTM-north-up window turned against the
true-north frame: 0 m at the centre, **73 m at a corner cell** (analytic), 50-60 m of local texture shift at the corners by phase correlation
(5-6 cells NW/NE/SW/SE, 0 at the centre). Independent check (audit): the correlation of Overture water with -albedo peaked 8-39 m off zero in a
rotation pattern for the shipped raster, and at zero in all five regions for the reprojected one (r 0.24 -> 0.43).

Fix: `_sentinel.read_box` reads each scene by `rasterio.warp.reproject` onto the area's own lon/lat grid (`_city.bounds`), bilinear, nodata 0. The
Kolkata and Bengaluru ward reader is unchanged (their rasters are frozen).

| | shipped | now |
|---|---|---|
| scenes | 27 (STAC search, 2021-25, sun >= 40; two relative orbits, 10:46 and 10:56 UTC) | 22 used of the 23 listed (the whole-city list: one orbit, 10:56 UTC; 2022-04-20 is under half valid on Canal Ring's grid) |
| mean vegetation (FVC) | 0.3503 | 0.3485 |
| mean albedo | 0.1067 | 0.0993 |
| seam step across/within, against the four neighbours | about 2.0 | about 1.0 |
| G7 (park contrast, north-up vs mirrored) | 0.444 vs -0.0004 | 0.512 vs -0.012 |

The albedo change (-0.007) is the SCENE SET, not the reader: the old reader on the same 22 scenes gives 0.0994, the new one 0.0993. The set is a
different one, not a trimmed one. The new list is the whole-city selection: a single relative orbit (every scene is the 10:56 UTC pass, which covers the
whole city, so a Canal Ring raster and its neighbours' rasters come from the same scenes). Today's search with the shipped selection returns 28
candidates; only 10 of them are in the new list, 18 left and 13 came in. Every one of the 18 is the 10:46 UTC pass of the adjacent orbit, where Canal
Ring sits at the swath edge (about a third of the tile is nodata). Both sets pass the sun >= 40 degree and cloud filters. The reader changes where things are (mean |dFVC| 0.20 old-vs-new, 0.05 within 200 m of the
centre and about 0.21 beyond 800 m; albedo 0.023), not the level.

Heat (shipped `TsHeatSim`, shipped vs reprojected surface, settled, 384 x 384; audit): day (28 C, sun 0.85) mean over the 384 x 384 grid **+0.07 K**, cell |dT| median
0.17 K, **p95 0.72 K**, max 1.68 K; night (18 C) +0.002 K, p95 0.08 K. Inside the +-1.87 K day CI; what moves is where the warm cells are, by up to 60 m.

Residual after reprojection: 2-5 m south and 1-3 m east, sub-cell and within Sentinel-2 geolocation.

The 23 scenes of the list (22 used) are in `data/cities/amsterdam/canal-ring-surface-scenes.json` (ids, dates, baselines, hrefs). Rebuild:
`python3 scripts/export-surface-rasters.py --ward canal-ring --scenes data/cities/amsterdam/canal-ring-surface-scenes.json <dir of '<id>_<band>.tif' crops>`.

## 2. 3D BAG's ground is implausible for 51 buildings (audit finding B1)

3D BAG v20250903 carries repeated `b3_h_maaiveld` values (-6.729, -3.310, -4.784 m NAP ...) that sit 3-9 m under the buildings around them,
which makes the building 3-9 m too tall. `_src_3dbag.ground_decision` repairs a building ONLY when at least 5 buildings within 75 m have a median ground
more than 3 m above its own; the new ground is the 5th percentile of the AHN4 DTM ring 0.5-4 m outside the footprint (widened to 8/15/25 m for a
building packed into a block: 36 of the 51). It never makes a building taller, never leaves a part under 2 m, never uses the AHN4 ring for a building
from 2020 on (the ring is then the construction site), and has no absolute NAP floor (the polders really do lie below -5 m: a polder test is in the unit tests).
With fewer than 5 neighbours a repair needs a pre-2020 building AND an AHN4 nDSM height that agrees better with the new height.

Result: **51 buildings** (hSource `3dbag-p70-ahn4-ground`), 4 kept (1 under 2 m, 1 no ring, 1 not lower, 1 from 2020 on). Heights drop by a median
**5.2 m** (p90 7.4, max 8.1, min 1.3). Their median |h - AHN4 nDSM| goes from 5.34 m to 0.15 m (n = 47 with a check); the G5 flag count (|h - hCheck| > 5 m)
goes 220 -> 190. The 55 neighbour-backed repairs of the first version are 51 under the corrected rule; the ring-only repairs of that version were wrong
(post-AHN4 new builds shrunk, some to 0 m) and are gone. Footprints, count (21,342) and terrain are unchanged (the terrain file regenerates byte-identical).
The heat solver does not read building heights for temperature, so this changes no heat.

## 3. The canopy was read 23 % tall (audit finding S3)

The CHM is uint8 metres, 0 = bare ground, no nodata tag. The shipped read used rasterio `boundless=True, fill_value=0`; that wraps the dataset in a
VRT whose nodata is 0, and GDAL's warper nudges every bare pixel off nodata: **every 0 becomes exactly 1.0** (62.4 % of native pixels are 0 and 5.8 % are 1; the
boundless read has 0 % zeros and 68 % ones). Mean height on Canal Ring's window 3.28 m against a native 2.66 m (+23 %); cover >= 3 m is untouched (0.2786 against 0.2780).
`read_chm_metre` now reads `boundless=False` (the window is always inside the tile): 2.657 m.

Effect on `canal-ring-canopy.json` / `canal-ring-trees.json`: trees 16,710 -> **16,121** (the shipped file had 3.7 % too many), 10 m cells >= 2 m 31,234 -> 27,710,
mean tree height 11.03 -> 11.23 m. Display only: the heat model's canopy blend strength is 0.

## Gates

`npm run check`, `npm run typecheck`, `npm run test:py`, `npm run test:unit` (after a build), `npm run check:fresh`, the Amsterdam e2e (foreground,
`OBOS_E2E_PORT=4737`): see the PR description. `check-existing-cities-unchanged.py` now pins Canal Ring as well as the six Kolkata and Bengaluru wards; the six are byte-identical to
the baseline taken at f0eeaa5f.
