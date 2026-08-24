# EU Open Data & Interactive-Tool Landscape Audit for Delta Climate Research
*Research agent audit · compiled August 2026 · primary-source verification where possible; every licence claim cites its source page; unverified items are explicitly flagged.*

**Client context:** Delta Climate Research (deltaclimate.earth) — 5-person climate studio (Kolkata; India + UAE). Brand promise: *decision-grade, standards-aligned measurement; publishes error bars and null results.* This audit answers 8 research questions on EU open data + existing interactive tools, to pick two new buildable web products without duplicating official viewers.

---

## (a) Data-source table

| # | Source | Granularity | Licence (verified against source) | Access friction | Web-tool fit |
|---|--------|-------------|-----------------------------------|-----------------|--------------|
| 1 | **C3S Urban climate indicators / URBAN SIS–UrbClim** ("Climate variables for cities in Europe 2008–2017", CDS dataset `sis-urban-climate-cities`; mirrored as EEA "UHI intensity modelling, Jan 2020") | 100 m pixels, **hourly**, 2008–2017, **100 European cities**, temp difference vs rural P10 (degC) | Since **2 July 2025** all CDS/ADS/EWDS data moved from "Licence to use Copernicus Products (rev. 12)" to **CC BY 4.0** (official ECMWF forum announcement, verified) | **⚠ FACT-CHECK CORRECTION: the CDS dataset was DEPRECATED 10 May 2024 — "downloads are no longer supported"** on cds.climate.copernicus.eu. The live access path is the EEA "UHI intensity modelling" mirror record (sdi.eea 45b703bb) and any archived copies; re-verify availability before building on it | ***** — still the best fine-scale EU heat layer IF obtainable; EEA mirror is the route |
| 2 | **EEA UHI intensity modelling layer** (sdi.eea record 45b703bb) | 100 m, 100 cities, mean-UHI minus rural P10 | "Free, full and open access" per CLMS framework (Reg. EU 1159/2013); attribution required | Low (catalogue download) | **** — citable derivative of #1 |
| 3 | **Urban Atlas 2021 + Street Tree Layer (STL)** (CLMS) | Vector, FUAs (~788 cities), STL = tree patches >=500 m2, MMW 3 m (2021 edition) | CLMS free-full-open, attribution ("Contains modified Copernicus..."); exact per-product licence text not re-read this session — **flag: confirm on each product page before launch** | Low: pre-packaged FlatGeobuf per FUA | **** — canopy/green-exposure context at ward scale |
| 4 | **Copernicus High Resolution Layers (Tree Cover Density, Imperviousness...) 10 m** | 10 m raster, pan-Europe, multi-epoch | Same CLMS licensing family as #3 (**flag**: same confirmation step) | Low-medium: large rasters, CDSE recommended | **** — sealing/tree metrics per ward |
| 5 | **GHSL GHS-POP R2023A (+2025 epoch)** | **100 m** residential population (also 1 km), Mollweide, 1975–2030 epochs | **CC BY 4.0, verbatim: "including commercial uses"** (GHSLhowToCite.php); DOI 10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE | Low: direct GeoTIFF download | ***** — per-ward exposure denominators Indian data lacks |
| 6 | **Eurostat GEOSTAT / census 2021 population grid** (`cens_21grid` family) | 1 km2 grid points; also LAU/NUTS | Eurostat reuse policy -> **CC BY 4.0** under Commission Decision 2011/833/EU (as amended 2023/1740). Policy page scraped but body text partially JS-rendered; **flag: verify dataset-level metadata once** (GEOSTAT grids had a non-commercial-era restriction before the 2021 opening — historic only) | Low: API/bulk CSV | **** — harmonised "ward" units across EU27 |
| 7 | **PVGIS 5.2 API (JRC)** | Point queries; solar radiation + PV performance; global except poles | No commercial-use restriction found in official API documentation; **rate limits: 30 calls/s/IP, 429/529 documented**; governed by general EC/JRC reuse rules requiring acknowledgement. **Flag: no standalone PVGIS terms-of-use page retrievable this session — cite "© European Communities, reuse authorised with acknowledgment (JRC reuse policy)" and re-check the in-app disclaimer before commercial launch** | Very low: plain REST/JSON, no key | ***** — server-side batch precompute (respect 30/s), then serve statically |
| 8 | **Global Solar Atlas (World Bank/Solargis/ESMAP)** | Country/point GHI/GTI/PVOUT, yearly+monthly | **CC BY 4.0 + mandatory binding additions** (specific citation string; no WB/Solargis logos, no implied endorsement) — globalsolaratlas.info/support/terms-of-use & /download | Low: app + GeoTIFF/map downloads | **** — good non-EU fallback (UAE!) where PVGIS coverage thins |
| 9 | **JRC river flood hazard maps, Europe & Mediterranean** (dataset 1d128b6c-a4ee-4858-9e34-6210707f3c81) | Gridded hazard maps per return period | **CC BY 4.0** (explicit on catalogue page) | Low | **** — pluvial/fluvial exposure layer |
| 10 | **JRC global river flood hazard maps v2.1** (DOI 10.2905/JRC.VD32YWG) | 30 arc-sec, return periods | EU Open Data Portal licence (CC-BY family) — **flag: read licence tab once** | Low | *** — MENA-side coverage |
| 11 | **Copernicus EMS On-Demand Mapping** | 10–20 m crisis/risk maps per activation | Free and open products; requests routed through Authorized Users | High friction for *systematic* reuse (activation-based, not bulk) | ** — case studies only, not a tool backbone |
| 12 | **EFAS / CEMS Early Warning Data Store (EWDS)** | Hydrological forecasts/reanalyses | CC BY 4.0 since 2 July 2025 (same CDS-family switch); some components registration-gated | Medium: EWDS account | *** — live flood-awareness layers if needed later |
| 13 | **Copernicus DEM (GLO-30 / GLO-90 / EEA-10)** | 30 m / 90 m global; 10 m EU (restricted) | GLO-30/90: **free for all registered CDSE users**; EEA-10 limited to a specific user subset (dataspace COP-DEM page + ESA user-licence PDF) | Medium: free CDSE registration | ***** — replaces discontinued EU-DEM (25 m; retirement confirmed — "not maintained anymore and is no longer available" per land.copernicus.eu; fact-check: already retired by Sep–Nov 2023 per Wayback, so the earlier "January 2024" date is unsupported) |
| 14 | **IPCC AR6 sea-level projection data (NASA Sea Level Projection Tool)** | Tide-gauge/gridded SLR projections to 2150, scenarios | NASA/IPCC open distribution (**flag: exact licence string not captured; treat as open-with-attribution pending check**) | Low | **** — scenario engine for a European coastal viewer |
| 15 | **Copernicus Marine coastal sea level / "Sea Level Rise in Europe" (2024, Melet et al.)** | Regional obs + projections | CMEMS free-registration licence (**flag: confirm CMEMS commercial clause**) | Medium: registration | *** — scientific backbone + citations |
| 16 | **EGMS (European Ground Motion Service)** — InSAR Sentinel-1 velocity | Points ~20x55 m LOS footprint (L2a/L3, Ortho vertical + E-W), mm/yr, annual releases | Metadata: **no limitations on public access; full-open-free per Commission Delegated Regulation (EU) No 1159/2013 of 12 July 2013** (governance: Reg. (EU) 2021/696) **[fact-check corrected the legal-basis wording]**; use constraint = attribution (sdi.eea record 9abe5dd1). Viewing open; **archive search/download requires EU Login; programmatic API needs a token** | Medium: registration + per-track bulk files | ***** — unique differentiator; nobody has made it beautiful |
| 17 | **CAMS (ADS)** global + European air-quality/dust forecasts | ~40 km global / ~10 km Europe, hourly+NRT | **CC BY 4.0 since 2 July 2025** (ADS switch confirmed) — commercial-safe with attribution | Low-medium: ADS account + cdsapi | **** — live dust/AQ layers (Dubai dust story!) |
| 18 | **Open-Meteo** | Multi-model hourly weather | **Free API = NON-COMMERCIAL ONLY (verbatim terms)**; commercial use NO on free tier, YES paid plans; underlying data CC BY 4.0 | — | AVOID in commercial tools unless subscribing; use MET Norway / CAMS instead |
| 19 | **MET Norway Weather API / yr.no** | NWP point + products for Europe/global | **NLOD 2.0 AND CC BY 4.0** ("Unless specified otherwise, all data and products..." — docs.api.met.no/doc/License.html); requires User-Agent identification + attribution; derived/commercial products permitted | Very low: no key, just headers | ***** — the commercial-safe live-weather backbone for Europe |
| 20 | **Eurostat Comext (international trade in goods)** | Monthly CN8 flows by reporter/partner | Reuse under Eurostat policy -> CC BY 4.0 (**flag: confirm on Comext landing**); REST/JSON API documented ("API – Getting started for DS- prefixed datasets from Comext database") | Low: public API, no key | ***** — CBAM exposure engine |

---

## (b) Gap analysis

### Already served officially — do NOT rebuild generically
- **EU-wide UHI browsing:** Climate-ADAPT **Urban Adaptation Map Viewer** shows "Urban Heat Island (UHI) intensity (90th percentile)" layers for cities — but fact-check found the viewer page is now banner-archived as legacy/outdated content, i.e. official EU UHI browsing infrastructure is decaying rather than being maintained. The C3S heat-stress demonstrator covered the 100 UrbClim cities (2008–2017). A rigorous modern EU UHI product would not meaningfully duplicate these — the field is emptying.
- **National climate-effect atlases:** NL **Klimaateffectatlas** (viewer + map narratives + dashboard; scenarios Current/2050 Low-High; themes heat/drought/waterlogging/flood/water quality), Germany's fragmented set (Klimaatlas-BW "Hitzebetroffenheit" viewer, **Stadtklima Stuttgart Kartenviewer** 40+ layers, **BKG digitaler Hitzeatlas**, DWD Deutscher Klimaatlas, Frankfurt Klimafunktionskarte), France's **Institut Paris Région "Chaleur sur la ville"** ICU map + APUR open-data UHI studies + DRIEAT geodata portal.
- **Ground motion browsing:** official **EGMS Explorer** (points coloured by velocity), EGMS-toolkit Python scripts, and academic subsidence risk mapping — fact-check corrected the citation: **Cigna et al. 2025 (Scientific Reports 15:34999, doi:10.1038/s41598-025-18941-8)** covers the **15 metropolitan cities of Italy** (an output of the SubRISK+ PRIN 2022 project, not a public viewer titled "SubRISK+"). Conclusion unchanged and strengthened: no beautiful, building-linked, pan-European public subsidence viewer exists — Italy-only academic coverage is the entire state of the art.
- **Sea level:** NASA/IPCC AR6 projection tool and Climate Central's screening map (note: CoastalDEM underneath is proprietary — not reusable data; flag: widely stated, not re-verified this session).
- **Solar resource:** PVGIS app itself + Global Solar Atlas app.

### Systematic gaps a small studio can beat
1. **No uncertainty anywhere.** None of the precedent viewers expose error bars, P10/P90 bands, or validation residuals per unit (UKCP UI has probabilistic ranges but at national/regional scale and a dated UX). Delta's brand promise directly attacks this.
2. **No street/ward-scale aggregation with honest denominators.** Official EU heat layers stop at 100 m rasters or city polygons; nobody joins UHI x population (GHSL 100 m) x canopy (STL/HRL) into per-ward exposure statistics with confidence intervals.
3. **No 3D.** Every precedent is a 2D slippy map. Delta's CityJSON/3D-Tiles pipeline is a genuine moat (canopy shadowing over buildings; subsidence on building footprints).
4. **Shareability/permalinks.** UKCP UI and most municipal viewers generate no shareable state; embeddable, permalinked, investor-facing outputs don't exist.
5. **EGMS has no consumer-grade city product.** Amsterdam/Venice/Bucharest subsidence stories exist as papers and a utilitarian Explorer — no beautiful, building-linked, uncertainty-labelled public viewer.
6. **CBAM trade-exposure visualization is wide open.** Existing: EU Commission policy site (no data explorer), Polish Climate CAKE **CBAM Explorer** (modelling-oriented, Comext-based), cbam-check.com (HS lookup), NewClimate Excel-based **CBAM Vulnerability Monitor**, S&P Global paid Scenario Planner. No polished public "exposure by exporter country x goods x cost-scenario" visual tool on open Comext data.
7. **City portals are inconsistent** (Paris strong via APUR/IPR/DRIEAT; Barcelona/Athens portals **not verified this session** — flag): a pan-EU consistent product adds value above city ad-hocism.

---

## (c) Top 3 buildable EU concepts (exact stacks)

### Concept 1 — "Ward Heat Ledger EU": street-scale urban-heat exposure with published error bars
- **Data:** UrbClim 100 m hourly temps + UHI-intensity rasters — **⚠ fact-check: the CDS dataset `sis-urban-climate-cities` was deprecated 10 May 2024 (downloads disabled); obtain via the EEA "UHI intensity modelling" mirror record (sdi.eea 45b703bb) or direct VITO/EEA channels, and re-verify availability before committing** · Urban Atlas 2021 land use + Street Tree Layer (FlatGeobuf per FUA) · HRL Tree Cover Density/Imperviousness 10 m · **GHSL GHS-POP 100 m (CC BY 4.0)** denominators · Eurostat GEOSTAT 1 km2 grid for harmonised ward units · optional ECOSTRESS scenes (existing Kolkata pipeline).
- **Uncertainty story:** P10/P90 UHI distributions per ward (UrbClim percentile fields), station-vs-model residuals, explicit null results where signal is within noise.
- **Stack fit:** identical to Kolkata twin — Astro static + client-side three.js + OGC 3D Tiles; precomputed at build; zero backend. 100 cities covered out of the box.
- **Beats:** ClimateADAPT viewer (static percentiles, no wards, no 3D, no error bars), Klimaateffectatlas (NL-only, 2D), municipal maps (fragmented).

### Concept 2 — "Subsidence Atlas Europe": EGMS ground-motion explorer for Amsterdam/Venice/Bucharest + investor framing
- **Data:** EGMS L2a/L3 + Ortho vertical & E-W velocities (mm/yr + quality fields; free-full-open, attribution; bulk via EU Login token, precompute offline) · Copernicus DEM GLO-30 (free CDSE registration) · Overture building footprints + Google Open Buildings heights (existing pipeline) · GHSL population · optional MET Norway/CAMS live context (both commercial-safe).
- **Product:** click a building -> mm/yr velocity time-series, decomposed trend, sigma band, neighbouring-point coherence; ward aggregates with confidence intervals; 3D Tiles extrusions coloured by subsidence class.
- **Beats:** official EGMS Explorer (raw points, no buildings, no uncertainty UI, no storytelling); SubRISK+ (static academic maps). Nobody serves Venice/Amsterdam/Bucharest beautifully.

### Concept 3 — "CBAM Exposure Explorer": who pays, by exporter country and good
- **Data:** Eurostat **Comext API** (CN8 monthly imports by reporter/partner; CC BY 4.0) · CBAM Annex I goods mapping + default embedded-emissions values from EU Commission CBAM pages (public documents) · client-side carbon-price scenario engine (extends their existing CBAM calculator).
- **Product:** sankey/choropleth of CBAM-covered import value by exporter country (India & UAE highlighted), goods breakdown, certificate-cost ranges under price scenarios, uncertainty from default-vs-actual emissions assumptions. Permalinked, embeddable charts for consultancies.
- **Beats:** Climate CAKE Explorer (research-y), cbam-check (HS lookup only), NewClimate monitor (Excel), S&P (paid/closed).

*(Runner-up: EU rooftop-PV ROI tool — PVGIS 5.2 API precompute + GSA CC BY 4.0 cross-check + GLO-30 + Overture footprints; hold until PVGIS commercial terms are re-confirmed in writing.)*

---

## (d) Full source URLs

**Licences / terms (primary):**
- CDS->CC-BY switch announcement: https://forum.ecmwf.int/t/cc-by-licence-to-replace-licence-to-use-copernicus-products-on-02-july-2025/13464
- Legacy Copernicus product licence: https://cds.climate.copernicus.eu/licences/licence-to-use-copernicus-products
- GHSL use conditions (CC BY 4.0 verbatim): https://human-settlement.emergency.copernicus.eu/GHSLhowToCite.php ; GHS-POP page: https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php ; EU portal record: https://data.europa.eu/89h/2ff68a52-5b5b-4a22-8f40-c41da8332cfe
- JRC river-flood hazard maps (CC BY 4.0): https://data.jrc.ec.europa.eu/dataset/1d128b6c-a4ee-4858-9e34-6210707f3c81 ; collection: https://data.jrc.ec.europa.eu/collection/id-0054 ; global maps: https://data.europa.eu/doi/10.2905/JRC.VD32YWG ; EFAS collection: https://data.jrc.ec.europa.eu/collection/id-0069
- PVGIS API doc (rate limits, entrypoints): https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en ; hub: https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en
- Global Solar Atlas terms: https://globalsolaratlas.info/support/terms-of-use ; download/licence note: https://globalsolaratlas.info/download ; about: https://globalsolaratlas.info/support/about
- Copernicus DEM access tiers: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- EGMS portal: https://egms.land.copernicus.eu/ ; product page: https://land.copernicus.eu/en/products/european-ground-motion-service ; Ortho metadata (access/use constraints, Reg. 1159/2013): https://sdi.eea.europa.eu/catalogue/srv/api/records/9abe5dd1-3639-4aeb-a8de-ec2eb2f7fc93
- Open-Meteo terms: https://open-meteo.com/en/terms ; pricing matrix: https://open-meteo.com/en/pricing
- MET Norway licensing (NLOD 2.0 + CC BY 4.0): https://docs.api.met.no/doc/License.html ; yr developer terms: https://developer.yr.no/doc/TermsOfService/
- Eurostat reuse policy: https://ec.europa.eu/eurostat/about/policies/reuse ; Comext API guide: https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started/comext-database ; Comext database: https://ec.europa.eu/eurostat/web/international-trade-in-goods/database
- Urban Atlas STL 2021: https://land.copernicus.eu/en/products/urban-atlas/street-tree-layer-stl-2021 ; STL 2018: https://land.copernicus.eu/en/products/urban-atlas/street-tree-layer-stl-2018

**Urban heat layers / viewers:**
- EEA UHI intensity record: https://sdi.eea.europa.eu/catalogue/srv/api/records/45b703bb-d4f3-4eaa-8b73-13fde2041f01 ; data.europa.eu mirror: https://data.europa.eu/data/datasets/45b703bb-d4f3-4eaa-8b73-13fde2041f01
- CDS dataset sis-urban-climate-cities: https://cds.climate.copernicus.eu/datasets/sis-urban-climate-cities ; ECMWF doc: https://confluence.ecmwf.int/display/CKB/Climate+variables+for+cities+in+Europe+from+2008+to+2017+documentation
- C3S heat-stress demonstrator: https://climate.copernicus.eu/demonstrating-heat-stress-european-cities
- Urban SIS paper (Gidhagen 2020): https://www.sciencedirect.com/science/article/pii/S2212095518303444
- ClimateADAPT Urban Adaptation viewer datasets: https://climate-adapt.eea.europa.eu/en/knowledge/tools/urban-adaptation/Urban-Adaptation-viewer-datasets
- Destination Earth UHI use case: https://destination-earth.eu/use-cases/addressing-urban-heat-island-effect/
- Institut Paris Région "Chaleur sur la ville": https://www.institutparisregion.fr/environnement/changement-climatique/chaleur-sur-la-ville/ ; APUR UHI Paris: https://www.apur.org/en/climate-environment/air-noise/urban-heat-islands-paris-book-1 ; DRIEAT data: https://www.drieat.ile-de-france.developpement-durable.gouv.fr/acceder-aux-donnees-r4752.html

**Precedent tools:**
- Klimaateffectatlas: https://www.klimaateffectatlas.nl/en/ (+ /en/viewer, /en/faq)
- Klimaatlas BW Hitze: https://www.klimaatlas-bw.de/betroffenheit/hitze ; Stadtklima Stuttgart viewer: https://www.stadtklima-stuttgart.de/index.php?klima_kartenviewer ; BKG Hitzeatlas: https://gdz.bkg.bund.de/index.php/default/interaktive-atlanten/hitzeatlas.html ; DWD Klimaatlas: https://www.dwd.de/DE/klimaumwelt/klimaatlas/klimaatlas_node.html
- UKCP UI help: https://ukclimateprojections-ui.metoffice.gov.uk/help/start ; UKCP land maps: https://www.metoffice.gov.uk/research/approach/collaboration/ukcp/climate-projections-land-maps ; UKCP hub: https://www.metoffice.gov.uk/research/approach/collaboration/ukcp

**Flood/coastal/ground motion:**
- EGMS explainer: https://detektia.com/en/egms-european-ground-motion-service/ ; EGMS toolkit (Hrysiewicz 2024): https://link.springer.com/article/10.1007/s12145-024-01356-w ; registered-access note (Crosetto 2026): https://www.sciencedirect.com/science/article/pii/S0034425726001598 ; SubRISK+ 15 cities (Cigna 2025): https://pmc.ncbi.nlm.nih.gov/articles/PMC12504533/ ; UN-SPIDER EGMS entry: https://un-spider.org/links-and-resources/data-sources/european-ground-motion-service-copernicus-land-monitoring-service
- NASA IPCC AR6 SLR tool: https://sealevel.nasa.gov/ipcc-ar6-sea-level-projection-tool ; Sea Level Rise in Europe (Melet 2024): https://sp.copernicus.org/articles/3-slre1/4/2024/ ; DASNordicSLR: https://rmets.onlinelibrary.wiley.com/doi/10.1002/gdj3.70065
- EU-DEM retirement: https://www.eea.europa.eu/data-and-maps/data/copernicus-land-monitoring-service-eu-dem ; https://www.gpxz.io/blog/eudem
- CEMS mapping portal: https://mapping.emergency.copernicus.eu/ ; EMS hub: https://emergency.copernicus.eu/

**CBAM:**
- EU Commission CBAM: https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en
- Climate CAKE CBAM Explorer: https://climatecake.ios.edu.pl/cbam_explorer/
- cbam-check: https://www.cbam-check.com/ ; NewClimate CBAM Vulnerability Monitor: https://newclimate.org/resources/tools/cbam-vulnerability-monitor-cbam-vm ; S&P CBAM Scenario Planner: https://www.marketplace.spglobal.com/en/datasets/cbam-scenario-planner-(1764177279)

### Explicit uncertainty flags
1. **PVGIS commercial terms:** no standalone ToU page exists (fact-check re-confirmed); API docs impose only technical limits ("30 calls/second per IP address", verbatim). Re-confirm the in-app disclaimer before commercial launch.
2. **CLMS per-product licence strings** (Urban Atlas/HRL): free-full-open family confirmed via metadata records, but re-read each product's licence tab at launch (post-July-2025 CC-BY migration may vary per store).
3. **Eurostat grid licences:** policy = CC BY 4.0; dataset-level metadata not individually opened this session.
4. **Athens & Barcelona city portals:** not verified this session.
5. **UKCP UI licence/registration specifics** and **CMEMS commercial clause**: not verified this session.
6. **Climate Central CoastalDEM proprietary status:** widely stated but not re-verified this session.
