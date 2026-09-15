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
`https://sentinels.copernicus.eu/web/sentinel/terms-conditions` · **role:** NDVI thermal correlator, and
since 2026-08-12 the **sole** source of `veg[]` — the CHM used to redistribute it and no longer does (see
the CHM entry below) · status: shipped, unchanged.

**Meta / WRI 1 m Canopy Height Model (CHM) — we ship v2 (since 2026-08-12; v1 before)** — Meta AI + WRI,
neural height regression on Maxar imagery · 1 m, single-epoch, MAE 3.0 m (v2; v1 4.3 m), known ~150 m tiling
artefacts · **CC BY 4.0 — commercial with attribution** · anonymous AWS Open Data, no credentials:
`s3://dataforgood-fb-data/forests/v2/global/dinov3_global_chm_v2_ml3/chm/<quadkey>.tif`, zoom-10 Bing quadkey
(v1: `forests/v1/alsgedi_global_v6_float`, zoom-9) · registry
`https://registry.opendata.aws/dataforgood-fb-forests/` · **role:** Tier-2 canopy height —
**render + PV screening (2026-09-05), never the temperature solve.** Drives tree placement/height for the render layer, and since 2026-09-05 casts shadows in the rooftop-PV shading pass (`scripts/measure-pv-tree-shading.py`, v2 read at 0.5 m, A1 connectedness mask — spec `2026-09-05-pv-tree-shading-design.md`, Amendments A1–A4). It still **does not enter the temperature
solve** · status: **shipped to production 2026-08-11** for all three wards (8,896 / 4,413 / 6,797 trees);
ward-mean accuracy unchanged throughout (night ±3.5K, day ±5.0K — the CHM has never affected it).

> **CORRECTION (2026-08-12) — the role above used to read "sharpens `veg[]` mean-neutrally".** That was
> true of the code from 2026-08-10 to 2026-08-12 and is now false: `CANOPY_BLEND_STRENGTH` is **0**.
>
> The blend was never measured while it shipped, because no Python applied it (see
> [known-limitations.md §1](known-limitations.md)). The first sweep that could — 34 near-nadir ECOSTRESS
> scenes, 87 ward-scenes, three wards — was monotonic against it: **r_veg 0.2380 → 0.1987, r_physics
> 0.2154 → 0.2076** going from strength 0 to 0.5. Its only improving metric (anomaly RMSE 1.836 → 1.806)
> improved by *compressing* an amplitude the model already over-draws ~2×, chiefly through the operator's
> own [0,1] clamps. At 0.5 the implied tree:grass veg ratio was **4.9–8.1×** against the **2–4×** of
> Schwaab et al. 2021 (Nat Commun 12:6763), while raw NDVI FVC sits in band at 2.0–2.7×.
>
> **The operator was also exactly scale-invariant in height** — its target `v̄·hᵢ/h̄` cancels magnitude, so
> `blend(2h) == blend(h)` bit-for-bit. It consumed only the *normalised canopy pattern*, never the heights.
> This has a direct consequence for the v2 question below: **a v2 upgrade could never have improved the
> physics through this path**, no matter how much better its heights are. v2 is a render-quality and
> tree-placement argument only.

> **CORRECTION (2026-08-12) — which version we ship.** This entry previously read "CHM **v2**" and cited a `forests/v2/…` path,
> while the same paragraph admitted the working recipe used `forests/v1/…`. The engine ships **v1**. The
> error was mine and it flattered us, which is the worst direction for it to be wrong in.
>
> **v2 genuinely exists and we are a generation behind.** `forests/v2/global/dinov3_global_chm_v2_ml3/chm/`
> (zoom-10 quadkeys, proper 512x512 COGs with overviews, EPSG:3857, uint8 — vs v1's non-tiled 65536²
> monolith, so reads get *faster*). Brandt et al., *Scientific Data*, arXiv:2603.06382 — DINOv3 backbone,
> **R² 0.53 -> 0.86, MAE 4.3 -> 3.0 m**, the >=30 m saturation largely removed. CC BY 4.0.
>
> Measured over our wards, v2 reads **1.7-1.9x higher** than v1 (ward means ballygunge 2.73 -> 4.85 m,
> barrackpore 1.52 -> 2.86 m, baruipur 2.07 -> 3.47 m; p95 10 -> 16 m in ballygunge). So the "3-5 m ward
> mean" this project has quoted is a **v1 artefact**. Upgrade decision pending — but note it is now a
> **render and tree-placement** decision only, not an accuracy one: since the blend went to 0 the CHM does
> not reach the solver at all, and even when it did, the operator's scale-invariance meant better heights
> could not have moved a single published figure.
>
> One thing v2 is NOT: fresher. Its paper puts ~80% of source imagery in 2018-2020, the same epoch as v1
> — it is a **model** upgrade, not new observations. Do not sell it as newer data. *(The AWS registry
> gives v1 source imagery as 2016 against the ~2018-2020 stated here — unresolved, verify.)*
>
> **UPDATE 2026-09-05:** v2 has been the fetched source since 2026-08-12 (`fetch-canopy.py`,
> `<ward>-trees.json` carry the v2 prefix), so the entry header above now says v2. The reader floors at 1 m —
> see `known-limitations.md` §8, addendum 2026-09-05.

**ESA WorldCover 10 m (2020/2021)** — ESA · 10 m, 2020/2021 · **CC BY 4.0 — commercial OK** · AWS Open
Data + MS Planetary Computer, `https://esa-worldcover.org/en`,
`https://registry.opendata.aws/esa-worldcover/`, doi:10.5281/zenodo.7254221 · **role:** coarse
tree/grass/built land-cover mask; cross-checks and gap-fills the CHM; also feeds `albedo`/`built` ·
status: shipped, in the pipeline.

**Microsoft Global ML Building Footprints** — Microsoft, ML-derived from satellite imagery · vector
polygons, tiles `123133323` (Ballygunge/Baruipur) + `123133321` (Barrackpore) · **ODbL** ·
`https://github.com/microsoft/GlobalMLBuildingFootprints` · **role:** shipped building-massing/footprint
source for all three wards **until 2026-08-04** · status: **superseded** by Overture (commit `6151975`,
8,579 → 12,767 buildings); retained only as the completeness comparison — MS held ~88% of Overture (12.1% of
Overture buildings sit >20 m from anything MS holds). Counts were Ballygunge 2,048 / Baruipur 3,528 /
Barrackpore 3,003.

**Google Open Buildings 2.5D Temporal** — Google Research, 2023 epoch, ~4 m per-pixel · **CC BY 4.0 —
commercial OK** · public GCS bucket, no auth:
`storage.googleapis.com/open-buildings-temporal-data/v1/geotiffs/…`; product page
`https://sites.research.google/open-buildings/` · **role:** per-footprint building heights via zonal **p65**
over Overture footprints (p75 also cached in `data/geometry/heights-overture.json`); feeds massing render +
DC-URS FAR (0.35×0.30 weight) · status: **shipped**; shipped p65 medians Ballygunge 7.0 m / Barrackpore
4.9 m / Baruipur 4.5 m; **~13% of buildings sit on Google's 2.5 m no-confident-height fill** (465/597/629);
the p65→p75 caster swap was tested for PV shading and is a null (+0.01–0.04 pp) — the percentile is not a
lever, the raster is; **heights unvalidated with a suspected low bias** — no independent Kolkata ground truth; ICESat-2
comparison came back `underpowered` (n=28 vs bar of 30), so no correction/statistic applied.

**Overture Maps footprints** — Overture Maps Foundation (merges OSM + Google Open Buildings + Microsoft
ML) · release pinned `2026-07-22.0` · **ODbL** (in-repo attribution: "Footprints © Overture Maps
Foundation (ODbL)") · GeoParquet via DuckDB · **role:** **the shipped footprint source** for all three wards
since 2026-08-04 (commit `6151975`; 3,527 / 4,702 / 4,538 = 12,767 buildings, GERS-deduplicated) · status:
**production, shipped**. One overlapping pair survived dedup in Barrackpore and produced a spurious 100 %
rooftop-PV shading loss — guarded by `OVERLAP_TOL` in `scripts/measure-pv-shading.py`. The earlier
"stopped at its parity gate" note (also in `heat-map-feature.md`) predates the ship commit.

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

**Poly Haven sky domes (image-based lighting for the OBOS 3-D scene)** — two 1k Radiance `.hdr`
environment maps, 1024×512 equirectangular · **CC0 1.0** — any purpose, commercial included, no
attribution required (`https://polyhaven.com/license`) · fetched 2026-08-29 from
`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/<slug>_1k.hdr` via the asset API
`https://api.polyhaven.com/files/<slug>`; **vendored into the repo** at `public/heat-map/sky/` — a
third-party CDN in the render path would be a dependency we do not control and a per-visitor privacy
leak · **role: RENDER-ONLY ambience.** They light building materials through `scene.environment`
(PMREM-convolved); they are never `scene.background` and are never seen directly, because the three.js
scene is a MapLibre custom layer that composites over the basemap. **They do not enter the temperature
solve** — `sun` and `kRad` there are ward-wide scalars and there is no shade term · loaded after first
paint, on device tier `full` only · status: shipped 2026-08-29 on `feat/obos-shell`.

| | day | night |
|---|---|---|
| slug | `mud_road_puresky` | `kloppenheim_07_puresky` |
| conditions | midday, overcast, sky only | night, overcast, sky only, town skyglow |
| sha256 | `99d43df8e055fc8b8e9e4ca846c432e8d7184a15fd3f4d68f425b157cc99c03d` | `c18aa40364d1b5aa788f309f1c64d891c386e6f8e7d958c329f7470489e04f8a` |
| bytes | 1,109,840 | 1,282,823 |
| mean radiance (solid-angle weighted) | 0.367 | 0.249 |
| **max / mean luminance** | **2.2** | **49** |
| light in the brightest 0.1 % of solid angle | 0.2 % | 0.7 % |

**WHY THESE TWO, AND THE NUMBER THAT DECIDED IT.** An HDRI's baked sun sits at the angle it was
photographed at, which is not Kolkata's, and OBOS's key light is now driven by our own solar geometry —
so a dome with a strong sun in it is a second, wrong key light fighting the right one. `max / mean`
is that in one number: a sun or moon disc runs to hundreds of times the dome mean, an overcast dome has
no disc at all. Measured by parsing the RGBE of the 1k files directly (eight candidates, all Poly Haven
"pure skies" or open-sky night domes):

| candidate | time / weather | max/mean | verdict |
|---|---|---|---|
| `mud_road_puresky` | midday, overcast | **2.2** | **adopted (day)** |
| `overcast_soil_puresky` | afternoon, overcast | 6 | runner-up |
| `kloofendal_overcast_puresky` | afternoon, overcast | 7 | runner-up |
| `farm_field_puresky` | midday, partly cloudy | 28 | a visible sun |
| `kloppenheim_07_puresky` | night, overcast, skyglow | **49** | **adopted (night)** |
| `qwantani_night_puresky` | night, clear | 141 | bright horizon light source |
| `rogland_clear_night` | night, clear | 215 | not sky-only; desert-brown ground bounce |
| `satara_night_no_lamps` | night, clear, natural only | 2876 | Milky Way core; and heavy sensor noise |

The night dome matters more than the day one — the 22:00 retained-heat phase is the one that looked
worst, because it was lit by the same fixed key as noon. An **overcast** night was chosen over every
clear-night option on the same argument: a clear night's bright spot is a moon, i.e. a directional
source at the wrong angle, while an overcast night spreads its light across the whole cloud deck. It
also happens to describe Kolkata at 22:00 — humid, hazy and light-polluted — rather than a desert sky.

---

## Candidate — brainstormed, not yet in the pipeline

**Ground irradiance — NIWE SRRA Advanced Measurement Station at IIEST Shibpur, and IMD Alipore** —
researched 2026-09-02, **not acquired**. The IIEST station (Howrah) was established **2014** under
MNRE's SRRA programme, built explicitly for "investor-grade" solar data: pyranometer (GHI), shaded
pyranometer (DHI), pyrheliometer on tracker (DNI), **sun photometer for aerosols** (the term that breaks
satellite irradiance over the Indo-Gangetic Plain), albedometer, net/IR/UV radiometers. **6.8 km from
Ballygunge, 6.6 km from our POWER cell centre — inside the same POWER grid cell as all three wards**, so it
is the natural bias-correction reference for the whole metro, not one roof. Access: NIWE sells *processed*
data (NDA, payment in advance, FTP within 5 working days; prices behind a bot wall, not indexed); raw data
only via MNRE-approved institutional collaboration — which, with a DST-funded solar hub on campus, may be
the better route than purchase. Contact `dst.iiestsolarhub@gmail.com`. **IMD Alipore** is one of the original
four IMD radiation stations (**1957**), measuring direct/diffuse/global; via the IMD Data Supply Portal
(`dsp.imdpune.gov.in`, registration, cost-estimate tool, `data.service@imd.gov.in`). **Not established:**
prices, whether IIEST is currently operational, ISO 9060 sensor class, commercial-use terms. **Priority:
below the PV packing factor** — irradiance bias is a ~5% term; the Mumbai packing factor is +43%.

**ETH Zurich Global Canopy Height (Lang et al. 2023)** — ETH Zurich, Sentinel-2 + GEDI fusion, 10 m ·
**CC BY 4.0** (raster; repo code is MIT) · 3-deg COG tiles on `libdrive.ethz.ch`, range-readable via
`/vsicurl/`; companion uncertainty layer is `*_Map_SD.tif` · cite the 2023 *Nature Ecology & Evolution*
paper (doi:10.1038/s41559-023-02206-6) + dataset doi:10.3929/ethz-b-000609802 · **MEASURED against our
wards 2026-08-12 — the results are below, and it is NOT adopted as a placement input.**

**What it can and cannot say here (all measured, not assumed):**

- **It is blind over ~72% of our wards, by design.** The 255 nodata is not missing data: Lang et al. "mask
  out built-up areas, snow, ice and permanent water bodies **according to the ESA WorldCover
  classification**." Verified two ways — per-pixel agreement with WorldCover v100 `isin([0,50,70,80])` is
  **99.73%**, and predicted coverage from the WorldCover mask alone (28.5 / 28.1 / 46.5%) matches observed
  (~29 / 29 / 48%) to under one percentage point. A street tree over a built-up cell is **erased, not
  measured as zero** — so it is structurally silent on exactly the urban-canopy question we ask.
- **The surviving ~28% is not a fair sample of the ward** — it is ~90% WorldCover "Tree cover" pixels, i.e.
  parks and large stands. Any statistic over it describes those, not the ward.
- **Compare it the way its authors prescribe, or the answer is wrong.** ETH predicts GEDI **RH98** — the
  near-maximum within a ~25 m footprint — so the authors ship `CircularMaxPool2d(radius=12)`
  (`gchm/preprocess/ALS_maxpool_GEDI_footprint.py`) to make 1 m data comparable. Our first pass compared a
  25 m max against a 10 m mean and produced a spurious ~10 m gap. Done correctly: **MAD 3.62 / 5.42 /
  4.14 m, r 0.529 / 0.485 / 0.433** — and that residual sits **inside ETH's own stated uncertainty**
  (mean SD 6.96-7.49 m over these wards; not one pixel below 4 m SD).
- **r ~ 0.4-0.5 is the normal result, not a bad one.** Published urban validations get R² 0.28-0.69; the
  best *tropical city* case is Tolan's own Sao Paulo tile at R²-block 0.41. Meta and ETH against the same
  Czech lidar diverge by ~11.7 m — larger than our Kolkata gap (Moudry et al. 2026,
  doi:10.1029/2025EA004544).
- **Kolkata is outside its validated domain.** The paper's independent-lidar validation covers 11 countries
  in North/Central America and Europe, plus Gabon. There is no South Asian or tropical-urban validation,
  and the authors excluded urban areas from their own headline statistics.
- **Independence is weaker than first recorded.** An earlier note here said ETH "shares Sentinel-2 with
  WorldCover." It is tighter than that: ETH's **mask IS WorldCover**. It remains genuinely independent of
  Meta/WRI (different sensors, different supervision), which is the axis that matters for cross-checking.

**Verdict:** a defensible *methodological* cross-check — "an independent 10 m product, restricted to
WorldCover tree-cover pixels at ~25 m effective resolution, agrees within its own error bars" — but it
cannot arbitrate 1 m heights in a dense city, and it must never be quoted as "two sensors agree" without
the blind spot stated in the same breath.

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
already uses terrarium/GLO-30, and flood work uses GEDTM30 v1.2 (CC BY 4.0) + DeltaDTM. **Datum trap
(2026-09-02):** FABDEM and GLO-30 are *already* EGM2008 orthometric — re-applying an ellipsoid→geoid
correction (a proposed pipeline did) would shift Kolkata by the local geoid height, ~55 m, against a total
ward relief of 3–5 m. Across a 1.4 km ward the geoid is a constant anyway. `https://data.bris.ac.uk/data/dataset/25wfy0f9ukoge2gs7a5mqpq2j7`,
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

**AQI APIs — landscape researched 2026-09-02** (multi-city: Kolkata, Mumbai, Bengaluru, Jamshedpur, Dubai).
The rule that fell out: **the AQI standard follows the city's regulator, the source follows what that
regulator publishes** — CPCB for every Indian city (free, GODL-India), US-EPA-based for Dubai.
- **IQAir (AirVisual)** — $399/mo Startup, $999/mo Enterprise, free 500 calls/day. **Ruled out for India:**
  its Kolkata data is re-served **WBPCB** (same seven stations as CPCB), and its primary field `aqius` is
  US EPA, wrong for an Indian regulator. Would add nothing to Barrackpore/Baruipur, which have no station.
  Legitimate only as a Dubai adapter, and only after the government sources below are checked.
- **Google Air Quality API** (ex-BreezoMeter) — 500 m modelled field, 100+ countries, **70+ AQ indexes**
  (so CPCB and EPA both available), free 10K calls/mo then $5/1K. **Best candidate for multi-city — BLOCKED
  on one unverified question:** Maps Platform ToS has historically restricted use alongside non-Google
  basemaps, and we render on MapLibre. Check that before anything else. A modelled field must be labelled
  modelled; it is not a station reading.
- **Ambee** — Indian company (Bengaluru), 15-day trial, custom pricing. Partnership angle; unpriced.
- **OpenAQ** — free 300 calls/5 min, commercial on custom terms. The old "no CORS" objection is solvable
  with a proxy; worth a second look.
- **Copernicus CAMS** — free, commercial OK with attribution, global forecasts — but ~80 km outside Europe,
  so city-scale context only, never within-city.
- **WBPCB AQMS portal** (`aqmsdata.wbpcb.gov.in/hourly`) — the *primary* source for Kolkata, closer than
  CPCB-via-data.gov.in; evaluate as the ingestion path. **Dubai:** UAE National Air Quality Platform and
  Dubai Pulse open data — unverified; check before paying any vendor.
No API fixes station density: seven stations in Kolkata, seven in Bengaluru. Within-city AQ is a sensor
problem, and one low-cost sensor costs about a month of the IQAir Startup plan.

**IMD Mausam API** — returns 401 anonymously; needs formal onboarding. (Distinct from the
separately-acquired IMD OpenCity daily-temperature archive, which **is** in use.)

**SAFAR** — no Kolkata coverage.

**MODIS AOD (MAIAC, `MODIS/061/MCD19A2_GRANULES`)** — measured 2026-08-05: a **dry-season-only
instrument** over Ballygunge (108.6 valid obs/pixel in the Nov–Feb dry window vs just 2 in Jun–Aug) —
monsoon cloud masks the retrieval, so shipping it in August would show an empty field. Deferred.

**GIBS Himawari raster** — ~2 km per pixel against a 1,400 m ward — deferred; would only work in a
flown-out regional camera view, which doesn't exist as a feature.

---

## Canopy second opinions surveyed 2026-08-12 — and why none replaces the 1 m layer

Prompted by the question "what independently corroborates our canopy?". The honest headline: **there is no
free, commercially-licensed, urban-credible independent canopy *height* second opinion for Kolkata.** That
is a finding, not a gap in the search.

**GEDI L2A/L2B (NASA spaceborne lidar) — DEAD END, quantified.** Licence is clean (CC0/EOSDIS, commercial
fine) and coverage is not the problem: GEDI's drifting ISS orbit accumulates ~67 vegetation-quality shots
per km², so ~131 per ward — unlike ICESat-2's fixed ground tracks. It fails on *urban geometry*. GEDI's
25 m footprint plus 10.3 m 1-sigma geolocation error needs ~22.5 m clearance from any building. Rasterising
our Overture footprints and running a distance transform: the area far enough from a building **and**
carrying canopy is **1.5 / 2.7 / 4.0%** of the three wards, giving an expected **~2 / ~3.5 / ~5 usable
shots per ward across the entire mission**. That is the [[icesat2-height-validation]] "underpowered"
verdict again, worse. GLAD's own documentation concedes the mechanism: "Tree height over cities and suburbs
may be confounded with building height, as GEDI data do not discriminate between the height of vegetation
and man-made objects."

**GLAD / Potapov 30 m forest height — usable as a cheap third opinion, better than its reputation.**
CC BY, commercial OK, and uniquely needs **no login**: plain HTTP at
`https://gladxfer.umd.edu/Potapov/Forest_height_2019/Forest_height_2019_SASIA.tif`, range-readable.
Measured against our v1: **r = 0.445 / 0.437 / 0.503**, bias −1.60 / −0.05 / +3.47 m, RMSE 3.21 / 2.71 /
4.93 m. Its documented building-confusion caveat was tested and **does not bite here** — r(built fraction,
height) = −0.23 / −0.35 / −0.28, and it reads *lower* over built pixels, so it errs toward omission rather
than counting rooftops. Still 30 m over a 1400 m ward with a hard 3 m floor and a 2019-only epoch: a
cross-check, never an ingest.

**WRI Tropical Tree Cover — the best genuine independent option, and an earlier note here was wrong about
it twice.** It is **ODC-BY** (commercial fine) not merely CC BY, and Kolkata at 22.53°N sits ~100 km inside
its ±23.44° extent rather than at the edge. WRI state it is designed to "enable accurate monitoring of
trees in urban areas", and its lineage — Sentinel-1+2 CNN with **no GEDI supervision** — is genuinely
independent of Meta's Maxar/ALS lineage. Two real limits: it carries **no height** (probability of canopy
intersecting the pixel), so it can only second-opinion our canopy *extent*; and bulk access needs a free
GFW account and API key (`s3://gfw-data-lake` is not anonymously listable). **Verdict: usable, as an extent
check.** Not yet fetched.

**NRSC Bhoonidhi / Resourcesat LISS-IV 5.8 m — the one usable Indian route, with a publishing catch.**
Under India's Space Policy 2023 everything at ≥5 m GSD is free and open; registration is self-service and
accepts non-Indian "Private" users. Its EULA permits derivative works but **excludes internet hosting of
the product** — so the rule is **publish statistics, not pixels**. Independent sensor, independent
processing chain. Unverified: whether a LISS-IV scene actually covers Kolkata (login-gated).

**ECHOSAT (Pauls et al., 10 m, 2018-2024 annual, CC BY 4.0)** — the only other credible height product, but
the relevant tile is **114 GB with no windowed API**, and it is GEDI-supervised so not fully independent.
Cross-check only, low priority.

**Ruled out on licence:** EarthDaily 2023 10 m canopy (**CC BY-NC**), SERA-H (**CC BY-NC-SA**), Pauls 2024
(GEE-only), DLR TanDEM-X 10 m (Germany only).

**Ruled out as not-independent:** ESA WorldCover — CC BY 4.0 and anonymous, tree fraction agrees with our
CHM within ±40%, **but we already ingest it** (`fit-physics.py`, `landcover-fractions.py`,
`compute-tra.py`), so it cannot be a second opinion. Its real value is as the built-up mask CHM v2's own
authors instruct users to apply. Same objection to NDVI: we ingest Sentinel-2 ourselves, and published work
puts NDVI at as little as **R² = 0.09** against tree height in NYC.

**Ruled out on physics, not only on circularity — thermal.** Validating canopy by its cooling signature is
tempting and wrong here: the published effect is canopy **cover** not **height**, cooling only becomes
detectable above ~20-45% canopy, ECOSTRESS's 70 m pixel cannot resolve street trees, and one 2025 result
finds tree height *raises* LST until it exceeds building height — which in our wards is likely the wrong
side of the crossover. *(Amended 2026-08-12: this entry also used to say "the twin already takes canopy as a
thermal input", which was the circularity objection. That is no longer true — `CANOPY_BLEND_STRENGTH` is 0
and canopy does not enter the solve — so the circularity is gone. It does not rehabilitate the idea: we
**did** run the thermal comparison, over 87 ward-scenes, and canopy-informed vegetation agreed with
ECOSTRESS **less** well than raw NDVI. The remaining reasons above are why, and they still stand.)*

**Commercial VHR — cheap, and blocked by regulation rather than price.** Vantor Vivid 30 cm BGRN ≈ **$90**
for our 6 km² (1 km² minimum, and the same Maxar lineage Meta's CHM was trained on); Airbus Pléiades Neo
30 cm ≈ **$135**; Vantor Precision3D DSM+DTM ≈ $120-203. Nobody sells an off-the-shelf Kolkata canopy layer
— Nearmap has no India coverage, Ecopia's off-the-shelf canopy is North America only, PlanIT Geo is US-only,
Planet's Forest Carbon products are 30 m MMU with a ≥5 m height threshold. See
[regulatory-and-licensing.md](regulatory-and-licensing.md) for why the sub-metre options are closed to us
regardless of price.

---

## Bangalore — the second-city stack (researched 2026-09-09/10)

Everything below was checked for **Bengaluru specifically**. India's licence landscape is not Kolkata's
plus a rename: the state GIS agency, the national remote-sensing portal and the met department each
carry their own restriction, and three otherwise-excellent datasets die on them. Design decisions and
the measured numbers live in
[../superpowers/specs/2026-09-10-bangalore-obos-wards-design.md](../superpowers/specs/2026-09-10-bangalore-obos-wards-design.md).

### In use

**IMD Climatological Tables of Observatories in India, 1991–2020** — India Meteorological Department,
National Data Centre, Pune (imdpune.gov.in, 844-page PDF) · **no licence stated; the monthly normals are
cited as published facts, not redistributed as a dataset** · **role:** the fallback air temperature when no
live reading exists (`airNormals` in `scope/registry.ts`) · stations: **Bengaluru City 43295** (pp. 133–138)
and **Kolkata (Alipore) 42807**, mean daily maximum and minimum by month.
*Cross-check:* GHCN-Daily `IN009010100` agrees within 0.4 °C for 1991–2020; its 2016–2025 mean is warmer
(April 34.9 °C against the normal's 34.1 °C). **Kempegowda International (43293) opened in 2014 — its
"1991–2020" column is a few years of data and must not be used.**
*Ruled out for this role:* the IMD Data Service Portal (commercial use is paid and forbids redistribution
and "consultancy fees"), NOAA GSOD/ISD for non-US stations (WMO Resolution 40 bars commercial re-export),
and Open-Meteo's free tier (non-commercial).

**UT-GLOBUS (Urban Terrain and Global Building heights)** — University of Texas at Austin ·
per-building height, area, volume and surface area, machine-learned from street-view, footprints and
elevation · **CC BY 4.0** · Zenodo record `11156602`, `Asia.zip` · **role:** the **cross-check** on
Google 2.5D heights, never the primary and never blended into it · status: **both tiles in hand**, fetched from `Asia.zip` by HTTP range and decompressed as Deflate64 —
`Bangalore_1.gpkg` (273,190,912 B, MD5 `6efdf6d82d8d2fe5b7dd95ddd3a9c45b`, 964,234 buildings, covers MG
Road) and `Bangalore_2.gpkg` (214,093,824 B, MD5 `2fa854a9176cbdaf1af6ec4c626fc84f`, 774,118 buildings,
covers Indiranagar and Whitefield). Validated only against US LiDAR (building RMSE 9.1 m); no Indian city.
*Measured character:* integer metres, **only 122 distinct values city-wide**, mean 6.87 m, and the five
commonest values (7, 5, 4, 6, 8 m) account for 58 % of the city — it under-resolves mid-rise. Minimum is
**0.0 m** and maximum **492 m**; both are artefacts and must be dropped or clipped before any comparison.

**Overture Maps `base/water` centrelines (OSM-derived), release 2026-07-22.0** — **ODbL 1.0**; a published
derived database must be shared alike · **role:** Bengaluru's open drains and streams, drawn as 3 m
**illustrative** ribbons, never in the solver · covered reaches (OSM `tunnel`/`culvert`/`covered=yes`)
counted and not drawn. **No defensible channel widths exist openly**: OSM tags one width in 38 MG Road
reaches; BBMP's 2022 storm-water-drain KMLs carry order only (and a portal-only licence label); the
"22 / 16 / 6–9 ft" primary/secondary/tertiary figures are blog-sourced. **Legal buffers are not widths** —
the current rule is Karnataka Gazette UDD 468 MNJ 2025(E), 15 Oct 2025: 15 / 10 / 5 m from the drain edge;
the NGT's 50 / 35 / 25 m (4 May 2016) was set aside by the Supreme Court in *Mantri Techzone v Forward
Foundation* (5 Mar 2019). BBMP's primary/secondary/tertiary order was considered and not adopted: its
licence is a portal label only, and its tertiary drains largely do not align with OSM outside MG Road.

**Overture Maps buildings, 2026-07-22.0** — ODbL · **built and in hand 2026-09-10**:
14,867 / 11,045 / 10,897 footprints for Indiranagar, MG Road and Whitefield, sliced from one
102,382-building cache over the metro strip. Heights are joined from Google 2.5D as **zonal p65**,
matching Kolkata exactly; fill rates came in at 2.3 / 3.2 / 4.6 %, **better than Kolkata's shipped
4.0 / 6.5 / 10.8 %**, so Google's Bengaluru coverage is the stronger of the two.

**Overture Maps context themes, 2026-07-22.0** — `base/water`, `base/land_use`, `transportation/segment`
· ODbL · **in the Blender scenes 2026-09-10**, clipped to each ward box: water polygons and stream lines,
green land-use classes only, carriageway road classes only (footways and paths dropped as clutter at
2.8 km). Same bucket and release as the buildings, so the whole scene is one licence and one vintage.

**Poly Haven sky HDRI (`kloofendal_43d_clear_puresky`)** — **CC0** · **lighting only, not data.** A
South African sky lights the Bengaluru islands; it is a look choice and the spec says so. Kept because
it is the only licence class that needs no attribution at all in a render.

**Meta / WRI canopy height model v1 — Bangalore** — same product as the Kolkata entry above, read from the
same bucket · **in the Blender scenes 2026-09-10**, tile `123303312` · cover ≥ 3 m on 1 m pixels: **Indiranagar
34.1 %, MG Road 31.5 %, Whitefield 18.9 %**. **v2 was measured alongside** on the same boxes and reports
1.6–1.8× the cover at every ward (55.5 / 50.6 / 33.8 %), so the spec's rejection of v2 for *placement* stands
on the final geometry, not on the candidate boxes it was first made on. Kolkata ships v2 for *height*;
the two choices are consistent with Kolkata's own finding that v2 improved how tall, not where.
Trees are scattered by Kolkata's rule imported from `fetch-canopy.py`, and candidates inside a building
footprint are dropped — **6–9 % of candidates per ward**, a measured roof-for-crown confusion rate.

**Poly Haven tree scans (`jacaranda_tree`, `island_tree_01/02/03`, `tree_small_02`)** — **CC0** ·
fetched and wired in 2026-09-10, then **RULED OUT as the default for city-scale scenes** and kept
behind `--trees scan` · photogrammetric, 1–4 M triangles each, textures verified loading.
**Measured against a 112-triangle stylised crown at ward viewing distance (a 12 m tree ≈ 25 px), the
scan reads as a pale grey wisp and the stylised tree reads as a tree.** Alpha-card foliage cannot be
collapse-decimated (the UVs stop mapping to a leaf) and card-deletion thinning leaves ~7,000 leaves on
a tree that has 1.2 M, so it renders bare; a 20 k → 400 k leaf sweep was still sparse at the top.
The lesson generalises: **a photogrammetric hero asset is not automatically higher quality — quality
is whether it reads at the size it will actually be drawn.** Note the Blender MCP add-on's Poly Haven
search commands are unavailable in the installed version; `api.polyhaven.com` serves the catalogue
without a key.

**ATREE-CSEI — Lakes & Streams of Bengaluru Urban** — Ashoka Trust for Research in Ecology and the
Environment, Centre for Social and Environmental Innovation · 181 lake polygons, 3,927 stream lines ·
**CC-BY** · **role:** the water layer, and the reason Bangalore's water can be drawn as a *system*
rather than scattered ponds — the layer carries a **`Valley`** field naming the tank chain
(Vrishabhavathi, Koramangala-Challaghatta, Hebbal). **Nothing else surveyed carries that attribute.**

**BBMP Tree Census (July 2026)** — 702,109 individual trees with species and ward number · licence per
the OpenCity position below · **role:** tree **species and position**, an inventory. It is emphatically
**not** a density field — see [known-limitations.md](known-limitations.md).

**KGIS `State_LULC_2023`** — Karnataka GIS, ArcGIS REST feature service · live, feature-level, verified
at all three ward sites · **role:** land cover. Harvested from the **government REST service** in
preference to the OpenCity mirror, so the provenance is first-party.

**GBA-2025 ward boundaries** — Greater Bengaluru Authority, **369 wards across five corporations,
notified 19 Nov 2025** · via OpenCity `gba-wards-delimitation-2025` · **role:** the ward geometry, and a
trap defused. See the ward-vintage note below.

**NOAA GHCNh** — hourly station observations, US public domain · 3 Bengaluru-area stations, ~4-day
latency · **role:** live weather. It **replaces NOAA ISD**, which is dead here (below), and it is also
how IMD's own observations reach us legally.

**data.gov.in CPCB air-quality feed** — 9 stations city-wide, hourly · **GODL-India** · **role:** a
city-level AQ ribbon only. Station spacing cannot support a within-ward field — the same ceiling
recorded for Kolkata.

**ECOSTRESS `ECO_L2T_LSTE` via LP DAAC/CMR** — **214 unique overpasses in 24 months, 88 day and 126
night, spanning all 24 local hours.** The ISS orbit precesses where Landsat is pinned near 10:30 local,
so this is the first dataset that could validate the engine's **night** regression separably. Access is
the existing bearer-token CMR route, **not** Earth Engine (below).
*Full run:* the 2018–2026 search behind the resilience score found 690 acquisitions (333 day, 357 night);
the counts are under **Bengaluru DC-URS inputs** below.

**Bengaluru DC-URS inputs (2026-09-15)** — **every source below permits commercial use** · **role:** the
resilience score's per-ward inputs, built by `scripts/fetch-bangalore.py --layer dcurs-static` and
`--layer dcurs-lst`, then `scripts/export-bangalore-obos.py` into `data/bangalore/dc-urs-inputs.json` ·
limitations and the clamp report in [known-limitations.md](known-limitations.md) §14.

| Source | Licence | Role |
|---|---|---|
| WorldPop R2025A constrained 2025, 100 m (`ind_pop_2025_CN_100m_R2025A_v1.tif`) | CC BY 4.0 | `popDensity`: summed over exactly the box with fractional edge-pixel weights; labelled `modelled` |
| JRC GHS-SMOD R2023A E2020, 1 km, tile `R8_C26` | CC BY 4.0 | rural reference = classes 11/12/13; all three ward centres verified class 30 (urban centre) |
| ESA WorldCover 2021 v200, 10 m, tile `N12E075` | CC BY 4.0 | `distCoolM`: distance to the nearest cool refuge |
| Sentinel-2 L2A via earth-search | Copernicus | NDVI, 2021–2025 |
| NASA ECOSTRESS L2T LSTE v002 via CMR / LP DAAC | US public domain | day and night LST, and the heat island |

*ECOSTRESS run:* searched 2018-07-01 to 2026-09-01, with the last 14 days excluded as unsettled — 690
acquisitions (333 day, 357 night) over MGRS tiles 43PGP/PGQ/PHP/PHQ, 480 recorded and 210 with no usable
granule. **46 day and 49 night scenes are clear (≥ 10 %) in all three wards at once, near-nadir
(view-zenith difference ≤ 0.75°), with a rural reference present**; the pre-registered gate of ≥ 8 per
phase passes in both. `fvc` and `albedo` are not fetched here: they are copied from the served
`surface-meta.json`. The `dcurs-static` layer prints, per ward:

```
indiranagar  pop 10,143/km2 · FAR 0.6356 (storey 3.33 m) · refuge 29 m · NDVI 0.3104 ± 0.0179 (5 yr)
mg-road      pop 9,557/km2 · FAR 0.9816 (storey 3.33 m) · refuge 50 m · NDVI 0.2805 ± 0.0118 (5 yr)
whitefield   pop 8,691/km2 · FAR 0.7386 (storey 3.33 m) · refuge 29 m · NDVI 0.2924 ± 0.044 (5 yr)
```

### Ruled out, with the reason

**KSRSAC / K-GIS 50 cm imagery** — the only sub-metre imagery covering Bengaluru comprehensively, and
contractually closed: *"Under no circumstances data will be used for any commercial purposes by anyone"*
and *"shall not be used for any legal purpose."*

**Bhuvan / NRSC (Bhoonidhi)** — the EULA permits derivative works but **excludes "Internet based
hosting" explicitly**, which is exactly what a web 3D scene is. Registration is single-user and
non-transferable.

**Cartosat stereo (the DIY nDSM route)** — under the **Indian Space Policy 2023**, data finer than 5 m
is free only to government entities and priced via NSIL for everyone else. Only CartoDEM 30 m is free,
and that is terrain, not buildings.

**GlobalBuildingAtlas heights** — **CC BY-NC 4.0**, and its commercially-usable ODbL tier has **no
height field at all** (verified by byte-ranging the Bangalore tile: properties are only `source`, `id`,
`region`). Accuracy would have disqualified it anyway — a published Indian evaluation **including
Bengaluru** measures ME −30.3 m, MAE 30.3 m, RMSE 41.8 m.

**FABDEM** — already ruled out for Kolkata on CC BY-NC-SA; **re-confirmed for Bangalore**, same licence,
same answer. Do not re-test.

**GHS-OBAT** and **OpenBuildingMap** — both advertise per-building heights on billions of footprints
under open licences. **Both derive them by zonal statistics from GHS-BUILT-H at 100 m**, the layer this
project already rejected on measurement. GHS-OBAT's own validation is MAE 2.88 m, r = 0.29, and
buildings under 100 m apart inherit identical heights. **This is the disguised-GHSL pattern: an open
licence and a per-building schema wrapped around a 100 m raster.**

**Microsoft GlobalMLBuildingFootprints — for heights** — measured: **0 of 1,063,902 buildings in the
India quadkey carry a height**; every record is `-1.0`. The footprints remain fine.

**Meta / WRI canopy v2** — nearly **doubles** cover against v1 at every site, and **61 % cover for
Indiranagar is not credible** for a dense urban neighbourhood. That measurement is the rejection on its
own; the urban-validation literature already in
[methods-and-papers.md](methods-and-papers.md#urban-canopy-height-validation--what-good-actually-looks-like)
points the same way. **v1 stays primary; v2 is not used until measured against v1.**

**NOAA ISD** — every Bengaluru entry ends **2025-08-24** and the 2026 file returns 404. Any recipe
inherited from Kolkata that reads ISD **stops in August without erroring**. GHCNh replaces it.

**Google Earth Engine's ECOSTRESS collection** — its metadata advertises a global bounding box and
current dates, while its description says verbatim: *"only tiles covering the Los Angeles metro area
have been ingested."* **Verifying by bbox and date alone leads to the opposite conclusion.** The
LP DAAC/CMR route stays mandatory. Worth re-checking each quarter: the day this changes, the ingest
simplifies to a one-line collection load.

**IMD direct** — the Certificate of Undertaking states *"The data shall not be used for commercial
purpose"* and *"will not be put on Internet."* The same observations are free and public-domain through
NOAA GHCNh.

**OpenAerialMap, for Bengaluru** — the whole metro returns **exactly one** record: a 669 × 537 m drone
tile from 2022, **18.8 km from the nearest ward**. Sentinel-2 at 10 m is therefore the ceiling for
ground texture, as it was in Kolkata.

**JRC GHS-POP R2023A (E2010, E2020) — for Bengaluru population** — tested against the Census 2011 counts
of all 198 BBMP wards, each grid summed over each ward polygon: Pearson r of log population is **−0.03
(E2010) and −0.01 (E2020)**, against 0.56 for a uniform density. It **misplaces the south-east**: 64
contiguous south and east wards hold 3.01 M people in the census and 0.29 M in E2010. At box scale
(E2020, people/km²) Whitefield reads **565 against a census 4,010**, and MG Road **43,584 against
11,151**. Unconstrained WorldPop 2011 shows the same pattern (r = −0.07). Constrained WorldPop R2025A
(r = 0.595) is used instead; the full table is in [known-limitations.md](known-limitations.md) §14.
The error is already present in E2010, so it is not growth. Do not re-test on a newer epoch.

### The OpenCity licence position, stated so it can be revisited

`data.opencity.in` makes four inconsistent statements: per-dataset "Public Domain", a site footer saying
CC BY-NC-SA, terms saying non-commercial only, and an FAQ clarifying that **posts** are CC BY-NC-SA
while **data** is **ODbL**. We treat the FAQ as the authoritative disambiguation — the NC clause
attaches to their editorial posts, not the datasets.

**Position taken: the BBMP tree census and KGIS-derived layers are ODbL** — commercial use permitted,
**share-alike attaching to any derived database**. Where practical they are pulled from the KGIS
government service instead. **The founder has declined to seek written confirmation at this stage**;
that is recorded here so it can be revisited before any external publication of a derived database.

### The ward-vintage trap

Bengaluru's ward geometry moved twice and most published data has not caught up: 198 wards (2014
delimitation on Census 2011) → 243 proposed → 225 under the never-implemented BBMP Act 2020 → BBMP
abolished under the Greater Bengaluru Governance Act → **369 wards across five corporations, notified
19 Nov 2025**.

**So the ubiquitous "Census 2011 joined to 198 BBMP wards" product is two reorganisations stale**, and
wrong in the way that produces plausible-looking ward rankings rather than obvious errors. The BBMP tree
census also numbers its wards on the dead 198-ward scheme, which is why **trees are consumed by position
and never by ward join.**

---

## Free EO backbones the open-data pitch rests on (commercial use OK)

[Copernicus Data Space](https://dataspace.copernicus.eu/) · [MS Planetary
Computer](https://planetarycomputer.microsoft.com/) · AWS Open Data (Landsat/Sentinel) · NASA LP DAAC
(ECOSTRESS). These four keyless, commercial-clean sources are why the engine can claim an open-data spine
with no licence exposure.
