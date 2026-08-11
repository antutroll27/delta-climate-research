# Data sources

Every dataset the engine touches — in production, in validation, or evaluated and rejected. Licence,
resolution, role, and status per entry. The **ruled-out** section carries the reason for each
rejection; it is the diligence trail, not a scrap heap.

> Compiled from `docs/research/`, the vegetation + terrain specs, `green-score-methodology.md`,
> `data/opencity/manifest.json`, and project memory. Licences taken as-found — reconfirm before relying.

---

## Datasets in use

**Sentinel-2 L2A (NDVI)** — Copernicus/ESA optical · 10 m, ~5-day revisit, current · **Copernicus open
licence — commercial use explicitly permitted** · via Element84 earth-search STAC API (`sentinel-2-l2a`
collection), `https://earth-search.aws.element84.com/v1`; terms
`https://sentinels.copernicus.eu/web/sentinel/terms-conditions` · **role:** NDVI thermal correlator,
feeds `veg[]` (Tier-1 vegetation input) · status: shipped, unchanged.

**Meta / WRI 1 m Canopy Height Model (CHM) v2** — Meta AI + WRI, derived from ~2018–2020 Maxar imagery +
neural height model · 1 m, single-epoch ~2018–2020, MAE "a few metres," known ~150 m tiling artefacts ·
**CC BY 4.0 — commercial with attribution** · anonymous AWS Open Data, no credentials:
`s3://dataforgood-fb-data/forests/v2/…` (research doc); working fetch recipe in memory used
`s3://dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/chm/<quadkey>.tif` tiled by zoom-9 Bing
quadkey · registry `https://registry.opendata.aws/dataforgood-fb-forests/`, announcement
`https://sustainability.atmeta.com/blog/2024/04/22/using-artificial-intelligence-to-map-the-earths-forests/`
· **role:** Tier-2 canopy height — sharpens `veg[]` mean-neutrally and drives tree placement/height for
the render layer · status: **shipped to production 2026-08-10** — Ballygunge, 9,542 trees; accuracy
re-validated unregressed (night ±3.5K, day ±5.0K). *(No formal academic paper — Tolan et al. — appears
in the repo docs; cited only as a dataset/provider. Verify if a citation is needed.)*

**ESA WorldCover 10 m (2020/2021)** — ESA · 10 m, 2020/2021 · **CC BY 4.0 — commercial OK** · AWS Open
Data + MS Planetary Computer, `https://esa-worldcover.org/en`,
`https://registry.opendata.aws/esa-worldcover/`, doi:10.5281/zenodo.7254221 · **role:** coarse
tree/grass/built land-cover mask; cross-checks and gap-fills the CHM; also feeds `albedo`/`built` ·
status: shipped, in the pipeline.

**Microsoft Global ML Building Footprints** — Microsoft, ML-derived from satellite imagery · vector
polygons, tiles `123133323` (Ballygunge/Baruipur) + `123133321` (Barrackpore) · **ODbL** ·
`https://github.com/microsoft/GlobalMLBuildingFootprints` · **role:** shipped building-massing/footprint
source for all three wards (feeds `built` raster, DC-URS FAR) · status: **production, shipped**; counts
Ballygunge 2,048 / Baruipur 3,528 / Barrackpore 3,003; ~88% complete against Overture (12.1% of Overture
buildings sit >20 m from anything MS holds).

**Google Open Buildings 2.5D Temporal** — Google Research, 2023 epoch, ~4 m per-pixel · **CC BY 4.0 —
commercial OK** · public GCS bucket, no auth:
`storage.googleapis.com/open-buildings-temporal-data/v1/geotiffs/…`; product page
`https://sites.research.google/open-buildings/` · **role:** per-footprint building heights via zonal-mean
sampling over MS footprints; feeds massing render + DC-URS FAR (0.35×0.30 weight) · status: **shipped**;
98–99% of buildings got a direct zonal measurement (means Bally 7.6 m / Baruipur 4.6 m / Barrackpore
4.9 m); **heights unvalidated with a suspected low bias** — no independent Kolkata ground truth; ICESat-2
comparison came back `underpowered` (n=28 vs bar of 30), so no correction/statistic applied.

**Overture Maps footprints** — Overture Maps Foundation (merges OSM + Google Open Buildings + Microsoft
ML) · release pinned `2026-07-22.0` · **ODbL** (in-repo attribution: "Footprints © Overture Maps
Foundation (ODbL)") · GeoParquet via DuckDB · **role:** validation/QA — completeness + height cross-check
against the shipped Microsoft geometry; a full-replacement production pipeline exists but is **not
shipped** — stopped at its own parity gate (best statistic reaches only 67% of buildings within 2 m
against a 90% threshold) · status: evaluation/validation use only.

**OpenStreetMap (OSM)** — community-mapped, via Overpass · vector, current · **ODbL — commercial OK** ·
Overpass API fetchers (`scripts/fetch-water.py`, roads fetcher),
`https://www.openstreetmap.org/copyright` · **role:** road centrelines (`{ward}-roads.json`), water
polygon geometry (`{ward}-water.json`), `building:levels` as one of two independent height cross-checks
(6 tags in Ballygunge, 0 in Barrackpore) · status: shipped (water + roads); first committed OSM water
fetcher landed 2026-08-03.

**Met Norway `locationforecast`** — Norwegian Meteorological Institute · live, hourly · **Free, NLOD + CC
BY 4.0 — commercial OK** · `https://api.met.no/weatherapi/locationforecast/2.0/compact` (proxied
server-side via a Vercel function since 2026-08-05; browser-direct breached their ToS) · **role:** live
ambient forcing (tAir/RH/wind/cloud) driving `SimParams`; measured-vs-modelled UI contrast · status:
shipped, production.

**NASA ECOSTRESS L2T_LSTE v002** — NASA/JPL, ISS-mounted TIR sensor · ~70 m, irregular overpasses
(~83/yr over the ward bbox) · **US public domain** · NASA CMR + LP DAAC (not GEE — GEE's ECOSTRESS
collection only ingests LA tiles); Earthdata Login bearer token; doi:10.5067/ECOSTRESS/ECO_L2T_LSTE.002 ·
**role:** direct LST measurement for accuracy calibration (night, peak) · status: shipped as validation
evidence; accuracy floor ~2.09 K (QC bits show 0% "good/excellent" pixels over Kolkata); daytime CI
±1.87 K at n=12 before the Landsat campaign.

**Landsat 8/9 Collection 2 Level-2 (TIRS)** — USGS/NASA · 30 m (100 m thermal resampled) · **US public
domain** · via Microsoft Planetary Computer, no credentials · **role:** daytime LST validation; 213
ward-scenes over 50 overpasses · status: shipped 2026-08-02; tightened daytime CI to ±0.49 K on the
Landsat morning stratum.

**ICESat-2 ATL03** — NASA, photon-counting laser altimeter · decimetre-class, since 2018, tracks RGT
0416/0744/0858 · **NASA public data** (via `fetch-icesat2.py` against Earthdata/CMR) · **role:**
independent building-height validation (**not** a physics input — `heat-map-model.ts` has no height
term) and terrain-offset measurement · status: shipped as a validation artefact; height verdict
**`underpowered`** (n=28 vs pre-registered bar of 30, no statistic published); terrain-offset finding
stands (shipped DSM sits +6.55 m above laser ground).

**NASA POWER** — NASA · hourly, ~2–3 day lag · **US public domain, keyless** ·
`https://power.larc.nasa.gov/` · **role:** solar + wet-bulb forcing/calibration baseline; validation
alongside ECOSTRESS/Landsat · status: shipped (validation/calibration).

**AWS Open Data terrain tiles ("terrarium," z15)** — SRTM-derived, Mapzen tile assembly · ~11 m/texel ·
elevation data public domain (SRTM/NASA), Mapzen attribution · AWS Open Data, keyless · **role:**
render-only ground-relief layer (`{ward}-terrain.json`), explicitly **not used by the simulation** ·
status: shipped in the terrain layer; documented as a *surface* model, ~6 m above true ground (per the
ICESat-2 finding).

**Copernicus GLO-30 (TanDEM-X)** — ESA/Copernicus · 30 m · commercial-clean (per the veg research doc's
framing alongside terrarium) · keyless (verified 200/206 per the terrain spec) · **role:** independent
cross-check of the terrarium terrain field, not the primary source — the two DEMs share only r²≈0.24–0.44
of variance, so terrain is flagged as indicative, not measured · status: validation only.

**JRC GHS-SMOD R2023A (Degree of Urbanisation)** — EU JRC / UN · settlement-classification raster,
R2023A · **CC BY 4.0** · doi:10.2905/A0DF7A6F-49DE-46EA-9BDE-563437A6E2BA · **role:** urban/rural class
validation input for the Green Score methodology · status: validation (§5A of
`green-score-methodology.md`).

**Mapillary (street-level imagery + coverage tiles)** — Mapillary/Meta, community-captured · imagery
vintage varies sharply by ward (Barrackpore ~198 all 2026-fresh; Ballygunge ~26 in-ward, mostly
2015–2022; Baruipur 0) · imagery **CC-BY-SA**; API ToU §12 **permits commercial use of derived data**
(public, unscoped client token — no domain restriction available) · coverage tiles
`tiles.mapillary.com/maps/vtp/mly1_computed_public/...`, Graph API radius search, `mapillary-js@4.1.2`
viewer; `https://www.mapillary.com/developer`, `https://www.mapillary.com/terms` · **role:** "receipts,
not renders" ground-truth layer — coverage recency ramp + nearest-photo thumbnail in the building card;
explicitly **not** a vegetation/canopy source (see ruled-out) · status: **shipped to production
2026-08-11**, token-gated (`PUBLIC_MAPILLARY_TOKEN`; with no token, the whole feature tree-shakes out).

**CPCB via data.gov.in** — Govt. of India · hourly, 7 real Kolkata stations incl. Ballygunge · **GODL-India
— commercial OK** · data.gov.in resource `3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69` (raw pollutant
concentrations, not a computed AQI; needs a proxy) · **role:** planned AQI overlay/validation · status:
vetted, access-verified, **Phase 2** — not yet live.

**WBPCB air-quality archives (via OpenCity)** — West Bengal PCB, 7 station archives · daily, 2019-08-01 →
2023-12-31 (Ballygunge), 96% of its own span · **Public Domain** (`data/opencity/manifest.json`) ·
data.opencity.in · **role:** validation evidence beside the simulated Ballygunge ward (seasonality/
co-exposure only) · status: **acquired and derived** (`data/opencity/aqi-daily.json`); explicitly
validates **nothing about temperature** — carried as a relative index.

**NASA FIRMS** — NASA, VIIRS 375 m thermal anomalies, <3h latency · **Public domain (CC0)** · MAP_KEY
signup, proxy/build-time · **role:** planned thermal-anomaly overlay · status: vetted, **Phase 2**.

**IMD daily temperature (1951–2024, via OpenCity)** — India Meteorological Department · daily,
1951–2024 · **Public domain** · data.opencity.in · **role:** acquired to the manifest; not yet surfaced ·
status: acquisition only.

**Water census KML (via OpenCity)** — KMC · points only (3,051 points, 0 polygons) · **Public domain** ·
data.opencity.in · **role:** attribute join planned for OSM-sourced water geometry (KMC-only coverage) ·
status: acquired, not yet joined; OSM remains the geometry source.

**Google Earth Engine / AlphaEarth (`GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`)** — Google · annual
embeddings · access via a paid/authorised service account (free-tier GEE is non-commercial — see
ruled-out) · **role:** planned "find wards like Ballygunge" similarity layer · status: access verified
(IAM grant obtained), **not yet queried** — Phase 2+; "EE serves no 3D models."

**Procedurally generated trees (ez-tree)** — `@dgreenheck/ez-tree@1.1.0`, MIT, dev-only dependency · not
a measured dataset — geometry generator · **MIT** · baked at build to
`public/heat-map/models/{neem,gulmohar,palm}.glb` · **role:** Tier-3 illustrative individual trees,
placed/scaled from the CHM, receipted as "modelled, not measured" · status: shipped 2026-08-10; unused
fallback noted: Kenney/Quaternius CC0 low-poly trees (`https://kenney.nl/assets`,
`https://quaternius.com/`).

---

## Candidate — brainstormed, not yet in the pipeline

**ETH Zurich Global Canopy Height (Lang et al.)** — ETH Zurich, Sentinel-2 + GEDI fusion, ~10 m · **CC BY
4.0** · COG on `share.phys.ethz.ch` · **proposed role:** an *independent second opinion* on canopy for
the vegetation-v2 work — cross-check the Meta/WRI CHM against it before placing trees, and flag
disagreement rather than trusting one source. **Independence nuance (on record):** ETH shares its
Sentinel-2 optical input with ESA WorldCover, so it is only *partially* independent of the WorldCover
mask — but it **is** genuinely independent of the Meta/WRI CHM (different sensor fusion + GEDI lidar
calibration). Therefore cross-check ETH **against Meta/WRI**, not against WorldCover. · status: brainstorm
candidate from the parked vegetation-v2 discussion; not fetched or integrated. *(This entry is the one
this-session finding not yet in a committed spec.)*

---

## Datasets evaluated and ruled out (with the reason)

**Planet NICFI basemaps** — programme **wound down Jan 2025**, replacement tender cancelled Sept 2025, no
live successor; and even when live, access was **non-commercial/restricted**, never valid for a for-profit
product. *(Correction on record: an earlier claim that NICFI "didn't cover India" was wrong — its
30°N–30°S band did include Kolkata; the rejection reason is licence + end-of-life, not coverage.)*
`https://www.planet.com/nicfi/`, `https://www.nicfi.no/`.

**Google Earth Engine (free tier)** — **free GEE is non-commercial only**; a for-profit product needs a
paid Earth Engine licence. The NDVI/Dynamic World/EIE workflows the CEO's email proposed all route
through GEE. Avoided by pulling EO data through open STAC + AWS Open Data instead.
`https://earthengine.google.com/commercial/`.

**Google Environmental Insights Explorer (Tree Canopy) / Dynamic World** — underlying data is open (CC BY
4.0) but there is **no clean bulk access outside GEE**, so scale use hits the paid-EE trap above.
`https://insights.sustainability.google/`, `https://dynamicworld.app/`.

**FABDEM (free tier)** — proposed as the surface to drape canopy onto. **Free FABDEM is CC BY-NC-SA 4.0 —
non-commercial.** A paid commercial licence exists via Fathom but isn't free; not needed since terrain
already uses terrarium/GLO-30. `https://data.bris.ac.uk/data/dataset/25wfy0f9ukoge2gs7a5mqpq2j7`,
`https://www.fathom.global/product/fabdem/`.

**DeepForest** — the tool is **MIT-licensed and fine**; the blocker is upstream input: it needs sub-metre
RGB (~10 cm) to detect crowns, and there is **no legal sub-metre imagery pipeline for Kolkata** (no
drones over Indian cities, no licensed aerial tiles). Footprints came from Overture, not high-res
imagery, so the "as you used SAM for buildings" precedent doesn't apply.
`https://deepforest.readthedocs.io/`.

**Mapillary — as a vegetation/canopy source specifically** — re-checked twice. Final verdict: the API
exposes **no tree/vegetation object class** usable for placement (only an ungeolocated, undeduplicated
`nature--vegetation` image-space segmentation class — no positions/heights/species); a street-level view
can't see canopy from above like the CHM; imagery is CC-BY-SA (bites only if displayed) plus
anti-scraping terms. *(An earlier internal note wrongly called the API "non-commercial" — ToU §12 does
permit commercial use of derived data; that correction doesn't change the "no tree class" verdict.)* The
CHM remains the sole placement/height source; Mapillary was separately adopted for the unrelated
street-view ground-truth feature (see "in use"). `https://www.mapillary.com/developer`,
`https://www.mapillary.com/terms`.

**WRI GFW Tropical Tree Cover** — **CC BY 4.0, commercial OK**, but Kolkata sits at the northern edge of
its tropical extent and it is coarser than the Meta CHM — **cross-check only**, not a primary tier.
`https://data.globalforestwatch.org/documents/tropical-tree-cover/`.

**OpenStreetMap `natural=tree`** — **ODbL, commercial OK**, but only **~464 tree nodes** across the three
wards — far too sparse to drive canopy density.

**KMC tree census** — **does not exist as open, machine-readable municipal data** for Kolkata; no source
found.

**Google Photorealistic 3D Tiles** — ruled out as the building-geometry source (separate from
vegetation). The three wards are scattered, so photogrammetric coverage would hit at best one of three,
turning a comparison instrument into a render-quality comparison; also fails on runtime-only ToS (no
caching → breaks the static-asset pattern), per-session billing (uncapped on a public page), and absent
building IDs. Kept as a *separate* future showcase (one drone capture → Gaussian splat), never the
comparison tool.

**Mapbox Terrain-RGB** — returns **401 without a token**; terrarium/GLO-30 used instead (both keyless).

**KMC Parks (via OpenCity)** — **licence not stated**; area unit unstated on 34/93 rows. Acquired to the
manifest only; **not displayed** until licence + units confirmed. Also structurally dead for DC-URS: it's
KMC-ward-keyed (covers only Ballygunge; Baruipur/Barrackpore are separate municipalities), so it can't
score a three-ward comparison.

**Microwatersheds GeoJSON (via OpenCity)** — **Public domain**, coverage verified for all three wards,
but median polygon is 5–8× the ward window — a city-scale drainage layer, "firmly not heat-map";
acquisition-only.

**WAQI / aqicn** — ToS **forbids commercial/paid use** and cached redistribution without a signed
agreement — exactly what a consultancy site needs.

**Open-Meteo (hosted free tier)** — most capable API technically (keyless, CORS, apparent-temp/UV/solar),
but the free hosted tier's **ToS is non-commercial** (the underlying data is CC BY 4.0, the endpoint
isn't). Usable only as a prototype cross-check; production needs the paid tier (~€29/mo) or self-hosting
AGPL. Independently rejected on the same grounds in the Green Score methodology's cost/data section.

**OpenAQ, Google Air Quality / Ambee / IQAir** — no browser CORS / key exposure (OpenAQ) or
paid/non-commercial (Google AQ, Ambee, IQAir).

**IMD Mausam API** — returns 401 anonymously; needs formal onboarding. (Distinct from the
separately-acquired IMD OpenCity daily-temperature archive, which **is** in use.)

**SAFAR** — no Kolkata coverage.

**MODIS AOD (MAIAC, `MODIS/061/MCD19A2_GRANULES`)** — measured 2026-08-05: a **dry-season-only
instrument** over Ballygunge (108.6 valid obs/pixel in the Nov–Feb dry window vs just 2 in Jun–Aug) —
monsoon cloud masks the retrieval, so shipping it in August would show an empty field. Deferred.

**GIBS Himawari raster** — ~2 km per pixel against a 1,400 m ward — deferred; would only work in a
flown-out regional camera view, which doesn't exist as a feature.

---

## Free EO backbones the open-data pitch rests on (commercial use OK)

[Copernicus Data Space](https://dataspace.copernicus.eu/) · [MS Planetary
Computer](https://planetarycomputer.microsoft.com/) · AWS Open Data (Landsat/Sentinel) · NASA LP DAAC
(ECOSTRESS). These four keyless, commercial-clean sources are why the engine can claim an open-data spine
with no licence exposure.
