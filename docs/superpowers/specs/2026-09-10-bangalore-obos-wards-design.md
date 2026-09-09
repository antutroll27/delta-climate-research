# Bangalore OBOS wards — design

**Date:** 2026-09-10
**Status:** design, approved for planning
**Scope:** three Bengaluru wards through the OBOS ward pipeline, at 2.8 km with a 384-cell grid

## What this is, and the standard it is held to

Bangalore is the twin's **second city**. Kolkata's three wards were built by a
pipeline that assumes one city, one grid size and one set of thermal constants;
this spec adds a city that breaks all three assumptions, and says exactly how far
the evidence reaches.

The founder's standard, verbatim: *"as accurate as possible from our end — does
not need to be perfect, we shall eventually seek real data once investors and
politicians are impressed."* So the bar is **every layer defensible and every
limit written down**, not every layer measured. Where a number is estimated, the
artefact says so; where two sources disagree, the disagreement is published
rather than averaged away.

---

## 1. The three wards

Chosen after measurement moved the ground twice. Every figure below was measured
during design, not quoted.

| | Indiranagar | MG Road / CBD | Whitefield |
|---|---:|---:|---:|
| centre | 12.9784 N, 77.6408 E | 12.9755 N, 77.6030 E | 12.9698 N, 77.7500 E |
| built fraction | 25.7 % | 25.0 % | **19.2 %** |
| building height p50 | 7.1 m | 8.2 m | 8.2 m |
| building height p90 | 11.4 m | 18.7 m | **19.7 m** |
| share ≥ 15 m | **3.3 %** | 15.5 % | **19.7 %** |
| terrain relief | 49.1 m | 62.8 m | 59.7 m |
| OSM buildings | **12,938** | 8,947 | 7,844 |
| OSM named | 298 | **450** | 161 |
| OSM `building:levels` | 1,177 | 556 | 191 |
| OSM water features | 8 | **29** | 9 |
| UT-GLOBUS buildings | 10,654 | *(tile 1, see §4)* | 7,813 |
| Overture footprints **built** | **14,867** | 11,045 | 10,897 |
| BBMP census trees (1 km) | **7,543** | *(not measured)* | 1,871 |
| CTBUH landmarks | **0** | **5** (4 with a height) | **0** |

**Three different urban forms, not three samples of one.** Dense low-rise under
heavy canopy; a mixed downtown holding every citable landmark and the most water;
sparse but tall, on tank-dense ground. That contrast is the thermal story and the demo at
once.

**Koramangala was dropped.** It passes every data gate, but it has no citable
landmark, and MG Road is the only area in the city that does.

**MG Road's centre is offset 300 m west of the nominal junction, deliberately.**
At the obvious centre (77.6060 E) the box ends at 77.5931 E and **Vidhana Soudha
falls 271 m outside it** — the one building in Bangalore everybody recognises,
excluded by a rounding-scale choice. Re-measured at 77.6030 E the box gains it and
loses nothing: built fraction, p50 and p90 are identical to the first decimal, the
tall share moves 16.0 % → 15.5 %, relief rises 59.6 → 62.8 m, and OSM buildings
rise 8,340 → 8,947 with water features 19 → 29. Subhas Chandra Bose Tower, the
easternmost landmark at 77.6099 E, stays comfortably inside. **Every MG Road figure
in this document is measured at the shifted centre**, and the box is still wholly
inside one UT-GLOBUS tile (§4).

### Ward naming — pin the 2025 geometry

**Bangalore's wards moved and most published data has not caught up.** The
lineage is 198 wards (2014 delimitation, built on Census 2011) → 243 proposed →
225 under the never-implemented BBMP Act 2020 → BBMP abolished under the Greater
Bengaluru Governance Act → **369 wards across five corporations, notified
19 Nov 2025**.

So the ubiquitous "Census 2011 joined to 198 BBMP wards" product is two
reorganisations stale, and wrong in the way that produces plausible-looking ward
rankings. Every ward name gathered during design — *Hoysala Nagara Central*,
*Ashokanagar* — came from the **old** OSM `admin_level=10` layer.

**Rule: the ward layer is pinned to GBA-2025 (369 wards), and any population
attached to a ward is re-derived onto that geometry, never inherited from a
198-ward join.** The current layer is the OpenCity dataset
`gba-wards-delimitation-2025`, publisher Greater Bengaluru Authority. Each OBOS
ward's `body` field names the GBA-2025 ward it sits in, resolved during
implementation from that layer — the way Ballygunge cites KMC Ward 68.

---

## 2. The grid: 2.8 km at 384 cells

Kolkata is 1.4 km at 192 cells, giving 7.29 m cells. Bangalore is **2.8 km at
384 cells, giving the same 7.29 m cells.**

**Why 2.8 km and not 1.4 km.** Measured over concentric boxes, a 1.4 km core is
representative of Indiranagar but not of the others. Koramangala's towers sit on
its edges; **Whitefield diverges and keeps diverging** — its share of buildings
≥15 m runs 14.8 % at 1.4 km, 19.7 % at 2.8 km, 22.9 % at 4.2 km. For Whitefield a
small box is not less accurate, it is the wrong place. 2.8 km also roughly *is*
the administrative ward (measured extents: Hoysala Nagara Central 2.0 × 1.8 km,
Kormangala East 2.3 × 1.6 km — OSM's own spelling — and Whitefield 3.7 × 2.8 km), so the unit can honestly
be named as one. And it holds 784 Landsat thermal pixels against 196, roughly
doubling within-ward validation power.

**Why 384 and not 192.** At 192 cells a 2.8 km box gives 14.6 m cells — a block
fragment, not a building. 384 keeps parity with Kolkata's resolution.

**The cost is measured, not assumed.** The WebGL2 solver is fully parameterised
(`this.n = grid.n`, texel `1/n`, textures sized to the grid); nothing bakes in
192. The CPU fallback was timed: **0.123 ms/step at 192, 0.500 ms/step at 384**,
a 4.06× ratio exactly as the O(n²) stencil predicts. The app requests 80 steps
per advance, so the worker fallback moves from ~10 ms to ~40 ms per advance —
**off the main thread**, so the map holds 60 fps and the simulation merely settles
more slowly on devices without float render targets.

**The contract changes from a constant to a set.** `CANONICAL_GRID_N = 192` and
`isCanonicalGrid()` currently admit one value, and `sim-protocol.ts` throws
`'The heat model requires the canonical grid.'` on anything else. Both become a
set of admitted `(n, sizeM)` pairs: `(192, 1400)` for Kolkata, `(384, 2800)` for
Bangalore. **The pair is validated together** — an `n` without its matching
`sizeM` is the bug this guards against, because it silently changes what a cell
means while every array length still checks out.

---

## 3. Data stack

Every layer below is commercially usable. Licences were read, not assumed.

| layer | source | licence | status |
|---|---|---|---|
| Footprints | Overture Maps 2026-07-22.0 | ODbL | measured: 7,531 / 6,394 in test boxes |
| Heights (primary) | Google Open Buildings 2.5D Temporal v1 | CC BY-4.0 **or** ODbL | measured, 8 epochs, latest 2023-06-30 |
| Heights (cross-check) | UT-GLOBUS (UT Austin, *Sci Data* 11:617) | CC BY-4.0 | measured, 774,118 buildings, 100 % height coverage |
| Canopy | Meta/WRI CHM **v1** (`alsgedi_global_v6`) | CC BY-4.0 | measured at the *candidate* sites, see note |
| Tree species | BBMP Tree Census, July 2026 | see §6 | measured: 702,109 trees |
| Water | ATREE-CSEI Lakes & Streams of Bengaluru Urban | **CC-BY** | 181 lake polygons, 3,927 stream lines |
| Land cover | KGIS `State_LULC_2023` ArcGIS REST | see §6 | live, feature-level, verified at all sites |
| Terrain | Copernicus GLO-30 | ESA/Airbus free-and-open, commercial OK | measured: 49–63 m relief per ward |
| Ground texture | Sentinel-2 L2A | Copernicus free-full-open, commercial OK | ample cloud-free cadence; **mosaic 43PGQ + 43PHQ** |
| Live weather | NOAA GHCNh | US public domain | 3 stations, 4-day latency |
| Air quality | data.gov.in CPCB feed | **GODL-India** | 9 stations city-wide, hourly |
| LST validation | Landsat 8/9 C2 L2 | USGS public domain | 42 scenes < 20 % cloud in 24 months over the ward boxes |
| LST validation | ECOSTRESS `ECO_L2T_LSTE` via LP DAAC | NASA open | **214 overpasses, all 24 local hours** |

**The canopy percentages are not yet per-ward.** Meta CHM v1 was sampled while the
shortlist was still Indiranagar, Koramangala and Whitefield, giving 33.9 / 23.5 /
23.2 % cover at ≥3 m. **Indiranagar's 33.9 % is the figure that carries forward**;
MG Road was never sampled, because it was not a candidate at the time. Per-ward
canopy fraction for all three is measured during implementation, before any figure
is quoted.

### The layers that matter most, and why

**Terrain does real work here, unlike Kolkata.** 49–63 m of relief across every
ward box. Bangalore's valley and tank-chain topography is genuine
and 30 m posting resolves it. GLO-30 agrees with NASADEM to within 1.3–3.2 m, far
tighter than the ~6 m bias the Kolkata twin carries.

**Water is the local signature.** ATREE's layer carries a **`Valley`** field —
the tank-chain system (Vrishabhavathi, Koramangala-Challaghatta, Hebbal). Nothing
else found carries it, and it is the attribute that makes Bangalore's water read
as a system rather than scattered ponds. Named lakes sit 0.4–1.0 km from each
ward centre.

**ECOSTRESS is the evidential upgrade.** 214 unique overpasses in 24 months, 88
day and 126 night, spanning **all 24 local hours** — the ISS orbit precesses where
Landsat is locked to ~10:30 local. OBOS's night regression is real but was never
separably validated in Kolkata. This is what could make a night claim defensible.

**The UHI signal is already in the free data.** Paired by local hour across 2026,
the in-city IMD observatory minus the northern airport is **+1.12 K at night and
+0.45 K by day** — night greater than day, urban greater than rural, the textbook
canopy-layer signature. A tier-1 sanity check available on day one.

---

## 4. Heights: two sources, and the disagreement is the deliverable

**Google 2.5D is primary. UT-GLOBUS is a measured cross-check, not a blend.**

This is the first time the project has had two independent per-building height
estimates for the same city. Blending them would manufacture a number neither
source states and would hide disagreement exactly where it is most informative,
so the pipeline **flags** instead.

### The measured agreement

Sampled at building centroids, 385 and 373 buildings:

| site | UT-GLOBUS p50 | Google p50 | MAE | correlation | disagree > 5 m |
|---|---:|---:|---:|---:|---:|
| Indiranagar | 8.0 m | 5.3 m | 4.00 m | **+0.176** | 26.0 % |
| Whitefield | 7.0 m | 5.0 m | 3.60 m | **+0.815** | 18.5 % |

**These p50s are not the p50s in §1, and that is not a contradiction.** §1 reports
the Google 2.5D median over every built pixel in the 2.8 km box; the table above
reports it over the few hundred building centroids that UT-GLOBUS and Google both
resolve. A centroid sample of shared buildings is a different population from a
pixel census, so the two medians differ by design. **Never quote one as the other.**

**The two correlations do not mean the same thing, and the spec must not pretend
they do.** Whitefield's +0.815 is a genuine cross-validation: real height variance,
two independent methods tracking it. **Indiranagar's +0.176 is largely an
artefact** — when almost every building is 5–8 m there is little variance to
correlate and the statistic measures noise. **MAE is the honest number there, and
4.0 m on an 8 m building is 50 %.**

**UT-GLOBUS reads systematically 2–3 m higher at both sites.** Neither source has
Indian validation, so which is right is unknown. That offset is now a measured,
publishable uncertainty band rather than an unknown.

### BUILT 2026-09-10, and the built heights do not match §1

The pipeline now exists (`scripts/fetch-bangalore.py`) and has run over all three
wards. **Its per-building heights are materially lower than the pixel-census
figures in §1, and the gap is much larger than the p50 note above prepares a
reader for.**

| | §1 pixel p50 | built p50 | §1 ≥15 m | built ≥15 m | fill |
|---|---:|---:|---:|---:|---:|
| Indiranagar | 7.1 m | 6.5 m | 3.3 % | **0.8 %** | 2.3 % |
| MG Road | 8.2 m | 6.6 m | 15.5 % | **3.7 %** | 3.2 % |
| Whitefield | 8.2 m | 5.6 m | 19.7 % | **5.1 %** | 4.6 % |

**Both are correct measurements of different things, and the tall share is where
that stops being a footnote.** §1 takes percentiles over *built pixels*, where
every pixel of a tower is a tall pixel. The pipeline takes the zonal **p65 over
each footprint**, which mixes a tower's tall core with its podium, courtyards,
annexes and edge pixels — and averages down. Kolkata's `compute-heights.py`
documents exactly this bias and offers p75 as the candidate fix, decided there by
`validate-heights.py` against OSM evidence.

**Bangalore ships p65 for parity with Kolkata, and p75 is untested here.** Two
cities computed the same way are comparable; two computed differently are two
projects. But the consequence must be stated plainly: **the massing renders a
lower skyline than the pixel census implies**, and any claim about tall-building
share must say which of the two numbers it is quoting. Maxima are unaffected and
look right — 91.3 m in MG Road, 89.8 m in Whitefield, 40.0 m in Indiranagar.

**Fill rates came in better than Kolkata's**, at 2.3 / 3.2 / 4.6 % against
Kolkata's shipped 4.0 / 6.5 / 10.8 %. Google's coverage over Bengaluru is
stronger than over Kolkata, so fewer buildings fall back to the 2.5 m convention.

**The cross-check at full scale is tighter than the design sample suggested.**
Against every matched building rather than a few hundred centroids:

| | matched | MAE | flagged > 5 m |
|---|---:|---:|---:|
| Indiranagar | 2,274 | **3.12 m** | 391 |
| Whitefield | 2,532 | **3.13 m** | 295 |
| MG Road | — | — | **skipped, recorded** |

Indiranagar's MAE improves from the 4.00 m of the design sample to 3.12 m, and
the two wards now agree with each other almost exactly. **MG Road skipped and
said so**, which is the §11 failure mode working as specified rather than a gap.

### Design

1. Height comes from Google 2.5D, joined to the Overture footprint by GERS id —
   unchanged from Kolkata, so the pipeline stays one thing.
2. UT-GLOBUS height is attached to the same record as a second field.
3. Where the two disagree by **more than 5 m**, the building carries a flag and a
   widened uncertainty band. It is not corrected and not averaged.
4. The artefact publishes the per-ward agreement statistics above, so a reader
   can see how much of the ward is in disagreement.

### Known weaknesses of each, stated up front

- **Google 2.5D**, from its own documentation: *"The mean absolute error of
  building height prediction is 1.5 metres and was only evaluated in North
  America, Europe and Japan… heights prediction might not be as good in the Global
  South."* The nearest independent check (Nairobi, Kathmandu, Quito) measures
  1.2–3.34 m MAE. That still makes it the best-validated option available.
- **UT-GLOBUS** is **integer metres with only 122 distinct values city-wide**,
  mean 6.87 m — it under-resolves mid-rise. Its predictors include WSF-3D, which
  has no coverage in this region, which likely explains the flat distribution.
  Validation is US LiDAR only: RMSE 9.1 m per building. City-wide **max is 492 m,
  an artefact that must be clipped, and minimum is 0.0 m** — zero-height rows are
  present and must be dropped before any comparison, not treated as flat ground.
  The five commonest values are 7, 5, 4, 6 and 8 m, together 58 % of the city.

### Tile trap

**UT-GLOBUS splits Bangalore across two tiles**, and the split falls between our
wards. `Bangalore_2` spans 77.6187–77.9799 E and covers **Indiranagar and
Whitefield**. **MG Road at 77.6030 E falls in `Bangalore_1`** (77.2018–77.6218 E),
which is not yet fetched. Its whole 2.8 km box (77.5901–77.6159 E) sits inside
`Bangalore_1` with 59 m of margin at the eastern edge, so one additional tile
suffices. **The westward shift in §1 widened that margin rather than narrowing
it** — the box moved away from the seam, not toward it.

This is exactly the failure the design is built to catch. When the shortlist changed,
the cross-check for the new ward returned **zero buildings** and would have read as
"no disagreement" rather than "no data". §11 makes that outcome a recorded skip.

**Packaging gotcha:** `Asia.zip` uses **Deflate64** (method 9). `bsdtar` and
Python `zipfile` both fail on it; Info-ZIP `unzip` works. Zenodo's own description
warns of a "corrupt zip" — this is why.

---

## 5. Landmarks: MG Road only, and RERA is the route for the rest

**CTBUH has 26 Bengaluru entries, of which 19 carry a non-zero architectural
height. Five fall in MG Road/CBD and zero in Indiranagar, Koramangala or
Whitefield.** Nearest CTBUH building to each: Indiranagar 3.4 km, Koramangala
4.6 km, Whitefield 7.2 km — in every case the same building, Subhas Chandra Bose
Tower on MG Road. Bangalore's high-rises cluster north-west and south, not in the
east/south-east tech belt.

**Wikidata is a total zero.** Verified three ways — SPARQL by administrative area,
SPARQL by 30 km radius, and direct entity dumps on every named candidate.
**P2048 height claims for Bangalore buildings: zero.** UB City, Bagmane Tech Park,
ITPB and Vidhana Soudha all exist as items and none carries a height. The Dubai
playbook does not transfer.

### Citable in MG Road/CBD

**Four of the five CTBUH entries in the box carry a height. The fifth does not, and
Vidhana Soudha is not a CTBUH entry at all** — it reaches us from its Wikipedia
infobox. Conflating those two facts is how a five-row CTBUH count turns into a
five-row height table that is really four.

| building | height | floors | source |
|---|---:|---:|---|
| UB Tower | 123 m | 20 | CTBUH 13883 |
| UB City Concord Tower | 115 m | 20 | CTBUH 13884 |
| Public Utility Building (Subhas Chandra Bose Tower) | 106 m | 25 | CTBUH 4991, completed 1973 |
| UB City Canberra Tower | 105 m | 18 | CTBUH 13885 |
| Vidhana Soudha | 45.7 m | 4 + 1 basement | Wikipedia infobox `{{cvt|150|ft}}` |

The Public Utility Building is also the city's first high-rise over 100 m, which is
worth carrying as provenance rather than trivia — it is why MG Road has a skyline
at all.

### Rows that must be refused

- **Trump Tower / "Bangalore 47", 165 m** — CTBUH status `VIS` (Vision), **no
  coordinates at all** and completion year `0`. Unbuilt. It is the **top row of
  CTBUH's height-sorted list**, so a naive scrape takes it first, and its missing
  coordinates mean a spatial filter silently drops it rather than rejecting it —
  the right outcome for the wrong reason.
- **Prestige Khoday Tower** — inside the MG Road box, CTBUH status `COM`, 17
  floors, completed 2014, and **architectural height `0`**. It is the fifth of the
  five, and a pipeline that reads height without checking for zero places a
  17-storey building flat on the ground.
- **Kingfisher Towers, 122 m** — Wikipedia cites CTBUH id 19745, which is
  **1201 South Grand Avenue, Los Angeles**. CTBUH returns zero hits for
  "Kingfisher". Not citable; only its floor count and coordinates survive.
- **Zenith Residence Towers** — CTBUH's own page states *"this height is
  estimated, based on a floor count of 34 floors."* Derived, not measured.

### Whitefield's towers are all under construction, and RERA is the only route

Wikipedia's under-construction table sources heights from **Karnataka RERA
elevation drawings** and annotates each row `As per RERA` or `Unverified`. A RERA
filing is an official government document and meets the citation bar. It is the
only route that reaches Whitefield at all:

| towers | height | floors | locality tagged |
|---|---:|---:|---|
| Godrej Woodscapes L, M, N | 120.4 m | 40 | Whitefield |
| Alembic Cloud Forest A, B, C | 105.7 m | 35 | Whitefield |
| Prestige Park Grove Tower 17 | 128.55 m | 42 | **Kadugodi**, not Whitefield |

**Park Grove is the trap in that table.** It is the tallest of the three and the
one most likely to be reached for, and the article tags it Kadugodi — adjacent to
Whitefield but plausibly outside a 2.8 km box centred at 77.7500 E. **Its
coordinates are resolved and tested against the box before it is used**, the same
containment check that moved MG Road's centre in §1.

**RERA heights are frequently to the HELIPAD, not the roof.** Wikipedia's own
editors record it in hidden comments beside the figure — Mantri Centrium: *"As per
the RERA elevation diagram, the height of the helipad is 122m. Height of terrace is
112.9m."*; Pashmina Waterfront: *"Total structural height is 124.75m. Height of
terrace is 117m."* **The datum lives in an HTML comment, so any scrape of the
rendered page loses the caveat and keeps the number**, over-extruding the massing
by ~10 m in a way that still looks plausible. **Any RERA height entering a recipe
must record which datum it is, and a height with no stated datum is not used.**

### Forms that need authored massing

Only where the plan genuinely encodes the building, per the rule established on
Dubai. Candidates — all three inside the MG Road box, and the first only because of
the westward shift in §1: **Vidhana Soudha** (Neo-Dravidian, stepped
central dome — nothing survives extrusion), **UB City** (four towers of differing
heights over a shared podium; a complex, not four prisms), and
**M. Chinnaswamy Stadium** (enclosed circular bowl). Each is a separate decision
against a measured plan, and any that does not encode its own form stays an
extruded outline at its cited height — the Museum-of-the-Future precedent.

---

## 6. Excluded, and why

Recording these is the point. Each looks usable and is not.

### Licence walls

- **KSRSAC / K-GIS 50 cm imagery** — the only sub-metre imagery covering Bangalore
  comprehensively. Terms state verbatim: *"Under no circumstances data will be
  used for any commercial purposes by anyone"* and *"shall not be used for any
  legal purpose."*
- **Bhuvan / NRSC** — the Bhoonidhi EULA permits derivative works but excludes
  *"Internet based hosting"* explicitly, which is precisely what a web 3D scene
  is. Registration required, single-user, non-transferable.
- **Cartosat stereo (the DIY nDSM route)** — under the **Indian Space Policy
  2023**, data finer than 5 m is free only to government entities and is priced
  via NSIL for everyone else. Cartosat-1 2.5 m stereo is not open to a private
  consultancy. Only CartoDEM 30 m is free, and it is terrain, not buildings.
- **FABDEM** — **CC BY-NC-SA 4.0**. *"Non-commercial use only — commercial
  applications are prohibited."*
- **GlobalBuildingAtlas heights** — **CC BY-NC 4.0**. Its commercially-usable ODbL
  tier has **no height field at all** (verified by byte-ranging the Bangalore
  tile: properties are only `source`, `id`, `region`).
- **IMD direct** — the Certificate of Undertaking states *"The data shall not be
  used for commercial purpose"* and *"will not be put on Internet."* The same
  observations reach us free and public-domain via NOAA GHCNh.
- **Open-Meteo free tier** (non-commercial) and **WAQI** (no redistribution of
  cached data) — already known, reconfirmed.

### Right licence, wrong data

- **GHS-OBAT** and **OpenBuildingMap** — both advertise per-building heights on
  billions of footprints under open licences. Both derive them by zonal statistics
  from **GHS-BUILT-H at 100 m**, the layer already rejected. GHS-OBAT's own
  validation is **MAE 2.88 m, r = 0.29**, and buildings under 100 m apart inherit
  identical heights.
- **GlobalBuildingAtlas heights**, on accuracy as well as licence: a published
  Indian evaluation including **Bengaluru** measures **ME −30.3 m, MAE 30.3 m,
  RMSE 41.8 m**, underestimating by ~6 m for every 10 m of true height.
- **Microsoft GlobalMLBuildingFootprints** — measured: **0 of 1,063,902 buildings
  in the India quadkey carry a height**; every record is `-1.0`.
- **Meta canopy v2** — nearly **doubles** cover against v1 at every site, and
  **61 % cover for Indiranagar is not credible** for a dense urban neighbourhood.
  That measurement alone is the rejection. Independent urban validations of the
  Meta layer are sobering in the same direction — against Milan's municipal tree
  register only about a quarter of heights land within ±5 m — see
  `docs/evidence/methods-and-papers.md`. **v1 is primary; v2 is not used until
  measured against v1.** This is the same shape as a hold-out that scores 100 % and
  means nothing.
- **NOAA ISD** — every Bangalore entry ends **2025-08-24**; the 2026 file returns
  404. Any recipe inherited from Kolkata that reads ISD stops in August silently.
  GHCNh replaces it.
- **Google Earth Engine's ECOSTRESS collection** — its metadata advertises a global
  bbox and current dates, and its description says verbatim: *"only tiles covering
  the Los Angeles metro area have been ingested."* **Anyone verifying by bbox and
  date alone concludes the opposite.** The LP DAAC/CMR route stays mandatory.

### The OpenCity licence position

`data.opencity.in` makes four inconsistent statements: per-dataset "Public
Domain", a site footer saying CC BY-NC-SA, terms saying non-commercial only, and
an FAQ clarifying that **posts** are CC BY-NC-SA while **data** is **ODbL**. The
FAQ is the authoritative disambiguation: the NC clause attaches to their editorial
posts, not the datasets.

**Position taken: the BBMP tree census and KGIS-derived layers are treated as
ODbL** — commercial use permitted, **share-alike attaching to any derived
database**. Where practical they are harvested from the **KGIS government REST
service** rather than the OpenCity copy. The founder has declined to seek written
confirmation at this stage; that decision is recorded here so it can be revisited
before any external publication of a derived database.

---

## 7. What the tree census is, and is not

**702,109 individual trees** with species and ward number — nothing like this
existed for Kolkata. Measured within 1 km: Indiranagar 7,543, Whitefield 1,871.

Two limits that change how it may be used:

1. **No girth, height or crown diameter.** Crown radius must be modelled from
   species. The artefact records that the radius is derived, not measured.
2. **Counts track enumeration effort, not tree density.** Only **144 of 198 wards**
   appear; per-ward counts run from 1 to 45,831; 13 wards hold fewer than 100
   trees; **24.3 % of trees are species "Others"**. It is an **inventory, not a
   density field**, and must never be used as one.
3. **Its ward field is the dead 198-ward scheme**, so it cannot be joined to the
   GBA-2025 layer by ward number — the §1 rule applies here too. **Trees are
   consumed by position, never by ward join**, which sidesteps the problem
   entirely and is the only reason this dataset is usable at all.

**So canopy fraction comes from Meta CHM v1 (a measurement), and the census
supplies species and position (an inventory).** The two answer different
questions and are not substitutes.

---

## 8. Blender's role

Blender is the **QA lens, not a data fork**. Scenes are built from the same
artefacts OBOS consumes, so the two cannot disagree. This inverts the Dubai
arrangement, where Blender scenes were the deliverable and OBOS could not read
them.

Its job here is to catch what automated gates cannot — the Dubai lesson, where a
landmark rendered as a marquee while every check passed: closed geometry, exact
height, no footprint moved. **Gates prove a scene is well-formed. Only looking
proves it resembles the city.**

### Wards are islands, not a map (decided 2026-09-10)

Each ward is a **self-contained island**: its own 2.8 km terrain closed with a
skirt and a base cap, its own `.blend`, its own `.glb`. The master file holds all
three side by side, ordered west to east, on even spacing.

**True geographic placement was built and rejected.** Measured, the wards sit
4.11 km apart (Indiranagar to MG Road) and 11.88 km on to Whitefield, so a
faithful layout puts two nearly touching and the third far off, with kilometres of
empty ground between carrying no data at all. It also forces a single continuous
terrain, because the 8.4 km context meshes of the two western wards overlap and
would z-fight across the whole overlap.

**Even spacing makes the three comparable, which is the entire point of putting
them in one file**; keeping the west-to-east order preserves the only part of the
real arrangement worth reading at a glance. The island is packaging — the ground
surface is the same measured GLO-30 mesh, and the skirt hangs below the lowest
real sample, so nothing about the landform changes.

The island also fixes an honesty problem the continuous version had. A ward drawn
on 8.4 km of surrounding ground **looks like a city that stops**, because
buildings exist only inside the box. An island ends on purpose, and shows the
study area exactly.

---

## 9. Ground texture, and the honest ceiling

**There is no openly licensed imagery at a resolution useful for texturing
building surfaces in Bangalore.** OpenAerialMap over the whole metro returns
exactly **one** record — a 669 × 537 m drone tile from 2022, **18.8 km from the
nearest ward**. The 50 cm state mosaic exists and is contractually closed.

**Sentinel-2 at 10 m is the ceiling**, and it is a ground-plane and context
texture, not a facade texture — a 30 m building is three pixels across. This is
the same wall Kolkata hit and recorded as *"no legal sub-metre imagery
pipeline"*. The procedural facade shader already shipped for Kolkata remains the
answer. **Bangalore is not an exception to this and the spec does not pretend
otherwise.**

---

## 10. The port surface

Bangalore is not a registry line. Four bounded areas of work:

1. **The grid contract becomes a set.** `CANONICAL_GRID_N`, `isCanonicalGrid()`
   and the `sim-protocol` guard admit `(192, 1400)` and `(384, 2800)`, validated
   as pairs.
2. **A city level.** The Country/City/Area switcher is still only a spec; Bangalore
   is the first second city, so it becomes real. Ward ids must be city-scoped —
   two cities will eventually both have a "Ward 1".
3. **Four scripts hard-code the Kolkata ward tuple** `("ballygunge",
   "barrackpore", "baruipur")`. These become a registry lookup.
4. **Browser load.** 8–13 k buildings per ward against Kolkata's ~4 k. The
   existing demotion tiers exist for this; the load is **measured before**
   anything is tuned.

The ~16 scripts carrying Kolkata **thermal** constants (ECOSTRESS, SUHII, PV
yield, the study bbox) are the validation tier and **follow rather than gate** —
a ward can render correctly before its thermal evidence is ported.

---

## 11. Failure modes

| failure | behaviour |
|---|---|
| a ward's `(n, sizeM)` pair is not in the admitted set | build fails naming both values — an `n` without its `sizeM` silently changes what a cell means while every array length still checks out |
| UT-GLOBUS tile missing for a ward | the cross-check is **skipped and recorded as skipped**, never silently absent. MG Road will hit this until `Bangalore_1` is fetched |
| Google 2.5D returns no confident pixel for a footprint | height is the documented fill with `fill: true`, carried openly — Google's own convention, already handled by `scripts/compute-heights.py`. Kolkata's shipped fill rates are 4.0 / 6.5 / 10.8 %; a Bangalore ward far outside that band means a coordinate mismatch, not a data gap |
| a landmark height has no stated datum (roof vs helipad) | it is not used. A ~10 m over-extrusion that looks plausible is worse than an omission |
| a landmark's coordinates fall outside the ward box it is cited for | build fails. Vidhana Soudha sat 271 m outside before the centre moved, and Park Grove may sit outside Whitefield; containment is tested, never assumed from a locality name |
| a cited height is zero or absent | the landmark is refused, not placed at ground level. Prestige Khoday Tower is a real CTBUH row with height `0` |
| ward geometry inherited from a 198-ward join | build fails. Population must be re-derived onto GBA-2025 |
| Sentinel-2 mosaic built from one MGRS tile | build fails; Bangalore straddles **43PGQ and 43PHQ** and a single tile leaves a seam across the city |
| ECOSTRESS granule count treated as clear-sky count | CMR exposes **no** cloud metadata for ECOSTRESS; cloudiness is read from each granule's own mask after download. 214 is an upper bound |

---

## 12. Testing

1. **Grid-pair validation.** `(384, 2800)` is admitted; `(384, 1400)` and
   `(192, 2800)` are refused. Mutation-checked — a test that cannot fail is not a
   test.
2. **Height cross-check statistics are reproduced** from the shipped artefact and
   match the per-ward figures in §4 within tolerance.
3. **The disagreement flag fires** on a known >5 m pair and does not fire on a
   known agreeing pair.
4. **Solver timing** at 384 is measured on the CPU path and asserted under a
   stated budget, so a future change that makes the fallback unusable is caught.
5. **Ward vintage.** Every ward record resolves to a GBA-2025 ward; a 198-ward id
   anywhere fails the build.
6. **Landmark datum.** Every landmark recipe carries `heightSource` **and**
   `heightDatum`; either missing fails.
7. **Landmark containment and sanity.** Every landmark's coordinates fall inside
   the box of the ward it is cited for, and every cited height is greater than
   zero. Both are regression-tested against the two cases that produced them:
   Vidhana Soudha at 271 m outside, and Prestige Khoday Tower at height `0`.

---

## 13. Deferred, deliberately

- **KSNDMC's 39 in-city temperature stations** at ~2 km spacing — the only route
  to a true intra-city air-temperature field. Locations are public domain; the
  observations are behind a login with no stated licence and would need a written
  request. **The founder has declined to pursue this now.**
- **Bellandur and Koramangala** as wards four and five. Bellandur has 523 named
  buildings and a lake with a story; Koramangala passes every gate but has no
  landmark.
- **Historical lake extents.** IISc published the numbers (379 water bodies in
  1973 → 246 in 1996) but not the digitised layers. This is a digitisation
  project, not a download.
- **Meta canopy v2**, until measured against v1.
- **Re-checking the GEE ECOSTRESS "Los Angeles only" note** each quarter. The day
  it changes, the pipeline simplifies from a bearer-token ingest to a one-line
  collection load.
