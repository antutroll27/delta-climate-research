# Building heights in Dubai: every open source, measured against the same tower

Compiled 2026-08-27. Six research lanes plus direct measurement.

Every candidate below was tested the same way: **what does it say Burj Khalifa is?**
It is 828 m. It has been 828 m since 2010. It is arguably the best-documented
structure on Earth. A height dataset that cannot see it cannot see Dubai.

That single question sorted the field faster than any licence table.

---

## The answer, in one column

| Source | Resolution | What it makes of Dubai's skyline | Licence |
|---|---|---|---|
| Microsoft 2026 density/height | 76 m/px | Burj Khalifa reads **9.0 m** | CDLA-Permissive-2.0 |
| GBH2020 (GEDI lidar) | 150 m | max **45.9 m** in our window | CC BY 4.0 |
| GHS-BUILT-H R2023A | 100 m | Burj Khalifa cell reads **22.3 m**; max 97.3 m | CC BY 4.0 |
| GHS-OBAT R2024A | per-building *point* | **the same 100 m grid**, resampled — see trap below | CC BY 4.0 |
| GBHM | 10 m | max **56.6 m** | CC BY 4.0 |
| GlobalBuildingAtlas | 3 m | max 126.8 m over 697k UAE buildings | **CC BY-NC 4.0** |
| 3D-GloBFP v1 **and v2** | per-building | max **144.4 m**; nearest record to Burj centroid 31–55 m | CC BY 4.0 |
| WSF3D | 90 m | max **667.2 m** — the only one that sees towers | CC BY 4.0 |
| OpenStreetMap | per-building | correct where present; **12 % coverage** | ODbL 1.0 |
| OpenBuildingMap (GFZ 2025) | per-building | **Burj Khalifa 828.0 m**; 2,201 metric heights | ODbL |

**This is not ten bad datasets.** Buildings over 30 m are roughly 1 % of every
training corpus in the field, so every learned model regresses toward the mode.
Dubai — where the mode is a 17 m villa and the tail runs to 828 m — is the
pathological case for the entire literature.

And it cannot be fixed by retraining. **The labels you would need are the labels
you are trying to produce.**

---

## The traps

**GHS-OBAT looks like the answer and is not.** Per-building geometry, 253,323
records in our window, CC BY 4.0. But the JRC's own R2024A documentation lists
`Height <- GHS-BUILT-H R2023 V1.0`. It is the 100 m grid sampled at building
centroids. Same 97.31 m maximum. Points, not polygons. A per-building *container*
for a per-cell *estimate*.

**3D-GloBFP v2 is a coverage patch, not a model fix.** Released Dec 2025, and
the obvious hope was that the ceiling had moved. Measured: **144.05 m against
v1's 144.0 m.** The changelog says it "supplements building footprints and height
attributes for some countries."

**"AW3D30 is CC BY 4.0" is repeated widely and appears to be wrong.** JAXA uses
bespoke terms, not Creative Commons, and the operative text could not be
retrieved from a primary source. v4.x additionally inherits Copernicus
attribution obligations.

**Overture adds footprints, not heights.** It carries ~46,000 more buildings than
raw OSM in our window (250,318 vs 204,687) and **not one additional height**.
Verified by per-feature source attribution: all 3,246 heights are
`dataset=OpenStreetMap, licence=ODbL-1.0`. Zero from any CC BY source — so there
is no permissive subset to fall back to, and the share-alike applies to **100 %**
of the height layer.

**Wikidata's geospatial query returns buildings that were never built**, at full
proposed height. Dubai City Tower, 2,400 m. Nakheel Tower, 1,400 m. Both
cancelled. Unfiltered, they put a 2.4 km spike in the skyline.

---

## The constant that was quietly wrong

Only ~1.4 % of Dubai buildings carry an explicit `height` tag, but ~26 % carry
`building:levels`. Levels are therefore the largest source of grounded height
information we have, and the conversion constant matters more than any dataset
choice.

Ours was **3.2 m/storey**. It came from the **National Building Code of India**,
via a script written for Kolkata where it is honestly labelled an assumption. It
was carried into Dubai unchanged. It is not an OSM convention either — the OSM
wiki says 3 m.

### The circularity trap

The obvious calibration is to take buildings tagged with *both* height and
levels and fit the ratio. In Dubai there are 2,803 of them.

**Two-thirds are circular.** 38.7 % have height exactly `levels × 4.0`, 14.1 %
`× 5.0`, 7.9 % `× 3.0` — a mapper computed one field from the other. Fitting on
those produces a constant that agrees with itself. A first pass here did exactly
that and reported an MAE of 4.49 m, which was not a measurement of anything.

Excluding round multiples leaves 938 genuinely independent buildings:

| rule | bias | MAE | within 10 m |
|---|---|---|---|
| 3.2 × n (the Indian constant) | −20.51 m | 21.63 m | 26.5 % |
| 3.0 × n (OSM wiki) | −25.21 m | 26.10 m | 26.8 % |
| 4.0 × n | −1.71 m | 9.55 m | — |
| **per-use table (shipped)** | **−1.88 m** | **9.85 m** | **69.1 %** |

### The corroboration that made it credible

Dubai South's own **Residential District Planning Regulations** publish maximum
height *and* maximum floors per sub-zone. Dividing one by the other across zones
Ha–He gives **3.99 m/floor**. Our OSM regression gave **3.98**.

Two sources sharing no data, agreeing to two decimals.

Both documents also define height the same way — *finished sidewalk to top of
roof parapet* — which is precisely OSM `height` semantics. So there are two
different numbers and mixing them biases everything:

- floor-to-floor, structural: **~3.8 m**
- effective m/storey to reach the roof: **~4.0 m** (absorbs the taller ground
  floor and the 0.9–1.1 m parapet)

We render roofs. We want 4.0.

### Warehouses break the model entirely

For a logistics shed, one "storey" *is* the building, so `levels × anything` is
the wrong shape of formula. Published figures:

- JAFZA's own brochure: *"Warehouses eaves height varies from 6m to 12m"*
- A Dubai South Grade-A facility: *"usable eaves height of 16 metres"*
- MBR Aerospace Hub guidelines: light industrial capped at *"G+1 / 8m"*

Our Dubai South median building is 16.8 m. A flat 3.2 m rendered it as a 3.2 m
shed. These now use a per-class height prior, not a multiplier.

---

## Doors closed, with the licence text that closes them

Recorded so nobody spends a week reopening them.

**No finer open DSM exists for the UAE.** Copernicus EEA-10 (10 m) is 39 European
countries and restricted to public authorities. TanDEM-X 12 m and 90 m are
*"granted for scientific use"* with commercial rights held exclusively by Airbus
as WorldDEM. There is no national UAE open DEM.

**No open stereo photogrammetry.** ESA Third Party Missions: *"Users must use the
TPM Data solely for non-commercial purposes."* Copernicus Contributing Missions
are granted per user category, not openly. PGC EarthDEM is closed by the NGA EOCL
licence. ASTER is open but 15 m — one pixel of disparity error is 25 m of height.

**Spaceborne lidar cannot validate urban heights.** ICESat-2 crosses our window
on **6 fixed ground tracks** — ~89 % of built cells never sampled in eight years.
GEDI has coverage but no urban vertical signal: r² = 0.058, Burj Khalifa reads
62.5 m, and NASA's own L2B flag invalidates shots where `urban_proportion ≥ 50`.

**Copernicus DEM commercial use IS permitted** — licence Articles 3–6, no
non-commercial clause, *"worldwide and without limitation in time"*. From 28 July
2026 the CDSE 30 m **view service** is restricted to authorised users; the AWS
Open Data mirror remains anonymous and is what this pipeline uses.

---

## What is left

**Sentinel-2 shadow-length inversion.** `h = L·tan(θ)`, and the sun geometry is
in every scene's metadata. Measured opportunity rather than assumed: 66 low-cloud
scenes per year over Dubai, sun elevation 38.5°–73.2°, and **60–88 % of large
buildings have at least one acquisition where the shadow falls on open ground and
is at least 3 pixels long.**

Precision at 10 m pixels, from geometry: ±8 m in late December, ±33 m in June.
Winter buys precision, summer buys room.

No published shadow-derived accuracy figure exists at 10 m for any Gulf city. The
current state-of-the-art paper caps its own test set at 30 m and says plainly
that *"buildings with a height > 30 m show very large RMSE."*

Its error bar is the open problem, because the obvious validator — spaceborne
lidar — is ruled out above.

**Two leads that need a human, not a crawler:**

- **CTBUH** publishes 597 completed Dubai buildings with height and coordinates.
  Its FAQ grants *"public use… if applicable citations"* while also saying *"We
  do not share our information in any tabular formats"*, and its robots.txt
  reserves the EU database right. Facts are not copyrightable; a database may be.
  This needs an email, not a scraper.
- **Dubai Pulse** hosts `dm_building_floor_level_information-open` — per-building
  floor counts for the entire city, which would be the single best height proxy
  available. **Geo-blocked**; unreachable from every network path tried. Somebody
  physically in the UAE could settle it in five minutes.

---

## The honest summary

We have real, correct heights for about **12 %** of Dubai's buildings. The other
88 % carry a prior — now a defensible one, calibrated on the city's own data and
corroborated by its own planning code, with an expected error of **about ±9 m**
and no Gulf validation study anywhere in the literature to check it against.

That is worth stating precisely rather than rounding up. A render where three
quarters of the buildings carry an invented height looks more finished and is
less true.
