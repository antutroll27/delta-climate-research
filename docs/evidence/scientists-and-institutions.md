# Scientists & institutions

Named researchers and teams whose work the engine relies on, with the specific component that depends on
it. Cross-referenced to [methods-and-papers.md](methods-and-papers.md) for full citations. Affiliations
are given only where the docs state them; otherwise **not stated in docs**.

> Two honesty notes carried from the harvest:
> - The Gaussian-splatting / neural-rendering corpus (~30 papers) has **no author names anywhere in the
>   docs** — every entry is a title + arXiv/DOI link, so none appear below.
> - A formal academic citation for the Meta/WRI Canopy Height **v1** paper (Tolan et al.) and any citation
>   for Mapillary Vistas / Neuhold et al. ICCV 2017 are **absent from the repo** — flagged, not fabricated.
>   *(Updated 2026-09-05: the **v2** paper is now cited formally — Brandt et al. 2026, Scientific Data,
>   arXiv:2603.06382 — and v2 is what ships. The v1 gap stands.)*

## Researchers

> **2026-09-05 — the rooftop-PV tree-shading sourcing pass.** Five sources in these tables moved from
> *candidate* to *implemented* when trees entered the shading pass (Lindberg & Grimmond; Ratti & Richens;
> Konarska; Wu, Lu & Lin; Meta AI + WRI). What was taken, in every case, is a **published description** — an
> algorithm, or a measured constant. What was not taken: **no code** (SOLWEIG/UMEP is GPL and is not used;
> the pass depends only on numpy/scipy/rasterio/shapely) and **no contact** with any author — none has seen,
> reviewed or endorsed this work. Affiliations marked *per the paper* come from the publications themselves
> rather than from repo docs, and are the one deliberate exception to the rule stated above.

| Name / team | Affiliation (per docs) | Contribution | Component relying on it |
|---|---|---|---|
| **Lindberg, F. & Grimmond, C.S.B.** | University of Gothenburg / University of Reading (docs: "Gothenburg/Reading") | Developed & validated SOLWEIG (shadow-volume + SVF + Tmrt); R²=0.91, RMSE=3.1 K. Lindberg & Grimmond 2011, *Theor. Appl. Climatol.* 105 sets out the DSM shadow-casting algorithm | Accuracy-context benchmark for the heat-map's LST error bars. **Taken 2026-09-05:** the DSM shadow-casting algorithm, implemented from the paper's description, in the rooftop-PV tree-shading pass. **Not taken:** their SOLWEIG/UMEP code — it is GPL and is not used; no contact |
| **Ratti, C. & Richens, P.** | Ratti: MIT Senseable City Lab (per the senseable.mit.edu source linked in the docs); Richens: affiliation as on the paper | Shear-and-running-max shadow-volume algorithm (1990/1999); Ratti & Richens 2004, *Environment and Planning B* 31(2), raster analysis of urban form | **Taken 2026-09-05:** the shift-and-max shadow march, now the shadow engine of the rooftop-PV pass — no longer a candidate. **Not taken:** no code, no contact; the method reference only |
| **Konarska, J. et al.** | University of Gothenburg (*per the paper*; not stated in docs) | *2013:* vegetation transmissivity default (3 % canopy penetration, 25 % trunk zone), cited via UMEP. *2014, Theor. Appl. Climatol. 117:* measured transmissivity of solar radiation through the crowns of single urban trees | **Taken 2026-09-05:** the 2014 measurement is our **τ = 0.30 central value** for canopy beam transmittance in the rooftop-PV pass. The 2013 UMEP default is a *different number* and remains only a candidate vegetation-shadow parameterisation for the heat map — do not merge the two. **Not taken:** no code, no contact |
| **Wu, Y.-C., Lu, C.-L. & Lin, T.-P.** | National Cheng Kung University, Taiwan (*per the paper*; not stated in docs) | Wu, Lu & Lin 2025, *Sustainable Cities and Society* — measured solar radiation transmittance of tree canopy and building shade (SRT 0.18–0.60, mean ≈ 0.3, R² 0.95 against LAI) | **Taken 2026-09-05:** sets the **τ sensitivity band 0.20–0.50** swept in the rooftop-PV pass — the second-largest lever on the tree term after the mask rule. **Not taken:** no code, no contact |
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

## Institutions & teams (named directly in docs)

| Team / institution | Contribution | Component / use |
|---|---|---|
| **ECMWF, ESA, EUMETSAT; VITO** | Built + validated the Destination Earth UHI service (UrbClim model) | Heat-specific validation-transparency benchmark |
| **Meta AI + WRI** (Brandt et al.) | Produced the 1 m global Canopy Height Model on AWS Open Data (v1 + v2; **we ship v2, fetched since 2026-08-12**). v2: Brandt et al. 2026, *Scientific Data*, arXiv:2603.06382 — DINOv3 backbone, MAE 3.0 m, CC BY 4.0 | Canopy-height source for the **rendered** tree layer and, **taken 2026-09-05**, the canopy the rooftop-PV pass casts shadows from. Still **not** in the temperature solve. **Not taken:** no code, no contact; the v1 paper (Tolan et al.) is still cited as a dataset/provider rather than formally |
| **NRF (Singapore) + Dassault Systèmes; SLA; GovTech** | Built Virtual Singapore | Cited exemplar (proprietary platform + authoritative LiDAR — posture, not stack) |
| **City of Helsinki (open-data programme)** | Helsinki 3D+ / Kalasatama as open CityGML + reality mesh | Exemplar for open-data-as-authoritative |
| **Victorian Government + CSIRO** | Digital Twin Victoria's 4,000+ dataset catalogue | Exemplar for "provenance-as-product at scale" |
| **CDBB (Centre for Digital Built Britain)** | UK Gemini Principles (2018) | Template for a planned values statement |
| **NYC DOHMH** | NYC Heat Vulnerability Index | Exemplar for operational-definition transparency |
| **CAPA Strategies** | Heat Watch community heat-mapping | Anti-pattern (buries methodology off-page) |
| **Data Nutrition Project** | The "data nutrition label" framework | Template for the unified per-layer receipt |
| **Google (Earth Engine team)** | Earth Engine Data Catalog | Template for the per-dataset provenance card |
| **Our World in Data (OWID) team** | Grapher + measured-vs-derived labelling | Template for the measured-vs-modelled honesty line |
