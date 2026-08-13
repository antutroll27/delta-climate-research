# Methods & papers

Academic and methodological citations behind the engine, grouped by what they inform. Each carries how
the engine actually *uses* it — and, where relevant, the correction on record. Items whose full
citation isn't in the repo docs are marked **(verify)**.

> Harvested from `docs/research/`, `docs/superpowers/specs/`, calibration + methodology docs, and code
> comments. DOIs/links are as-found; **(verify)** flags where a detail was not independently confirmed.

---

## Credibility, uncertainty & digital-twin critique

- **Trust & uncertainty-visualisation study (N=161), 2026** · authors not named in docs ·
  [arxiv.org/abs/2602.00248](https://arxiv.org/abs/2602.00248) — visualising uncertainty on thematic maps
  generally *reduces* trust in the data's accuracy but barely touches trust in the mapmaker's integrity;
  low-uncertainty displays show no penalty vs showing nothing. **Engine use:** governs the honesty-UX rule
  — confidence surface shown by default, CIs/QC one click away, never the loud default
  (`2026-08-09-city-twin-credibility-research.md` §0, §1.3).
- **Digital-twin critique — Frontiers in Big Data**, 10.3389/fdata.2023.1236397 (2023) ·
  [frontiersin.org](https://www.frontiersin.org/journals/big-data/articles/10.3389/fdata.2023.1236397/full)
  — many city twins are "dashboards that look impressive but lack depth"; "digital twin" implies real-time
  bidirectional coupling that scientists discount when claimed by static visualisations. **Engine use:**
  validates the no-photoreal constraint and the self-description as an "observatory/model," not a "digital
  twin."
- **Naveed et al. 2025 — ML-assisted predictive urban digital twin for AQI** · Environmental Modelling &
  Software **192:106559**, CC-BY 4.0 ·
  [doi.org/10.1016/j.envsoft.2025.106559](https://doi.org/10.1016/j.envsoft.2025.106559) — Delhi 2015–2024,
  87,633 hourly rows; six deep models benchmarked, CNN-1D-2 reported best at **R² 0.99951 / RMSE 3.009 /
  MAPE 0.01231**; stack Blender → Azure Digital Twins (DTDL) → InfluxDB → Grafana, with city geometry
  skinned by AQI category colour (Figs 18–21). The closest published analogue to what we are building, and
  useful in three separate ways.
  **(a) Display precedent** — threshold-coloured 3D geometry driven from a live time-series store is the
  shape of our Phase-2 AQI overlay. Note what it does *not* do: the whole city takes ONE colour from ONE
  scalar, so there is no within-city field at any point.
  **(b) Anti-pattern — RECORDED AS A CAUTION, NOT A MEASUREMENT.** We did not run the counter-test and are
  not claiming a measured refutation. On reading: AQI is a deterministic piecewise-linear function of the
  pollutants (the paper's own Eq. 1 and Table 1 breakpoints) and those same pollutants are the model's
  inputs, so the headline R² may be recovering an identity rather than forecasting; **no persistence or
  closed-form baseline is reported anywhere**; the 70/30 split is given by sample count (26,290) rather
  than by date, which leaks adjacent hours on an hourly series; and "model accuracy 97.950647" applies a
  classification metric to a regression at seven significant figures. Settling it needs the paper's Kaggle
  source (`rohanrao/air-quality-data-in-india`) — **deliberately not done**, because we do not model AQI
  (CEO, 2026-08-13: it comes from an API).
  **(c) A standards mismatch not to inherit** — Fig. 1 defines AQI the **CPCB (India)** way (NH₃ included,
  "at least three pollutants, at least one PM"), while Table 1 and Fig. 2 give **US EPA** breakpoints and
  categories. Do not lift breakpoints from this paper.
  **Engine use:** the threshold-colour precedent for the Phase-2 overlay; the reason that overlay must ship
  a station-coverage statement instead of a painted ward; and the reason its breakpoints get transcribed
  from the official CPCB document rather than a secondary source. See
  `docs/superpowers/specs/2026-08-13-aqi-overlay-design.md`.
- **UK Gemini Principles** (CDBB, Dec 2018) ·
  [cdbb.cam.ac.uk](https://www.cdbb.cam.ac.uk/DFTG/GeminiPrinciples) — canonical values framework for
  trustworthy twins. **Engine use:** template for a planned "About this instrument" values statement.
- **Google Earth Engine Data Catalog — dataset-description schema** ·
  [developers.google.com](https://developers.google.com/earth-engine/help_dataset_description) — the
  per-dataset "receipt" field set (provider, coverage, resolution, bands, licence, citation, DOI).
  **Engine use:** template copied verbatim for the per-layer provenance card.
- **Our World in Data — FAQ/methodology** · [ourworldindata.org/faqs](https://ourworldindata.org/faqs) —
  measured-vs-derived labelling convention. **Engine use:** template for distinguishing measured satellite
  inputs from the modelled heat surface.
- **NYC Heat Vulnerability Index** ·
  [a816-dohbesp.nyc.gov](https://a816-dohbesp.nyc.gov/IndicatorPublic/data-features/hvi/) — operational
  public-health index with an explicit trigger definition + cited peer-reviewed method. **Engine use:**
  exemplar for publishing exact operational definitions.
- **Destination Earth — UHI/UrbClim** (ECMWF, ESA, EUMETSAT; VITO) ·
  [destination-earth.eu](https://destination-earth.eu/use-cases/addressing-urban-heat-island-effect/) —
  UrbClim validated vs 67 pan-European met stations (Copernicus C3S); a separate DestinE Prague/Lisbon
  demo (Summer 2022) noted most stations were non-optimally sited. **Engine use:** validation-transparency
  benchmark — surface the LOO-overpass validation with the same candour.
- **Data Nutrition Project** + **ISO 19115** (lineage) / **ISO 19157** (quality) ·
  [datanutrition.org](https://datanutrition.org/) · [framework paper](https://arxiv.org/pdf/1805.03677) ·
  [ISO 19115](https://www.iso.org/standard/32575.html) — standardised provenance/quality label. **Engine
  use:** unifying packaging for the per-layer receipt.
- **Maplibrary.org — attribution layering guidance** ·
  [maplibrary.org](https://www.maplibrary.org/9939/how-to-effectively-layer-attribution-information-in-maps/)
  — four required attribution elements (source, acquisition date, licence, provider). **Engine use:**
  persistent "data as of" chrome.
- **CAPA Strategies — Heat Watch methodology** ·
  [capastrategies.com](https://www.capastrategies.com/heat-watch-data) — anti-pattern exemplar: rigorous
  mapping that delegates methodology to a separate linked report. **Engine use:** the rule that receipts
  must be one click from the number.

*(City-twin precedents — Virtual Singapore, Helsinki 3D+, Digital Twin Victoria, 3D Tiles/glTF standards —
are catalogued in [digital-twin-references.md](digital-twin-references.md).)*

---

## Landsat / ECOSTRESS thermal validation, emissivity, forcing

- **Landsat Collection 2 Level-2 ST algorithm docs (LSDS-1619)** — documents bands, defers formula to a
  Cal/Val ADD. **Engine use:** the LST-from-radiance formula was independently re-derived and verified
  against 67,600 pixels of `LC09_L2SP_138044_20260704_02_T1` rather than taken on faith
  (`2026-08-09-forcing-and-emissivity-upgrade-design.md` §3.1). Winning arrangement:
  `(TRAD − URAD − ATRAN·(1−ε)·DRAD) / (ATRAN·ε)`, median |ΔT| 0.168 K vs shipped `ST_B10`, Planck-inverted
  via `T = K2 / ln(K1/B + 1)`.
- **ECMWF ERA5-Land** (Copernicus CDS), DOI `10.24381/cds.e2161bac` — 0.1°/~9 km, hourly
  `surface_solar_radiation_downwards` (169), `surface_thermal_radiation_downwards` (175). **Engine use:**
  proposed to fit the missing shortwave-atmosphere term and move the Brutsaert `c` constant off surface-LST
  fitting onto atmospheric data (§4.3–4.4); **not yet adopted** — gated on a pre-registered
  leave-one-overpass-out bar.
- **Brutsaert (1975)**, *Water Resources Research* 11(5):742–744, DOI
  [10.1029/WR011i005p00742](https://doi.org/10.1029/WR011i005p00742) — clear-sky emissivity formula.
  **Engine use:** replaces two hard-coded sky temperatures in `_physics.sky_temp()`; its coefficient `c` is
  currently fitted against LST (flagged as a structural defect the ERA5-Land spec proposes to fix).
- **Spencer (1971)**, *Search* 2(5):172 — solar-declination series. **Engine use:** per-scene sun-angle
  geometry in `_physics.solar_factor()`.
- **Voogt & Oke (2003)**, *Remote Sensing of Environment* 86(3):370–384, DOI
  [10.1016/S0034-4257(03)00079-8](https://doi.org/10.1016/S0034-4257(03)00079-8) — daytime *surface* UHI
  (10–15 °C) vs canopy *air* UHI (2–5 °C) are different quantities; view-angle sensitivity of thermal
  remote sensing. **Engine use:** underlies the surface-vs-air honesty distinction; candidate explanation
  for the ECOSTRESS/Landsat view-geometry offset.
- **Sentinel-3 SLSTR** (Copernicus) — dual-view thermal (1 km nadir, S7–S9/F1/F2), 0.9-day mean revisit.
  **Engine use:** proposed to directly measure the view-angle-anisotropy hypothesis for the
  ECOSTRESS↔Landsat offset (spec §10.3); licence permissive but "commercial" not explicitly stated —
  flagged before use.
- **INSAT-3D/3DR split-window LST — Singh et al. 2016**, *JGR Atmospheres*, DOI `10.1002/2016JD024752` —
  geostationary retrieval method. **Engine use:** proposed as a geostationary transfer standard to solve
  the ECOSTRESS/Landsat near-zero-coincidence problem (spec §10.4); gated on a written MOSDAC licence
  confirmation.
- **Mumbai anthropogenic-heat inventory — Sailor et al. 2016** (venue not in docs) — ~16 W/m² total,
  metabolism (6.5) > building energy (5.8), flatter diurnal than Western cities. **Engine use:** basis for
  the 0.4–0.6 anthropogenic-heat band in `heat-map-calibration-spec.md`.
- **ECOSTRESS L2T LSTE v002 quality flags** ·
  [lpdaac.usgs.gov](https://lpdaac.usgs.gov/products/eco_l2t_lstev002/) — per-pixel QC bitmask + LST-error
  band; v002 moved cloud out of QC into a separate `cloud_mask`. **Engine use:** the satellite's own
  confidence, shown rather than invented.

---

## ICESat-2 building-height validation — comparison literature

*(from `2026-08-06-icesat2-height-validation-design.md` §9, mirrored in `docs/heat-map-feature.md`; none
of these changed the shipped p75 method — they are context/benchmarking)*

- **Magruder et al. 2021**, DOI [10.1029/2020EA001414](https://doi.org/10.1029/2020EA001414) — ATL03
  horizontal geolocation 3.5±2.1 m (vs 6.5 m requirement); footprint spot 10.9±1.2 m. **Engine use:**
  justifies the 5 m footprint erosion; the spot-size figure exposed an undisclosed "boundary blur" gap.
- **Luthcke et al. 2021**, DOI [10.1029/2020EA001494](https://doi.org/10.1029/2020EA001494) —
  precision-orbit and pointing budget underlying the above.
- **Wang et al. 2024**, DOI [10.1109/TGRS.2024.3383600](https://doi.org/10.1109/TGRS.2024.3383600) —
  ≈6 m horizontal RMSE building-boundary blur from the ATL03 footprint, reducible to ≈1 m only by
  deconvolution (not done here).
- **Wu, Huang & Zhao 2023**, DOI [10.3390/rs15153786](https://doi.org/10.3390/rs15153786) and **Hu et al.
  2026**, DOI [10.3390/rs18040540](https://doi.org/10.3390/rs18040540) — roof-height estimator: p90.
- **Cai et al. 2024**, DOI [10.3390/rs16020263](https://doi.org/10.3390/rs16020263) — roof estimator:
  max-after-filtering; roof-band floor 2.8 m; independently tuned a 10 m relief threshold (converges with
  this project's independently-measured 10 m `GROUND_RELIEF_M`); adds Sentinel-2 land cover + FABDEM +
  relief filter as ground-line guards (this project uses only one internal guard, flagged as the
  least-guarded component).
- **Dandabathula et al. 2021**, DOI [10.1088/2634-4505/abf820](https://doi.org/10.1088/2634-4505/abf820) —
  Jaipur, n=10; roof estimator: mean.
- **Wu, Z. 2022** — TU Delft MSc thesis (not peer reviewed) — roof estimator: p50.
- **Liu et al. 2024**, DOI [10.3390/s24186076](https://doi.org/10.3390/s24186076) — roof-band floor 2.5 m.
- **Lao et al. 2021**, DOI [10.1016/j.jag.2021.102596](https://doi.org/10.1016/j.jag.2021.102596) — n=82;
  reported (unverified against full text) that ATL03's own noise removal discards building photons below
  ~3 m — flagged as an unverified, high-consequence claim.
- **Kaya 2024**, DOI [10.3390/buildings14113571](https://doi.org/10.3390/buildings14113571) — the only
  study found testing accuracy vs photon count; best at 5–10 photons, degrading above 100 — corroborates
  this project's `MIN_ROOF_PH = 5`.
- **Goud & Bhardwaj 2021** — Hyderabad/Paris/Vancouver, n=30 (venue not in docs).
- **Watson & Elliott 2025**, *Scientific Reports*, DOI
  [10.1038/s41598-025-15929-2](https://doi.org/10.1038/s41598-025-15929-2) — Nairobi, Quito, Kathmandu,
  n=25/city, manual.
- **Comparison finding:** no ICESat-2 building-height study exists for Kolkata, Dhaka, or the Ganges
  delta; Global-South coverage is thin (Jaipur n=10; Hyderabad in a 3-city n=30).

---

## Vegetation, NDVI → FVC

- **Carlson & Ripley 1997** (NDVI→FVC endmember method) — in the repo only as code comments
  (`scripts/_sentinel.py:55`, `scripts/fetch-sentinel-composites.py:131`); full author list/venue/DOI
  **not in docs — verify**. **Engine use:** underlies `FVC = (NDVI − NDVI_bare)/(NDVI_veg − NDVI_bare)` in
  `dc-urs-source-of-truth.md` §3; flagged by internal review as redundant with NDVI in the current UGS
  weighting.
- **Czekajlo, Coops, Wulder et al. (2020)**, *Int. J. Applied Earth Obs. & Geoinformation* 93:102210 —
  Urban Greenness Score via spectral unmixing of annual Landsat composites, 18 Canadian cities 1984–2016.
  **Engine use / correction on record:** cited as inspiration for the UGS pillar, but internal review
  (`dc-urs-engineering-review.md` §4) found the shipped `φ₁·NDVI + φ₂·FVC + φ₃·VSI` formula is **not**
  Czekajlo's method and should not be attributed as such; the Canadian calibration doesn't transfer; its
  33-year composites (vs single-scene NDVI) are why Kolkata inputs need seasonal composites.
- **Meta AI / WRI 1 m Canopy Height Model — we ship v1** — dataset detail in
  [data-sources.md](data-sources.md); cited as a dataset/provider, **not** as a formal paper (Tolan et al.
  **not in docs — verify**). **RENDER-ONLY since 2026-08-12:** it places and scales the drawn trees and does
  **not** enter the temperature solve. *(This line previously read "(v2)"; we ship v1 — the same correction
  already recorded in data-sources.md.)*
- **ESA WorldCover** (2020/2021), CC BY 4.0, DOI `10.5281/zenodo.7254221` — coarse land-cover mask;
  cross-checks/gap-fills the CHM.
- **Mapillary Vistas / Neuhold et al. ICCV 2017** — **not in the repo at all.** Mapillary appears only as a
  *rejected* vegetation source (no tree class exposed by its API); no academic paper is cited for it
  anywhere. Recorded here so the absence is explicit, not an oversight.

---

## Cooling evidence, green infrastructure, UHI benchmarks

- **Dhara, Deshpande, Roxy, Dalpadado & Shrestha (2025)**, *PLOS Climate* 4(11):e0000724, DOI
  [10.1371/journal.pclm.0000724](https://doi.org/10.1371/journal.pclm.0000724) — India warming deltas
  under SSP2-4.5 (+1.25 °C, 2041–60) and SSP5-8.5 (+4.1 °C). **Engine use:** the two warming-pathway deltas
  in the green-score climate-projection scaling (`green-score-methodology.md` §4.5); a previously-included
  third "negative" pathway was deleted as unsupported by the citation.
- **Li, Lu, Fu, Sun, Pan, Han, Guo & Li (2022)**, *Frontiers in Environmental Science*, DOI
  [10.3389/fenvs.2022.1073914](https://doi.org/10.3389/fenvs.2022.1073914) — tropical-megacity park cooling
  incl. Kolkata: threshold-value-of-effect 0.77 ha, cooling reach 420 m, daytime max UCI 8.07 °C (Kolkata)
  vs 4.83 °C (Bangkok — a *different* city). **Correction on record:** previously miscited as "Mitra et al.
  2022" with a false "4.83–8.07 °C Kolkata band"; corrected 2026-08-08.
- **Schwaab, Meier, Mussetti, Seneviratne, Bürgi & Davin (2021)**, *Nature Communications* 12:6763 — LST
  cooling by urban trees vs treeless green space across **293 European cities**; trees cool roughly **2–4×**
  more than grass-only green, with a strong north–south gradient. **Engine use — this one changed the
  physics.** It is the external yardstick that condemned the canopy→vegetation blend: at the shipped
  strength of 0.5 our *implied* tree:grass vegetation ratio was **4.9–8.1×**, outside the published range,
  while raw NDVI-derived FVC already sits in band at **2.0–2.7×**. Together with a monotonic loss of
  ECOSTRESS agreement, that put `CANOPY_BLEND_STRENGTH` to 0 on 2026-08-12 — see
  [known-limitations.md §1](known-limitations.md). **Caveat we state ourselves:** the sample is European and
  Kolkata is not in it, so this is used as an order-of-magnitude plausibility bound, never as a calibration.
  *(DOI not verified from the repo — confirm before citing externally.)*
- **Gunawardena & Steemers (2023)**, *Buildings & Cities* 4(1), DOI
  [10.5334/bc.282](https://doi.org/10.5334/bc.282) — neighbourhood vertical greening: heat-island intensity
  1.86→1.81 K (~3%); energy 2.1–5.2%.
- **LBNL Heat Island Group** — cool-roof albedo (0.15 dark / 0.60 aged-cool).
  [heatisland.lbl.gov](https://heatisland.lbl.gov/coolscience/cool-roofs).
- **WRI India — "Urban Trees' Cooling Potential"** — Bangalore −5.6 °C air / −27.5 °C surface; +10% canopy
  ≈ −0.3 °C air. [wri.org/insights](https://www.wri.org/insights/urban-trees-cooling-potential).
- **arXiv 2512.11753 (2025)** — targeted street greening beats uniform (1.5% area → −19% effect); authors
  not in docs.
- **Zhengzhou park spillover, 2023**, *Frontiers in Earth Science* — cooling distance mean 179 m, ~1
  °C/100 m; author not in docs.
- **Blue-green corridors, PMC8622358** — corridor cooling to 600–750 m, optimal width 20–35 m; author not
  in docs.
- **Yang et al. 2026**, *Sustainable Cities and Society* — 68% of parks show exponential cooling decay
  (abstract-verified only).
- **Nguyen et al. 2025** — Hanoi exponential cooling decline (abstract-verified only).
- **Nature Communications 2021** — 40% canopy-cover saturation threshold; author not in docs.
- **Arboriculture & Urban Forestry (2021)** — street-tree spacing/crown data; author not in docs.

### UHI benchmarks (used to sanity-check, not calibrate)

- **Nayak, Vinod & Prasad (2023)**, *Applied Sciences* 13(24):13323, DOI
  [10.3390/app132413323](https://doi.org/10.3390/app132413323) — Kolkata night SUHII 0.85 °C annual.
- **Jain (2023)**, *Frontiers in Sustainable Cities* 5:1084573, DOI
  [10.3389/frsc.2023.1084573](https://doi.org/10.3389/frsc.2023.1084573) — Kolkata night 1.3–1.5 °C (DJF).
- **Siddiqui et al. (2021)**, *Sustainable Cities and Society* 75:103374, DOI
  [10.1016/j.scs.2021.103374](https://doi.org/10.1016/j.scs.2021.103374) — Indian metros night
  1.34–2.07 °C.
- **Peng et al. (2012)**, *Environmental Science & Technology* 46(2):696–703, DOI
  [10.1021/es2030438](https://doi.org/10.1021/es2030438) — global 1.5 °C day / 1.1 °C night; equal-area
  rural-reference method. **Engine use:** method for the model's heat-island difference calculation.
- **Chakraborty & Lee (2019)**, *Int. J. Applied Earth Obs. & Geoinformation* 74:269–280, DOI
  [10.1016/j.jag.2018.09.015](https://doi.org/10.1016/j.jag.2018.09.015) — global 0.85 °C day / 0.55 °C
  night; water-masking rationale.
- **Shastri et al. (2017)**, *Scientific Reports* 7:40178, DOI
  [10.1038/srep40178](https://doi.org/10.1038/srep40178) — Indian daytime *cool*-island in the
  pre-monsoon.
- **Kumar et al. (2017)**, *Scientific Reports* 7:14054, DOI
  [10.1038/s41598-017-14213-2](https://doi.org/10.1038/s41598-017-14213-2) — 60% of 89 Indian urban areas
  show a daytime cool island.

---

## Urban canopy-height validation — what "good" actually looks like

Gathered 2026-08-12 because our own cross-checks kept landing at **r ~ 0.4-0.5** and we needed to know
whether that is a failure or the norm. It is the norm. This section exists so nobody — us included — reads
our agreement statistics without the benchmark beside them.

- **Published urban validations of global canopy products get R² 0.28-0.69 (r ~ 0.53-0.83), RMSE
  4.4-18 m.** The best directly comparable case is a *tropical city*: Tolan et al.'s own São Paulo tile at
  **R²-block 0.41, RMSE 7.3 m**. Our Kolkata figures sit inside that band.
- **Moudrý et al. 2026**, DOI [10.1029/2025EA004544](https://doi.org/10.1029/2025EA004544) — against the
  *same* Czech airborne lidar, Meta reads **ME −6.9 m** and ETH **+4.8 m**: an **~11.7 m divergence between
  the two products**, larger than the Kolkata gap we were worried about.
- **Moudrý et al. 2024**, *Ecosphere*, DOI [10.1002/ecs2.70026](https://doi.org/10.1002/ecs2.70026) — ETH
  "overestimates the height of low canopies (up to 10 m high) **on average by 10 m**", and overestimates
  above 30 m. This reproduces, almost exactly, the ~9-10 m gap our first (mis-specified) ETH comparison
  produced — the behaviour is documented, not anomalous. Open-access summary in *Bosque* 46(2):129-140.
- **Milan, against a municipal tree register:** only **25% (Meta) / 32% (ETH)** of heights land within
  ±5 m. A sobering number for anyone expecting a global product to resolve individual street trees.
- **Alonzo & Corton 2026**, *Urban Forestry & Urban Greening* — the Meta/WRI urban validation to cite:
  7,500 points across **15 cities including Bangalore**, balanced accuracy **79.7%**, and the
  recommendation that the product "can be used with caution at the point scale (1 m) and **confidently when
  aggregated to coarser (30-180 m) resolution**." This independently justifies our fixed-reference,
  ward-aggregated density approach rather than per-pixel tree claims. *(Per-city table unverified —
  paywalled; figures via search extraction. Confirm against the PDF before publishing.)*
- **Both products show the documented OLUH effect** — Overestimate Low, Underestimate High canopy — which
  in a real 3-8 m canopy predicts precisely the direction of disagreement we measure.

**How to state our own result honestly:** do not claim r ~ 0.4 is *good*. Claim it is **expected**, name the
benchmark, and say why — 10 m products carry ~25 m effective resolution, and a ward of 3-8 m street trees is
the hardest case for them. That framing survives a reviewer who knows the literature; "our data agrees" does
not.

---

## Composite-index & standards methodology

- **OECD/JRC (2008)**, *Handbook on Constructing Composite Indicators*, DOI
  [10.1787/9789264043466-en](https://doi.org/10.1787/9789264043466-en) — equal-weighting practice + the
  requirement for sensitivity analysis.
- **Berlin Biotope Area Factor** (Senate Dept. for Urban Development) — greening weights, 0.30–0.60 target
  band. [berlin.de](https://www.berlin.de/sen/uvk/en/nature-and-green/landscape-planning/baf-biotope-area-factor/).
- **Seattle Green Factor** (SDCI) — cross-check on surface weights.
  [seattle.gov](https://www.seattle.gov/sdci/codes/codes-we-enforce-(a-z)/seattle-green-factor).
- **Singapore Green Plot Ratio** (URA LUSH) — third comparator on the weighted-area form
  (abstract/catalogue-verified only).
  [ura.gov.sg](https://www.ura.gov.sg/Corporate/Guidelines/Development-Control/Non-Residential/EI/Greenery).

---

## Urban microclimate modelling (SOLWEIG/UMEP) — mined for methods, model not adopted

- **Lindberg, F. & Grimmond, C.S.B. (2011)**, *Theoretical and Applied Climatology* 105:311–323, DOI
  [10.1007/s00704-010-0382-8](https://doi.org/10.1007/s00704-010-0382-8) — developed/validated SOLWEIG;
  Tmrt validation R²=0.91, RMSE=3.1 K over five days in Göteborg. **Engine use:** cited as a field
  calibration reference ("our 2.31 K peak / 2.93 K night LST error is not the embarrassment it feels like at
  2 a.m."); its shadow/SVF *intermediates* (not the Tmrt model) are the candidate methods, since SOLWEIG
  computes a person-level comfort variable while this engine predicts satellite-view LST.
- **Ratti, C. & Richens, P. (1990/1999)** — originated the shear-and-running-max shadow-volume algorithm
  later re-described in Lindberg & Grimmond 2011; MIT Senseable City Lab affiliation is **inferred, not
  stated — verify**. **Engine use:** candidate cheap shadow-raster method (superseded by the observation
  that a three.js shadow-map render pass may already compute the same thing).
- **Konarska et al. (2013)** — vegetation transmissivity default (3% canopy penetration; trunk zone at 25%
  of canopy height), via UMEP docs. Full citation not in docs.
- **Wallenberg et al. (2026)**, *Geoscientific Model Development* 19:1321 — step-heating solution for
  SOLWEIG wall-surface temperature. [gmd.copernicus.org](https://gmd.copernicus.org/articles/19/1321/2026/).
  **Engine use:** candidate thermal-admittance method — "our third named ingredient" (with shadowing,
  moisture, 3-D geometry) still missing from the 2-D physics.
- **Jiao et al. (2019)**, *Earth and Space Science*, "Evaluation of Four Sky View Factor Algorithms" ·
  [agupubs](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2018EA000475).
- Additional shadow/SVF literature cited by title only (no named authors in docs): *SVF Calculation in
  Urban Context* (*Climate* 6(3):60); *Seasonal Effect of Building Shadows on Urban LST* (*Remote Sensing*
  11(5):497, [doi](https://doi.org/10.3390/rs11050497)); *Effect of extremely low SVF on LST*; *3D urban
  morphology on surface temperature*; *Satellite-derived LST strongly mischaracterise urban heat hazard*
  ([arxiv 2509.16568](https://arxiv.org/pdf/2509.16568)).

> **Note on SVF for this engine — measured and REJECTED, with the receipt in-repo.**
> The claim under test was specific: `types.ts` governs the model with a **scalar** `kRad`, so every cell
> radiates to a full hemisphere. A real canyon at SVF 0.4 loses far less longwave than open ground at 1.0,
> so if that omission mattered it had to show as structure in residuals we already had. The **direction was
> pre-registered** — positive correlation at night would mean the missing sky-view term is real.
>
> It came back **significant and the wrong way round**, on both phases:
>
> | phase | scenes | mean r | median r | % positive | sign-test p | verdict |
> |---|---|---|---|---|---|---|
> | night | 50 | **−0.514** | −0.469 | **0.0%** | 1.8 × 10⁻¹⁵ | rejected, wrong sign |
> | day | 37 | **−0.505** | −0.512 | 2.7% | 5.5 × 10⁻¹⁰ | rejected, wrong sign |
>
> Method: 5 m DSM, 16 azimuths, 150 m search radius, SVF = mean_φ(1 − sin²β), residual taken as
> (model − model.mean()) − (obs − obs.mean()). The physical reading is that our wards have no canyons —
> measured SVF spans only ~0.82–0.92 — so the term has almost no range to act over, and the correlation is
> picking up whatever else co-varies with built density.
>
> **Honest caveat:** a *post-hoc* partial correlation at night flips weakly positive (mean r = +0.048, 68%
> of scenes positive, p = 0.015). It is post-hoc, the effect is tiny, and the day partial shows nothing
> (r = −0.050, p = 0.32) — so it does not rescue the hypothesis. It is recorded because suppressing an
> inconvenient-but-weak signal is exactly the failure mode this library exists to prevent.
>
> **Receipt:** [`scripts/measure-svf-signtest.py`](../../scripts/measure-svf-signtest.py) ·
> [`data/calibration/svf-signtest.json`](../../data/calibration/svf-signtest.json) (87 scene rows).
> The SVF literature above is retained as *why we checked*, not as an adopted method. The companion
> shadow half of this test is a separate, later measurement.

---

## 3D Gaussian splatting, neural rendering, neural microclimate surrogates (survey only — not adopted)

A ~30-item corpus cited by **title + arXiv/DOI only — no author names in the docs**, so none appear in the
scientist roster. Background survey for a possible future rendering/simulation upgrade
(`docs/learning-sunday-01-3d-twins-simulation-splatting.md`,
`2026-08-09-gaussian-splatting-and-3d-twins.md`,
`2026-08-09-real-time-simulation-webgpu-and-neural-surrogates.md`,
`2026-08-09-3d-simulation-rendering-library-survey.md`). Grouped:

- **Standards/tooling:** Khronos/OGC geospatial 3D-Gaussian-splat glTF extension; Cesium 3D Tiles LOD
  splat announcements.
- **City-scale splatting:** Gaussian Building Mesh (GBM, [arxiv](https://arxiv.org/html/2501.00625)),
  CityGaussian, Octree-GS, BlitzGS, MetroGS, TraGraph-GS, Momentum-GS.
- **Thermal-aware splatting:** MrGS (RGB+thermal, Fourier conduction + Stefan–Boltzmann,
  [arxiv](https://arxiv.org/abs/2511.22997)), Thermal3D-GS, Unpaired RGB-Thermal splatting
  ([arxiv](https://arxiv.org/pdf/2606.05491)).
- **Physics/inverse rendering:** PhysGaussian (CVPR 2024), i-PhysGaussian, SuGaR (CVPR 2024), SSD-GS,
  BRDFusion, MaterialClusterGS, RTR-GS (ACM MM), GI-GS, Phys3DGS, TRON, Differentiable Inverse Rendering
  with Interpretable Basis BRDFs.
- **Neural microclimate surrogates:** Localized Fourier Neural Operator for 3D urban microclimate
  ([arxiv](https://arxiv.org/abs/2411.11348)); FLUME-FNO ([arxiv](https://arxiv.org/abs/2503.19708));
  Generative Urban Flow Modeling (graph diffusion, [arxiv](https://arxiv.org/html/2512.14725)); FNO for
  real-time 3D urban microclimate (ScienceDirect); Surrogate modeling of urban boundary layer flows
  (*Physics of Fluids* 36(7)); Urban microclimate in Omniverse-class twins (*Smart Cities* 9(2):39, DOI
  [10.3390/smartcities9020039](https://doi.org/10.3390/smartcities9020039)).
