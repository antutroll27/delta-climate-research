# Review — the "hyper-accurate micro-topography" pipeline proposal (2026-09-02)

**What was proposed** (CEO email, 27 Aug): a four-step pipeline — (1) pyproj vertical-datum conversion of
a FABDEM/SRTM DEM from the WGS84 ellipsoid to EGM2008; (2) geopandas buffering of OSM centrelines by
highway class into lane polygons; (3) PostGIS per-vertex Z-snapping of building and lane polygons to the
DEM; (4) CesiumJS `CLAMP_TO_GROUND` rendering — followed by a Curve-Number-from-EVI/NDBI infiltration
table, a pyswmm drainage/pump/tidal simulation, and a Node/WebSocket bridge to the frontend. Stated goal:
eliminate floating geometry, get true MSL elevations, carve street lanes into the terrain, and prepare for
Hooghly tidal flood routing.

**Verdict:** two ideas to keep, three steps already built, one step that would corrupt the terrain, and a
stack we do not run.

## Keep

1. **Drainage-network modelling for Kolkata.** Kolkata floods as a *drainage-and-tide* problem — high
   Hooghly, lock gates shut, KMC pumps at capacity. Our flood solver (`feat/flood-sim`, built for Dubai) is
   2D overland routing with no pipe, pump or tidal outfall. A SWMM-class network model has all three. This
   is the right next flood step for Kolkata. **Blocker is data, not code:** the KMC drainage network and a
   Hooghly tide-gauge record are not open data — the same wall Dubai's storm network hit.
2. **Bare-earth DTM over surface model.** Correct, and already done: flood work moved to **GEDTM30 v1.2**
   (ICESat-2 + GEDI, CC BY 4.0, MAE 1.49 m on our window) with DeltaDTM. The proposal's FABDEM is behind
   that and is CC BY-NC-SA — ruled out twice in `data-sources.md`.

## Already built

- **Road width by class** — `road-ribbon.ts`, derived from an Overpass survey of the 447 ways in our wards
  (22/24 primaries carry 4 lanes → 14 m), not assumed radii. There are no motorways in any ward.
- **Terrain draping** — `relief-renderer.ts` samples the DEM at each building's centroid; roads, water,
  canopy and clouds take `groundAt` per vertex. Nothing floats. Per-vertex Z on a *building* would give it
  a sloping floor; one ground height per footprint is correct.
- **A flood solver with lessons paid for** — runoff *generation* was the defect, an invented SCS storm was
  3× too peaky, and infiltration constants did not need changing. Threshold Curve Numbers (0.4/0.2/0.3)
  are the same class of invented parameter.

## Would break things

- **Step 1 double-corrects the datum.** FABDEM and Copernicus GLO-30 are *already* EGM2008 orthometric.
  Applying ellipsoid→geoid to them shifts Kolkata by the local geoid height (~55 m over the Bengal basin)
  against a total ward relief of 3–5 m. And across a 1.4 km ward the geoid is a constant — one number, not
  a per-pixel transform.
- **The datum is the wrong term.** Best DTM error ~1–1.5 m; the shipped surface model sits 6.55 m above
  ICESat-2 laser ground; ward relief 3–5 m. "A 3 m surge translates perfectly" is not true on any DEM we
  hold. Same shape as the P90 discussion: a centimetre term polished next to a metre term.
- **`COALESCE(ST_Value(...), 0)`** plants any nodata vertex at sea level silently.
- **The stack.** PostGIS + CesiumJS + Node/WebSocket = three runtimes for a static site whose sim runs in
  a browser worker. Cesium was surveyed 2026-08-09 and set aside; adopting it is a renderer rewrite. A SWMM
  run is seconds — deliver precomputed scenario JSON, as the PV artifacts do.
- **pyswmm script as written** passes 150 mm/hr into `generated_inflow` (expects a flow rate) and assumes
  the `.inp` network exists — which is the entire job.

## Next step (proposed, not started)

A design note for a **Kolkata drainage model**: SWMM-class, KMC pumping stations and a Hooghly tidal
outfall as first-class objects, precomputed scenarios shipped as JSON. Two data asks first: the KMC
drainage network and a Hooghly tide-gauge record.
