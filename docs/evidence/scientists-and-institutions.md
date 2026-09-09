# Scientists & institutions

Named researchers and teams whose work the engine relies on, with the specific component that depends on
it. Cross-referenced to [methods-and-papers.md](methods-and-papers.md) for full citations. Affiliations
are given only where the docs state them; otherwise **not stated in docs**.

> Two honesty notes carried from the harvest:
> - The Gaussian-splatting / neural-rendering corpus (~30 papers) has **no author names anywhere in the
>   docs** — every entry is a title + arXiv/DOI link, so none appear below.
> - A formal academic citation for the Meta/WRI Canopy Height paper (Tolan et al.) and any citation for
>   Mapillary Vistas / Neuhold et al. ICCV 2017 are **absent from the repo** — flagged, not fabricated.

## Researchers

| Name / team | Affiliation (per docs) | Contribution | Component relying on it |
|---|---|---|---|
| **Lindberg, F. & Grimmond, C.S.B.** | "Gothenburg/Reading" | Developed & validated SOLWEIG (shadow-volume + SVF + Tmrt); R²=0.91, RMSE=3.1 K | Accuracy-context benchmark for the heat-map's LST error bars; shadow/SVF *intermediates* are the candidate reuse, not adopted |
| **Ratti, C. & Richens, P.** | Not stated (a linked source points to MIT Senseable City Lab — **verify**) | Shear-and-running-max shadow-volume algorithm (1990) | Candidate cheap shadow-raster method |
| **Konarska et al.** | Not in docs | Vegetation transmissivity default (3% canopy penetration, 25% trunk zone), via UMEP | Candidate vegetation-shadow parameterisation |
| **Wallenberg et al.** | Not in docs | Step-heating method for SOLWEIG wall-surface temperature (2026) | The "thermal admittance" ingredient still missing from the 2-D physics |
| **Jiao et al.** | Not in docs | Evaluated four sky-view-factor algorithms | SVF-method background reading |
| **Czekajlo, Coops, Wulder et al.** | Not in docs | Urban Greenness Score via 18-city Canadian Landsat unmixing (2020) | UGS pillar inspiration — internal review found the shipped formula is **not** their method (over-attribution corrected) |
| **Dhara, Deshpande, Roxy, Dalpadado & Shrestha** | Not in docs | India warming-delta projections, SSP2-4.5 / SSP5-8.5 (PLOS Climate 2025) | Green-score climate-projection scaling factors |
| **Li, Lu, Fu, Sun, Pan, Han, Guo & Li** | Not in docs | Tropical-megacity (incl. Kolkata) park-cooling thresholds/reach (2022) | Intervention model's park cooling-radius/threshold constants; **corrected** from an earlier "Mitra et al." miscite |
| **Voogt, J.A. & Oke, T.R.** | Not in docs | Surface-UHI vs canopy-air-UHI as distinct quantities; thermal view-angle sensitivity (2003) | Surface-vs-air honesty framing; candidate explanation for the ECOSTRESS/Landsat offset |
| **Gunawardena & Steemers** | Not in docs | Vertical-greening heat-island/energy impact (2023) | Green-score cooling-evidence table |
| **Brutsaert, W.** | Not in docs | Clear-sky-emissivity formula (1975) | `_physics.sky_temp()` — its fitted coefficient `c` is flagged as a structural weakness |
| **Spencer, J.W.** | Not in docs | Solar-declination series (1971) | `_physics.solar_factor()` |
| **Peng, S. et al.** | Not in docs | Equal-area rural-reference UHI-differencing method (2012) | The model's heat-island-difference calculation |
| **Chakraborty, T. & Lee, X.** | Not in docs | Global day/night UHI benchmarks + water-masking rationale (2019) | Sanity-check benchmark (not calibration) |
| **Nayak, Vinod & Prasad; Jain; Siddiqui et al.; Shastri et al.; Kumar et al.** | Not in docs | Regional/India UHI benchmark measurements | Sanity-check benchmarks (not calibration) |
| **Sailor et al.** | Not in docs | Mumbai anthropogenic-heat inventory (2016) | Anthropogenic-heat band (0.4–0.6) in the calibration spec |
| **Carlson, T.N. & Ripley, D.A.** | Not in docs | NDVI→FVC endmember method (1997) | FVC computation in `_sentinel.py` / `fetch-sentinel-composites.py` — code comments only; full citation not in docs (**verify**) |
| **Magruder, L. et al.** | Not in docs | ATL03 geolocation-accuracy + footprint-spot-size (2021) | Justifies the 5 m ICESat-2 footprint erosion; exposed a "spot-blur" gap |
| **Luthcke, S. et al.** | Not in docs | ICESat-2 precision-orbit/pointing budget (2021) | Supporting geolocation-error evidence |
| **Wang et al.** | Not in docs | Building-boundary blur from the ATL03 footprint (2024) | The disclosed limitation of the ICESat-2 height-validation claim |
| **Cai et al.** | Not in docs | ICESat-2 building-height method with land-cover/FABDEM/relief guards (2024) | Ground-line guard design; independently converges on the same 10 m relief threshold this project measured |
| **Wu, Huang & Zhao; Hu et al.; Dandabathula et al.; Wu, Z. (TU Delft MSc); Liu et al.; Lao et al.; Kaya; Goud & Bhardwaj; Watson & Elliott** | Not in docs | Comparative ICESat-2 roof-estimator + photon-count literature | Context for this project's p75 estimator, roof-band floor, and `MIN_ROOF_PH` — none changed the shipped method |
| **Singh et al.** | Not in docs | INSAT-3D/3DR split-window LST retrieval (2016) | Proposed geostationary transfer-standard for the ECOSTRESS↔Landsat offset |
| **Kamath, Niyogi et al.** | University of Texas at Austin | UT-GLOBUS: machine-learned per-building height/area/volume/surface, *Sci Data* 11:617 (2024), CC BY 4.0 | The **cross-check** on Bangalore building heights — deliberately not blended into the primary. US-LiDAR validation only (RMSE 9.1 m) |
| **Alonzo, M. & Corton** | Not in docs | Meta/WRI urban canopy validation across 15 cities **including Bangalore**; balanced accuracy 79.7 % | Justifies aggregating canopy to coarse resolution rather than making per-tree claims — applies directly to the Bangalore wards |

## Institutions & teams (named directly in docs)

| Team / institution | Contribution | Component / use |
|---|---|---|
| **ECMWF, ESA, EUMETSAT; VITO** | Built + validated the Destination Earth UHI service (UrbClim model) | Heat-specific validation-transparency benchmark |
| **Meta AI + WRI** | Produced the 1 m global Canopy Height Model on AWS Open Data (v1 + v2; **we ship v1**) | Canopy-height source for the **rendered** tree layer. Render-only since 2026-08-12: it does not enter the temperature solve (no formal paper in docs — flagged) |
| **NRF (Singapore) + Dassault Systèmes; SLA; GovTech** | Built Virtual Singapore | Cited exemplar (proprietary platform + authoritative LiDAR — posture, not stack) |
| **City of Helsinki (open-data programme)** | Helsinki 3D+ / Kalasatama as open CityGML + reality mesh | Exemplar for open-data-as-authoritative |
| **Victorian Government + CSIRO** | Digital Twin Victoria's 4,000+ dataset catalogue | Exemplar for "provenance-as-product at scale" |
| **CDBB (Centre for Digital Built Britain)** | UK Gemini Principles (2018) | Template for a planned values statement |
| **NYC DOHMH** | NYC Heat Vulnerability Index | Exemplar for operational-definition transparency |
| **CAPA Strategies** | Heat Watch community heat-mapping | Anti-pattern (buries methodology off-page) |
| **Data Nutrition Project** | The "data nutrition label" framework | Template for the unified per-layer receipt |
| **Google (Earth Engine team)** | Earth Engine Data Catalog | Template for the per-dataset provenance card |
| **Our World in Data (OWID) team** | Grapher + measured-vs-derived labelling | Template for the measured-vs-modelled honesty line |
| **ATREE — Centre for Social and Environmental Innovation (CSEI)** | Lakes & Streams of Bengaluru Urban: 181 lake polygons, 3,927 stream lines, **CC-BY**, carrying a `Valley` field that names the tank chain | The Bangalore water layer. The tank-chain attribute is what lets the city's water read as a connected system rather than scattered ponds — no other surveyed source carries it |
| **Greater Bengaluru Authority (GBA)** | The 369-ward, five-corporation delimitation notified **19 Nov 2025** | The pinned ward geometry. Guards against the widespread "Census 2011 → 198 BBMP wards" join, which is now two reorganisations stale |
| **BBMP (Bruhat Bengaluru Mahanagara Palike)** | Tree census, July 2026: 702,109 trees with species and ward | Tree species and position. **An inventory, not a density field** — counts track enumeration effort ([known-limitations.md §9](known-limitations.md)) |
| **KSRSAC / Karnataka GIS (K-GIS)** | `State_LULC_2023` land cover via ArcGIS REST (used); 50 cm imagery (**barred — no commercial use**) | Land cover is first-party and in use. The sub-metre imagery is the clearest case that Bangalore's texture ceiling is contractual, not financial |
